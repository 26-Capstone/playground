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

    /** Public address of the dashboard, so an alert can link back to it. Optional. */
    @Value("${doma.app-base-url:}")
    private String appBaseUrl;

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

        String extracted   = (String) result.getOrDefault("extracted_text", "—");
        // A heal can clear the confidence bar and still be wrong. The holdout
        // evaluation put that at 8.3% of heals, and the failures share a shape:
        // the value returned is a *different kind* of thing than the field used
        // to hold ('37억원' becomes the row's rank badge '1'). Auto-approval
        // overwrites cssSelector and lastValue together, so a wrong one cannot be
        // undone by rolling back code — the previous value is already gone.
        // Route those to the approval queue instead of trusting the confidence.
        boolean kindChanged = valueKindChanged(scraper.getLastValue(), extracted);

        if ("healed".equals(status) && confidence >= threshold && !kindChanged) {
            // Confidence threshold met → auto-recovered
            String oldSelector = scraper.getCssSelector();
            double scoreVal = Math.round(confidence * 1000.0) / 10.0;
            updateLastScore(scraperId, scoreVal);
            scraper.setStatus("healthy");
            scraper.setScore(scoreVal);
            scraper.setLastValue(extracted);
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
            sendHealSlackAlert(scraper, null, scraper.getCssSelector(), result, confidence,
                kindChanged ? "value_kind_changed" : "pending", now);
            log.info("[healer] {} → approval queue ({}, confidence {}%)", scraper.getName(),
                kindChanged ? "value kind changed" : "below confidence threshold", Math.round(confidence * 100));

        } else if ("no_change_needed".equals(status)) {
            // The selector still resolves in the snapshot, so there is nothing to
            // heal — the scrape failed for some other reason (a slow render, or the
            // page changing between the run and the snapshot, which happens
            // constantly on a ranking page). Neither mark it failed nor call anyone:
            // the healer only saw a snapshot, and that it matched there is no
            // evidence the live page is fine. ScraperService has already set the
            // status to "healing" and the next run settles it.
            log.info("[healer] {} needs no heal — selector still resolves in the snapshot", scraper.getName());

        } else {
            // The healer gave up. Until now this was silent — the scraper just sat
            // at status=failed until somebody opened the dashboard. This is exactly
            // the case a human has to resolve, so it is the one worth interrupting
            // them for: nothing will fix itself here.
            updateScraperFailed(scraper);
            sendHealSlackAlert(scraper, null, scraper.getCssSelector(), result, confidence, "needs_user", now);
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

        String extracted   = (String) result.getOrDefault("extracted_text", "—");
        boolean kindChanged = valueKindChanged(String.valueOf(field.get("lastValue")), extracted);

        if ("healed".equals(status) && confidence >= threshold && !kindChanged) {
            field.put("selector", result.getOrDefault("robust_selector", selector));
            field.put("lastValue", extracted);
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
            sendHealSlackAlert(scraper, label, selector, result, confidence,
                kindChanged ? "value_kind_changed" : "pending", LocalDateTime.now().format(FMT));
            log.info("[healer] {} extra field '{}' → approval queue ({}, confidence {}%)", scraper.getName(), label,
                kindChanged ? "value kind changed" : "below confidence threshold", Math.round(confidence * 100));

        } else if ("no_change_needed".equals(status)) {
            log.info("[healer] {} extra field '{}' needs no heal — selector still resolves in the snapshot",
                scraper.getName(), label);

        } else {
            sendHealSlackAlert(scraper, label, selector, result, confidence, "needs_user",
                LocalDateTime.now().format(FMT));
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

        boolean needsUser  = "needs_user".equals(status);
        boolean kindChanged = "value_kind_changed".equals(status);
        String newSelector = (String) result.getOrDefault("robust_selector", "");
        String extracted   = (String) result.getOrDefault("extracted_text", "");

        String icon, statusLabel;
        if (needsUser)         { icon = "🚨"; statusLabel = "Could not heal — pick the element again"; }
        else if (kindChanged)  { icon = "⚠️"; statusLabel = "Held for review — value looks like a different field"; }
        else if ("auto_approved".equals(status)) { icon = "🩹"; statusLabel = "Auto-recovery complete"; }
        else                   { icon = "🩹"; statusLabel = "Pending approval"; }

        StringBuilder sb = new StringBuilder();
        sb.append(icon).append(" *DOMA self-heal* — *").append(scraper.getName()).append("*\n");
        sb.append("*Status:* `").append(statusLabel).append("`\n");
        sb.append("*Field:* ").append(fieldLabel != null ? fieldLabel : "Default").append("\n");

        if (needsUser) {
            // There is no proposed selector to show — that is the whole point.
            sb.append("*Selector:* `").append(oldSelector).append("` (still broken)\n");
            Object reason = result.get("reason");
            if (reason != null) sb.append("*Reason:* ").append(reason).append("\n");
        } else {
            sb.append("*Selector:* `").append(oldSelector).append("` → `").append(newSelector).append("`\n");
            sb.append("*Confidence:* ").append(Math.round(confidence * 100)).append("%\n");
        }

        if (kindChanged) {
            // Show both values side by side — the mismatch is the evidence, and it
            // is far quicker to judge than a selector string.
            sb.append("*Value:* `").append(scraper.getLastValue()).append("` → `")
              .append(extracted).append("`\n");
            sb.append("_Confidence cleared the bar, but the new value is a different kind of ")
              .append("thing than this field has been returning — approve or fix it by hand._\n");
        }

        sb.append("*Time:* ").append(now).append("\n");
        sb.append("*URL:* ").append(scraper.getUrl());
        // Link straight to where the person has to act: the scraper itself when the
        // element must be picked again, the queue when a heal is waiting on review.
        // The client reads these query params on load (client/src/app.jsx).
        if ((needsUser || kindChanged) && appBaseUrl != null && !appBaseUrl.isBlank()) {
            String base = appBaseUrl.endsWith("/")
                ? appBaseUrl.substring(0, appBaseUrl.length() - 1)
                : appBaseUrl;
            sb.append(needsUser
                ? "\n*Pick the element again:* " + base + "/?scraper=" + scraper.getId()
                : "\n*Review in the approval queue:* " + base + "/?view=approvals");
        }

        Map<String, Object> textObj = new LinkedHashMap<>();
        textObj.put("type", "mrkdwn");
        textObj.put("text", sb.toString());

        Map<String, Object> section = new LinkedHashMap<>();
        section.put("type", "section");
        section.put("text", textObj);

        Map<String, Object> slack = new LinkedHashMap<>();
        slack.put("text", icon + " DOMA self-heal — " + scraper.getName() + " (" + statusLabel + ")");
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


    /**
     * Whether the healed value looks like a *different kind of thing* than what
     * this field has been returning — not merely a different value.
     *
     * A price that moves from 74,432원 to 75,100원 is the field working. A price
     * that becomes "1" is the healer having landed on the row's rank badge, and a
     * name that becomes "8.8억원" is it having landed on the wrong column. The
     * holdout evaluation put this class of failure at 8.3% of heals even after
     * the ranking fixes, and confidence does not separate them: they arrive
     * *above* the threshold, which is what makes them dangerous. Auto-approval
     * writes cssSelector and lastValue in the same save, so once one lands the
     * previous value is gone and no code rollback brings it back.
     *
     * The checks mirror features the ranker already uses (digit ratio, currency
     * symbol, numeric format), deliberately kept coarse. A false alarm costs one
     * approval-queue review; a miss costs silently corrupted data.
     */
    static boolean valueKindChanged(String oldValue, String newValue) {
        if (oldValue == null || newValue == null) return false;
        String a = oldValue.trim(), b = newValue.trim();
        // "—" is the placeholder written while a field is pending or has never
        // run, so there is no established shape to compare against yet.
        if (a.isEmpty() || b.isEmpty() || "—".equals(a) || "null".equals(a)) return false;
        if (a.equals(b)) return false;

        if (Math.abs(digitRatio(a) - digitRatio(b)) >= 0.5) return true;
        if (hasCurrency(a) != hasCurrency(b)) return true;
        if (isPureNumber(a) != isPureNumber(b)) return true;

        double longer = Math.max(a.length(), b.length());
        double shorter = Math.min(a.length(), b.length());
        return shorter > 0 && longer / shorter >= 4.0;
    }

    private static double digitRatio(String text) {
        if (text.isEmpty()) return 0;
        long digits = text.chars().filter(Character::isDigit).count();
        return digits / (double) text.length();
    }

    private static boolean hasCurrency(String text) {
        return text.matches(".*[\\$€£₩¥].*") || text.contains("원") || text.contains("달러");
    }

    /** No letters at all — a bare number/percentage rather than a label or name. */
    private static boolean isPureNumber(String text) {
        return text.matches("[^\\p{L}]*\\d[^\\p{L}]*");
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
