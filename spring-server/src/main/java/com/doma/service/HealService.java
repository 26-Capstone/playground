package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.Scraper;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScrapeResultRepository;
import com.doma.repository.ScraperRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class HealService {

    private final RestTemplate restTemplate;
    private final ScraperRepository scraperRepository;
    private final ScrapeResultRepository scrapeResultRepository;
    private final HealProposalRepository healProposalRepository;

    @Value("${doma.scraper-service-url}")
    private String scraperServiceUrl;

    @Value("${doma.python-api-url}")
    private String pythonApiUrl;

    private static final DateTimeFormatter FMT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * Attempts to heal only whichever of primaryBroken/brokenExtraFieldLabels is
     * actually broken. The V1 snapshot is fetched once and shared. Primary healing
     * keeps the existing logic (updates the scraper's status/score/lastValue),
     * while extra-field healing runs through a fully isolated separate path so
     * neither result overwrites the other.
     */
    public void tryHeal(String scraperId, String v2Html, boolean primaryBroken, List<String> brokenExtraFieldLabels) {
        Scraper scraper = scraperRepository.findById(scraperId).orElse(null);
        if (scraper == null) return;

        // Fetch the V1 snapshot
        String v1Html;
        try {
            Map<String, String> snap = restTemplate.getForObject(
                scraperServiceUrl + "/internal/snapshot/" + scraperId, Map.class);
            if (snap == null || snap.get("html") == null) {
                log.info("[healer] {} — no V1 snapshot, skipping self-heal", scraper.getName());
                if (primaryBroken) updateScraperFailed(scraper);
                return;
            }
            v1Html = snap.get("html");
        } catch (Exception e) {
            log.info("[healer] {} — no V1 snapshot, skipping self-heal", scraper.getName());
            if (primaryBroken) updateScraperFailed(scraper);
            return;
        }

        if (primaryBroken) {
            healPrimary(scraper, scraperId, v1Html, v2Html);
        }
        for (String label : brokenExtraFieldLabels) {
            healExtraField(scraperId, label, v1Html, v2Html);
        }
    }

    @SuppressWarnings("unchecked")
    private void healPrimary(Scraper scraper, String scraperId, String v1Html, String v2Html) {
        Map<String, Object> healReq = Map.of(
            "v1_html",      v1Html,
            "v2_html",      v2Html,
            "css_selector", scraper.getCssSelector(),
            "user_intent",  scraper.getUserIntent(),
            "target_name",  scraper.getName()
        );

        Map<String, Object> result;
        try {
            result = restTemplate.postForObject(
                pythonApiUrl + "/heal", healReq, Map.class);
        } catch (Exception e) {
            log.error("[healer] {} — Python API error: {}", scraper.getName(), e.getMessage());
            updateScraperFailed(scraper);
            return;
        }

        if (result == null) { updateScraperFailed(scraper); return; }

        String status     = (String) result.getOrDefault("status", "failed");
        double confidence = ((Number) result.getOrDefault("confidence", 0)).doubleValue();
        double threshold  = scraper.getThreshold() / 100.0;
        String now        = LocalDateTime.now().format(FMT);

        if ("healed".equals(status) && confidence >= threshold) {
            // Confidence threshold met → auto-recovered
            String oldSelector = scraper.getCssSelector();
            double scoreVal = Math.round(confidence * 1000.0) / 10.0;
            updateLastScore(scraperId, scoreVal);
            scraper.setStatus("healthy");
            scraper.setScore(scoreVal);
            scraper.setLastValue((String) result.getOrDefault("extracted_text", "—"));
            scraper.setLastRunAt(now);
            scraper.setHealedCount(scraper.getHealedCount() + 1);
            scraper.setCssSelector((String) result.getOrDefault("robust_selector", scraper.getCssSelector()));
            scraperRepository.save(scraper);
            saveHistoryEntry(scraper, null, oldSelector, result, confidence, now, "auto_approved", v1Html, v2Html);
            sendHealSlackAlert(scraper, null, oldSelector, result, confidence, "auto_approved", now);
            log.info("[healer] {} auto-recovery complete (confidence {}%)", scraper.getName(), Math.round(confidence * 100));

        } else if ("healed".equals(status)) {
            // Below confidence threshold → saved to approval queue
            double scoreVal = Math.round(confidence * 1000.0) / 10.0;
            updateLastScore(scraperId, scoreVal);
            scraper.setStatus("pending");
            scraper.setScore(scoreVal);
            scraper.setLastValue("—");
            scraper.setLastRunAt(now);
            scraperRepository.save(scraper);

            upsertPendingProposal(scraperId, scraper.getName(), null, scraper.getCssSelector(),
                result, confidence, v1Html, v2Html);
            sendHealSlackAlert(scraper, null, scraper.getCssSelector(), result, confidence, "pending", now);
            log.info("[healer] {} below confidence threshold ({}%) → saved to approval queue", scraper.getName(), Math.round(confidence * 100));

        } else {
            updateScraperFailed(scraper);
            log.info("[healer] {} cannot heal — {}", scraper.getName(), result.get("reason"));
        }
    }

    /**
     * Heals a single extra field independently. Never touches the primary field's
     * status/score/lastValue or ScrapeResult.score — this prevents an extra-field
     * failure from marking a healthy scraper as "failed," and prevents multiple
     * fields healing sequentially from overwriting each other's score with their
     * own confidence. The scraper is re-fetched right before writing, limiting the
     * race window to a single field (one LLM call).
     */
    @SuppressWarnings("unchecked")
    private void healExtraField(String scraperId, String label, String v1Html, String v2Html) {
        Scraper scraper = scraperRepository.findById(scraperId).orElse(null);
        if (scraper == null) return;

        List<Map<String, Object>> fields = parseFields(scraper.getExtraFields());
        Map<String, Object> field = fields.stream()
            .filter(f -> label.equals(f.get("label")))
            .findFirst().orElse(null);
        if (field == null) {
            log.info("[healer] {} — extra field '{}' already deleted/changed, skipping heal", scraper.getName(), label);
            return;
        }
        String selector = String.valueOf(field.get("selector"));

        Map<String, Object> healReq = Map.of(
            "v1_html",      v1Html,
            "v2_html",      v2Html,
            "css_selector", selector,
            "user_intent",  scraper.getUserIntent() + " (extra field: " + label + ")",
            "target_name",  label
        );

        Map<String, Object> result;
        try {
            result = restTemplate.postForObject(pythonApiUrl + "/heal", healReq, Map.class);
        } catch (Exception e) {
            log.error("[healer] {} — extra field '{}' Python API error: {}", scraper.getName(), label, e.getMessage());
            return;
        }
        if (result == null) return;

        String status     = (String) result.getOrDefault("status", "failed");
        double confidence = ((Number) result.getOrDefault("confidence", 0)).doubleValue();
        double threshold  = scraper.getThreshold() / 100.0;

        if ("healed".equals(status) && confidence >= threshold) {
            field.put("selector", result.getOrDefault("robust_selector", selector));
            field.put("lastValue", result.getOrDefault("extracted_text", "—"));
            scraper.setExtraFields(fieldsToJson(fields));
            scraper.setHealedCount(scraper.getHealedCount() + 1);
            scraperRepository.save(scraper);
            String now = LocalDateTime.now().format(FMT);
            saveHistoryEntry(scraper, label, selector, result, confidence, now, "auto_approved", v1Html, v2Html);
            sendHealSlackAlert(scraper, label, selector, result, confidence, "auto_approved", now);
            log.info("[healer] {} extra field '{}' auto-recovery complete (confidence {}%)", scraper.getName(), label, Math.round(confidence * 100));

        } else if ("healed".equals(status)) {
            upsertPendingProposal(scraperId, scraper.getName(), label, selector,
                result, confidence, v1Html, v2Html);
            sendHealSlackAlert(scraper, label, selector, result, confidence, "pending", LocalDateTime.now().format(FMT));
            log.info("[healer] {} extra field '{}' below confidence threshold ({}%) → saved to approval queue", scraper.getName(), label, Math.round(confidence * 100));

        } else {
            log.info("[healer] {} extra field '{}' cannot heal — {}", scraper.getName(), label, result.get("reason"));
        }
    }

    /**
     * Below-threshold heal results go here instead of straight to save() — on a
     * short schedule (e.g. every 15m), a selector that stays broken re-triggers
     * healing on every run, and without this the approval queue filled up with a
     * fresh duplicate row per run for the same unresolved scraper/field while the
     * original just sat there awaiting review. Reusing the existing pending
     * proposal keeps one live row per broken field, refreshed with the latest
     * attempt's data.
     */
    private void upsertPendingProposal(String scraperId, String scraperName, String fieldLabel,
                                        String oldSelector, Map<String, Object> result, double confidence,
                                        String v1Html, String v2Html) {
        HealProposal proposal = healProposalRepository
            .findFirstByScraperIdAndFieldLabelAndStatusOrderByCreatedAtDesc(scraperId, fieldLabel, "pending")
            .orElseGet(HealProposal::new);
        proposal.setScraperId(scraperId);
        proposal.setScraperName(scraperName);
        proposal.setFieldLabel(fieldLabel);
        proposal.setOldSelector(oldSelector);
        proposal.setProposedSelector((String) result.getOrDefault("robust_selector", ""));
        proposal.setExtractedText((String) result.getOrDefault("extracted_text", ""));
        proposal.setConfidence(confidence);
        proposal.setReasoning((String) result.getOrDefault("reasoning", ""));
        proposal.setV1Html(v1Html);
        proposal.setV2Html(v2Html);
        proposal.setCreatedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(proposal);
    }

    /**
     * The approval queue (HealProposal) was originally designed to represent only
     * "pending proposals," so auto-recovered records never left one behind — to
     * show auto-recoveries alongside pending ones on the self-heal history screen,
     * this path also needs to leave a record in the same table (already marked as
     * processed).
     */
    private void saveHistoryEntry(Scraper scraper, String fieldLabel, String oldSelector,
                                   Map<String, Object> result, double confidence, String now, String status,
                                   String v1Html, String v2Html) {
        HealProposal entry = new HealProposal();
        entry.setScraperId(scraper.getId());
        entry.setScraperName(scraper.getName());
        entry.setFieldLabel(fieldLabel);
        entry.setOldSelector(oldSelector);
        entry.setProposedSelector((String) result.getOrDefault("robust_selector", ""));
        entry.setExtractedText((String) result.getOrDefault("extracted_text", ""));
        entry.setConfidence(confidence);
        entry.setReasoning((String) result.getOrDefault("reasoning", ""));
        entry.setStatus(status);
        entry.setReviewedAt(now);
        entry.setV1Html(v1Html);
        entry.setV2Html(v2Html);
        healProposalRepository.save(entry);
    }

    /**
     * Notifies the scraper's configured Slack webhook when a self-heal
     * (auto-recovery/pending-approval) occurs. This is a separate path from
     * ScraperService's data alerts (buildSlackPayload) — if HealService depended
     * on ScraperService, it would create a circular dependency, so heal
     * notifications are handled independently here. Webhook send failures must
     * not affect the heal flow, so exceptions are only logged and swallowed.
     */
    private void sendHealSlackAlert(Scraper scraper, String fieldLabel, String oldSelector,
                                     Map<String, Object> result, double confidence, String status, String now) {
        if (!"slack".equals(scraper.getWebhookType())) return;
        String webhookUrl = scraper.getWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) return;

        String statusLabel = "auto_approved".equals(status) ? "Auto-recovery complete" : "Pending approval";
        String newSelector = (String) result.getOrDefault("robust_selector", "");

        StringBuilder sb = new StringBuilder();
        sb.append("🩹 *DOMA self-heal* — *").append(scraper.getName()).append("*\n");
        sb.append("*Status:* `").append(statusLabel).append("`\n");
        sb.append("*Field:* ").append(fieldLabel != null ? fieldLabel : "Default").append("\n");
        sb.append("*Selector:* `").append(oldSelector).append("` → `").append(newSelector).append("`\n");
        sb.append("*Confidence:* ").append(Math.round(confidence * 100)).append("%\n");
        sb.append("*Time:* ").append(now).append("\n");
        sb.append("*URL:* ").append(scraper.getUrl());

        Map<String, Object> textObj = new LinkedHashMap<>();
        textObj.put("type", "mrkdwn");
        textObj.put("text", sb.toString());

        Map<String, Object> section = new LinkedHashMap<>();
        section.put("type", "section");
        section.put("text", textObj);

        Map<String, Object> slack = new LinkedHashMap<>();
        slack.put("text", "🩹 DOMA self-heal — " + scraper.getName());
        slack.put("blocks", List.of(section));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            restTemplate.postForEntity(webhookUrl, new HttpEntity<>(slack, headers), String.class);
            log.info("[healer] Slack alert sent — {} ({})", scraper.getName(), statusLabel);
        } catch (Exception e) {
            log.warn("[healer] Slack alert failed {}: {}", webhookUrl, e.getMessage());
        }
    }

    private void updateScraperFailed(Scraper scraper) {
        scraper.setStatus("failed");
        scraper.setLastRunAt(LocalDateTime.now().format(FMT));
        scraperRepository.save(scraper);
    }

    private void updateLastScore(String scraperId, double score) {
        scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc(scraperId)
            .stream().findFirst().ifPresent(r -> {
                r.setScore(score);
                scrapeResultRepository.save(r);
            });
    }

    private List<Map<String, Object>> parseFields(String json) {
        if (json == null || json.isBlank()) return new ArrayList<>();
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                json,
                new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private String fieldsToJson(List<Map<String, Object>> fields) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(fields);
        } catch (Exception e) {
            return null;
        }
    }
}
