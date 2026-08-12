package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.Scraper;
import com.doma.domain.ScrapeResult;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScraperRepository;
import com.doma.repository.ScrapeResultRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ScraperService {

    private final ScraperRepository scraperRepository;
    private final ScrapeResultRepository scrapeResultRepository;
    private final HealProposalRepository healProposalRepository;
    private final HealService healService;
    private final RestTemplate restTemplate;

    @Value("${doma.scraper-service-url}")
    private String scraperServiceUrl;

    // Guard against run() firing twice concurrently — this blocks both cases: the "Run now"
    // button overlapping with a scheduled run, and a job re-registered right after
    // updateSettings() firing immediately via smartInitialDelay=0 while a previous run is
    // still in flight.
    private final Set<String> runningIds = ConcurrentHashMap.newKeySet();

    private static final DateTimeFormatter FMT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final Map<String, String> SCHEDULE_LABELS = Map.of(
        "daily-9", "Daily at 09:00",
        "hourly",  "Hourly",
        "15m",     "Every 15 min"
    );

    private static final Map<String, String> DOMAIN_LABELS = Map.of(
        "commerce",   "Consumer demand",
        "labor",      "Labor market",
        "realestate", "Real estate",
        "regulatory", "Regulatory & disclosure",
        "media",      "Media",
        "finance",    "Finance"
    );

    // ── Listing ─────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listAll() {
        return scraperRepository.findAllByOrderByCreatedAtDesc().stream()
            .map(s -> {
                Map<String, Object> dto = toDto(s);
                dto.put("spark", sparkScores(s.getId()));
                return dto;
            })
            .collect(Collectors.toList());
    }

    public Optional<Map<String, Object>> getOne(String id) {
        return scraperRepository.findById(id).map(this::toDto);
    }

    // ── Create ──────────────────────────────────────────────────────────────────

    public Scraper create(Map<String, Object> body) {
        String id = body.containsKey("id")
            ? (String) body.get("id")
            : "cr_" + UUID.randomUUID().toString().replace("-", "").substring(0, 4);

        Scraper s = new Scraper();
        s.setId(id);
        s.setName((String) body.get("name"));
        s.setUrl((String) body.get("url"));
        s.setCssSelector((String) body.getOrDefault("css_selector", ""));
        s.setUserIntent((String) body.getOrDefault("user_intent", ""));
        s.setExtraFields(normalizeExtraFieldsJson(body.get("extra_fields")));
        s.setThreshold(body.containsKey("threshold") ? ((Number) body.get("threshold")).intValue() : 85);
        s.setSchedule((String) body.getOrDefault("schedule", "daily-9"));

        Object ch = body.get("channels");
        s.setChannels(ch instanceof List ? listToJson((List<?>) ch) : "[\"REST API\"]");

        s.setDomain((String) body.getOrDefault("domain", "commerce"));
        s.setOrg((String) body.getOrDefault("org", ""));
        s.setOwner((String) body.getOrDefault("owner", ""));
        s.setStatus("pending");
        return scraperRepository.save(s);
    }

    // ── Delete ──────────────────────────────────────────────────────────────────

    @Transactional
    public void delete(String id) {
        healProposalRepository.deleteByScraperId(id);
        scrapeResultRepository.deleteByScraperId(id);
        scraperRepository.deleteById(id);
    }

    // ── Selector update ────────────────────────────────────────────────────────

    /**
     * extraFields uses "full replace" semantics — the caller must send the complete
     * array every time, including any fields it wants to keep (same contract as
     * channels). null leaves the extra fields untouched; any non-null value
     * (including an empty array) fully replaces them.
     */
    public Optional<Scraper> updateSelector(String id, String cssSelector, String userIntent,
                                             Object extraFieldsRaw) {
        return scraperRepository.findById(id).map(s -> {
            s.setCssSelector(cssSelector);
            if (userIntent != null) s.setUserIntent(userIntent);
            if (extraFieldsRaw != null) {
                s.setExtraFields(normalizeExtraFieldsJson(extraFieldsRaw));
            }
            s.setStatus("pending");
            s.setScore(0.0);
            s.setLastValue("—");
            return scraperRepository.save(s);
        });
    }

    // ── Operational settings update (schedule · threshold · channels) ───────────

    public Optional<Scraper> updateSettings(String id, Map<String, Object> body) {
        return scraperRepository.findById(id).map(s -> {
            if (body.containsKey("schedule"))
                s.setSchedule((String) body.get("schedule"));
            if (body.containsKey("threshold"))
                s.setThreshold(((Number) body.get("threshold")).intValue());
            if (body.containsKey("channels")) {
                Object ch = body.get("channels");
                s.setChannels(ch instanceof List ? listToJson((List<?>) ch) : s.getChannels());
            }
            if (body.containsKey("webhookUrl"))
                s.setWebhookUrl((String) body.get("webhookUrl"));
            if (body.containsKey("webhookType"))
                s.setWebhookType((String) body.get("webhookType"));
            if (body.containsKey("alertOnChange"))
                s.setAlertOnChange(Boolean.TRUE.equals(body.get("alertOnChange")));
            if (body.containsKey("alertDelta"))
                s.setAlertDelta(body.get("alertDelta") == null ? null : ((Number) body.get("alertDelta")).doubleValue());
            if (body.containsKey("alertRangeMin"))
                s.setAlertRangeMin(body.get("alertRangeMin") == null ? null : ((Number) body.get("alertRangeMin")).doubleValue());
            if (body.containsKey("alertRangeMax"))
                s.setAlertRangeMax(body.get("alertRangeMax") == null ? null : ((Number) body.get("alertRangeMax")).doubleValue());
            return scraperRepository.save(s);
        });
    }

    // ── Run now ────────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    public Map<String, Object> run(String scraperId) {
        if (!runningIds.add(scraperId)) {
            log.info("[run] {} — already running, skipping (duplicate-run guard)", scraperId);
            return Map.of("status", "skipped", "reason", "already_running");
        }
        try {
            return doRun(scraperId);
        } finally {
            runningIds.remove(scraperId);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> doRun(String scraperId) {
        Scraper scraper = scraperRepository.findById(scraperId)
            .orElseThrow(() -> new NoSuchElementException("Scraper not found: " + scraperId));

        List<Map<String, Object>> extraFields = parseFields(scraper.getExtraFields());

        // Call the Node.js scraper service
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("id",           scraper.getId());
        req.put("name",         scraper.getName());
        req.put("url",          scraper.getUrl());
        req.put("css_selector", scraper.getCssSelector());
        req.put("user_intent",  scraper.getUserIntent());
        if (!extraFields.isEmpty()) {
            req.put("extra_fields", extraFields.stream()
                .map(f -> (Map<String, Object>) Map.of("label", f.get("label"), "selector", f.get("selector")))
                .collect(Collectors.toList()));
        }
        Map<String, Object> result = restTemplate.postForObject(
            scraperServiceUrl + "/internal/run", req, Map.class);

        if (result == null) throw new RuntimeException("No response from the Node.js scraper service");

        String status     = (String) result.getOrDefault("status", "failed");
        String value      = (String) result.getOrDefault("value", "");
        String html       = (String) result.getOrDefault("html", "");
        int    durationMs = ((Number) result.getOrDefault("durationMs", 0)).intValue();
        String now        = LocalDateTime.now().format(FMT);
        boolean succeeded = "healthy".equals(status);

        // Merge extra-field responses — Node preserves input order, so we match by index
        // (this avoids relying on label uniqueness; label-based matching is only used in approve())
        List<Map<String, Object>> extraResults =
            (List<Map<String, Object>>) result.getOrDefault("extraValues", List.of());
        List<String> brokenExtraLabels = new ArrayList<>();
        List<Map<String, Object>> snapshotExtraValues = new ArrayList<>();

        for (int i = 0; i < extraFields.size(); i++) {
            Map<String, Object> field = extraFields.get(i);
            String label = (String) field.get("label");
            Map<String, Object> res = i < extraResults.size() ? extraResults.get(i) : null;
            String v = res != null && res.get("value") != null ? String.valueOf(res.get("value")) : "";
            boolean err = res == null || res.get("error") != null || v.isEmpty();

            field.put("lastValue", err ? "—" : v);
            if (err) brokenExtraLabels.add(label);

            Map<String, Object> snap = new LinkedHashMap<>();
            snap.put("label", label);
            snap.put("value", err ? "" : v);
            snapshotExtraValues.add(snap);
        }
        if (!extraFields.isEmpty()) {
            scraper.setExtraFields(listToJson(extraFields));
        }

        // Save the result
        ScrapeResult sr = new ScrapeResult();
        sr.setScraperId(scraperId);
        sr.setStatus(status);
        sr.setValue(value);
        sr.setExtraValues(snapshotExtraValues.isEmpty() ? null : listToJson(snapshotExtraValues));
        sr.setScore(succeeded ? 99.0 : 0.0);
        sr.setDurationMs(durationMs);
        sr.setNote(succeeded ? "Collected successfully — " + value : "Selector match failed");
        scrapeResultRepository.save(sr);

        // Update scraper status (only the primary result is reflected — extra fields don't affect status/score)
        double recentScore = scrapeResultRepository
            .findTop50ByScraperIdOrderByRunAtDesc(scraperId)
            .stream().findFirst().map(ScrapeResult::getScore).orElse(0.0);

        String previousValue = scraper.getLastValue(); // captured before setLastValue

        scraper.setStatus(succeeded ? "healthy" : "healing");
        scraper.setScore(recentScore);
        scraper.setLastValue(succeeded ? value : "—");
        scraper.setLastRunAt(now);
        scraperRepository.save(scraper);

        // If the primary or any extra field is broken, attempt self-heal asynchronously (processed sequentially on a single thread)
        boolean primaryBroken = !succeeded;
        if ((primaryBroken || !brokenExtraLabels.isEmpty()) && !html.isEmpty()) {
            new Thread(() -> healService.tryHeal(scraperId, html, primaryBroken, brokenExtraLabels)).start();
        }

        // Determine alert and send webhook (based on the primary field)
        if (scraper.getWebhookUrl() != null && !scraper.getWebhookUrl().isBlank()) {
            if (succeeded) {
                new Thread(() -> checkAndFireAlert(scraper, value, previousValue, now)).start();
            } else {
                new Thread(() -> fireFailureAlert(scraper, previousValue, now)).start();
            }
        }

        return result;
    }

    public Map<String, Object> testWebhook(String scraperId) {
        Scraper scraper = scraperRepository.findById(scraperId)
            .orElseThrow(() -> new NoSuchElementException("Scraper not found: " + scraperId));
        if (scraper.getWebhookUrl() == null || scraper.getWebhookUrl().isBlank())
            return Map.of("error", "Webhook URL is not configured.");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("scraper_id",     scraper.getId());
        payload.put("name",           scraper.getName());
        payload.put("status",         "test");
        payload.put("value",          scraper.getLastValue());
        payload.put("previous_value", scraper.getLastValue());
        payload.put("trigger",        "test");
        payload.put("run_at",         scraper.getLastRunAt());
        List<Map<String, Object>> extraFields = parseFields(scraper.getExtraFields());
        if (!extraFields.isEmpty()) {
            payload.put("extra_fields", extraFields.stream()
                .map(f -> (Map<String, Object>) Map.of("label", f.get("label"), "value", f.getOrDefault("lastValue", "—")))
                .collect(Collectors.toList()));
        }

        Object body = "slack".equals(scraper.getWebhookType())
            ? buildSlackPayload(scraper, payload, "test", null)
            : payload;

        try {
            restTemplate.postForEntity(scraper.getWebhookUrl(), jsonEntity(body), String.class);
            return Map.of("ok", true);
        } catch (Exception e) {
            return Map.of("error", e.getMessage());
        }
    }

    // We judge "does the value START with a number" rather than "does the value CONTAIN
    // a number" — otherwise product names like "Chestnut Pie Manju 9pk" get misclassified
    // as numeric because of a trailing quantity suffix, firing a bogus price-change alert.
    // Genuine numeric metrics that start with a number and are followed by a short
    // unit/description, like "81.8M subscribers", must still be recognized as numeric
    // (same rule as isNumericStr in the client's screens.jsx).
    private static final java.util.regex.Pattern NUMERIC_LEAD = java.util.regex.Pattern.compile(
        "[+-]?[$₩¥€]?\\s*[\\d,]+(\\.\\d+)?\\s*[a-zA-Z가-힣%°]{0,2}(\\s|$)"
    );

    private boolean looksNumeric(String v) {
        return v != null && NUMERIC_LEAD.matcher(v.trim()).lookingAt();
    }

    private void checkAndFireAlert(Scraper scraper, String currentValue, String previousValue, String runAt) {
        String trigger = null;
        double currentNum = 0, previousNum = 0, delta = 0;
        boolean isNumeric = false;

        try {
            if (looksNumeric(currentValue) && looksNumeric(previousValue)) {
                currentNum  = Double.parseDouble(currentValue.replaceAll("[^0-9.-]", ""));
                previousNum = Double.parseDouble(previousValue.replaceAll("[^0-9.-]", ""));
                delta       = currentNum - previousNum;
                isNumeric   = true;
            }
        } catch (NumberFormatException ignored) {}

        if (!isNumeric && Boolean.TRUE.equals(scraper.getAlertOnChange())) {
            if (!currentValue.equals(previousValue)) trigger = "on_change";
        }

        if (isNumeric) {
            if (scraper.getAlertDelta() != null && Math.abs(delta) > scraper.getAlertDelta()) {
                trigger = "delta_exceeded";
            }
            if (scraper.getAlertRangeMin() != null || scraper.getAlertRangeMax() != null) {
                boolean belowMin = scraper.getAlertRangeMin() != null && currentNum < scraper.getAlertRangeMin();
                boolean aboveMax = scraper.getAlertRangeMax() != null && currentNum > scraper.getAlertRangeMax();
                if (belowMin || aboveMax) trigger = trigger == null ? "out_of_range" : trigger + ",out_of_range";
            }
        }

        if (trigger == null) return;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("scraper_id",      scraper.getId());
        payload.put("name",            scraper.getName());
        payload.put("url",             scraper.getUrl());
        payload.put("status",          "healthy");
        payload.put("value",           currentValue);
        payload.put("previous_value",  previousValue);
        payload.put("trigger",         trigger);
        if (isNumeric) payload.put("delta", Math.round(delta * 10000.0) / 10000.0);
        payload.put("run_at",          runAt);
        List<Map<String, Object>> extraFields = parseFields(scraper.getExtraFields());
        if (!extraFields.isEmpty()) {
            payload.put("extra_fields", extraFields.stream()
                .map(f -> (Map<String, Object>) Map.of("label", f.get("label"), "value", f.getOrDefault("lastValue", "—")))
                .collect(Collectors.toList()));
        }

        Object body = "slack".equals(scraper.getWebhookType())
            ? buildSlackPayload(scraper, payload, trigger, isNumeric ? delta : null)
            : payload;

        try {
            restTemplate.postForEntity(scraper.getWebhookUrl(), jsonEntity(body), String.class);
            log.info("[webhook] {} → {} (trigger={})", scraper.getName(), scraper.getWebhookUrl(), trigger);
        } catch (Exception e) {
            log.warn("[webhook] send failed {}: {}", scraper.getWebhookUrl(), e.getMessage());
        }
    }

    private void fireFailureAlert(Scraper scraper, String previousValue, String runAt) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("scraper_id",     scraper.getId());
        payload.put("name",           scraper.getName());
        payload.put("url",            scraper.getUrl());
        payload.put("status",         "failed");
        payload.put("value",          "—");
        payload.put("previous_value", previousValue);
        payload.put("trigger",        "scrape_failed");
        payload.put("run_at",         runAt);

        Object body = "slack".equals(scraper.getWebhookType())
            ? buildFailureSlackPayload(scraper, previousValue, runAt)
            : payload;

        try {
            restTemplate.postForEntity(scraper.getWebhookUrl(), jsonEntity(body), String.class);
            log.info("[webhook] {} → {} (trigger=scrape_failed)", scraper.getName(), scraper.getWebhookUrl());
        } catch (Exception e) {
            log.warn("[webhook] send failed {}: {}", scraper.getWebhookUrl(), e.getMessage());
        }
    }

    private Map<String, Object> buildFailureSlackPayload(Scraper scraper, String previousValue, String runAt) {
        StringBuilder sb = new StringBuilder();
        sb.append("🚨 *DOMA scrape failed* — *").append(scraper.getName()).append("*\n");
        sb.append("*Failed to collect data due to a selector match failure.*\n");
        sb.append("*Last good value:* `").append(previousValue != null ? previousValue : "—").append("`\n");
        sb.append("*Collected at:* ").append(runAt).append("\n");
        sb.append("*URL:* ").append(scraper.getUrl());

        Map<String, Object> textObj = new LinkedHashMap<>();
        textObj.put("type", "mrkdwn");
        textObj.put("text", sb.toString());

        Map<String, Object> section = new LinkedHashMap<>();
        section.put("type", "section");
        section.put("text", textObj);

        Map<String, Object> slack = new LinkedHashMap<>();
        slack.put("text", "🚨 DOMA scrape failed — " + scraper.getName());
        slack.put("blocks", List.of(section));
        return slack;
    }

    private HttpEntity<Object> jsonEntity(Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }

    private Map<String, Object> buildSlackPayload(Scraper scraper, Map<String, Object> p, String trigger, Double delta) {
        String triggerLabel = switch (trigger) {
            case "on_change"      -> "Value changed";
            case "delta_exceeded" -> "Delta exceeded";
            case "out_of_range"   -> "Out of range";
            case "scrape_failed"  -> "Scrape failed";
            case "test"           -> "Test send";
            default               -> trigger;
        };
        StringBuilder sb = new StringBuilder();
        sb.append("🔔 *DOMA alert* — *").append(scraper.getName()).append("*\n");
        sb.append("*Trigger:* `").append(triggerLabel).append("`\n");
        sb.append("*Previous value:* `").append(p.get("previous_value")).append("`  →  ");
        sb.append("*Current value:* `").append(p.get("value")).append("`");
        if (delta != null) {
            sb.append("  (*Δ* ").append(delta >= 0 ? "+" : "").append(String.format("%.4f", delta)).append(")");
        }
        Object extraFieldsObj = p.get("extra_fields");
        if (extraFieldsObj instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> f) {
                    sb.append("\n*").append(f.get("label")).append(":* `").append(f.get("value")).append("`");
                }
            }
        }
        sb.append("\n*Collected at:* ").append(p.get("run_at"));
        sb.append("\n*URL:* ").append(scraper.getUrl());

        Map<String, Object> textObj = new LinkedHashMap<>();
        textObj.put("type", "mrkdwn");
        textObj.put("text", sb.toString());

        Map<String, Object> section = new LinkedHashMap<>();
        section.put("type", "section");
        section.put("text", textObj);

        Map<String, Object> slack = new LinkedHashMap<>();
        slack.put("text", "🔔 DOMA alert — " + scraper.getName()); // fallback (notification preview)
        slack.put("blocks", List.of(section));
        return slack;
    }

    // ── Result lookup ──────────────────────────────────────────────────────────

    public List<ScrapeResult> listResults(String scraperId) {
        return scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc(scraperId);
    }

    public List<ScrapeResult> queryResults(String id, String from, String to, String status, int limit) {
        return scrapeResultRepository.query(id, from, to, status, Math.min(limit, 1000));
    }

    /** ScrapeResult.extraValues is stored on the entity as a JSON string — serializing it
     * as-is would send the frontend an escaped string instead of an array, so it must
     * always be parsed through this method before going out over the API. */
    public Map<String, Object> resultToDto(ScrapeResult r) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id",          r.getId());
        dto.put("scraperId",   r.getScraperId());
        dto.put("status",      r.getStatus());
        dto.put("value",       r.getValue());
        dto.put("extraValues", parseFields(r.getExtraValues()));
        dto.put("score",       r.getScore());
        dto.put("durationMs",  r.getDurationMs());
        dto.put("note",        r.getNote());
        dto.put("runAt",       r.getRunAt());
        return dto;
    }

    public List<Map<String, Object>> resultsToDto(List<ScrapeResult> list) {
        return list.stream().map(this::resultToDto).collect(Collectors.toList());
    }

    // ── Self-heal history ──────────────────────────────────────────────────────

    public List<HealProposal> listHealHistory(String scraperId) {
        return healProposalRepository.findByScraperIdOrderByCreatedAtDesc(scraperId);
    }

    public List<HealProposal> listAllHealHistory() {
        return healProposalRepository.findAllByOrderByCreatedAtDesc();
    }

    public List<Map<String, Object>> healHistoryToDto(List<HealProposal> list) {
        return list.stream().map(p -> {
            Map<String, Object> dto = new LinkedHashMap<>();
            dto.put("id",               p.getId());
            dto.put("scraperId",        p.getScraperId());
            dto.put("scraperName",      p.getScraperName());
            dto.put("fieldLabel",       p.getFieldLabel());
            dto.put("oldSelector",      p.getOldSelector());
            dto.put("proposedSelector", p.getProposedSelector());
            dto.put("extractedText",    p.getExtractedText());
            dto.put("confidence",       p.getConfidence());
            dto.put("reasoning",        p.getReasoning());
            dto.put("status",           p.getStatus());
            dto.put("createdAt",        p.getCreatedAt());
            dto.put("reviewedAt",       p.getReviewedAt().isEmpty() ? null : p.getReviewedAt());
            dto.put("reported",         p.isReported());
            dto.put("reportedAt",       p.getReportedAt().isEmpty() ? null : p.getReportedAt());
            return dto;
        }).collect(Collectors.toList());
    }

    // ── Stats ───────────────────────────────────────────────────────────────────

    public Map<String, Object> stats() {
        long activeFeeds = scraperRepository.countActive();
        long totalHealed = scraperRepository.sumHealedCount();
        long pendingCount = healProposalRepository.findByStatusOrderByCreatedAtDesc("pending").size();

        Long totalRaw   = scrapeResultRepository.countTotal7d();
        Long successRaw = scrapeResultRepository.countSuccess7d();
        Double avgMs    = scrapeResultRepository.avgDuration7d();

        long total   = totalRaw   != null ? totalRaw   : 0;
        long success = successRaw != null ? successRaw : 0;

        Double successRate = total > 0 ? Math.round((double) success / total * 10000) / 100.0 : null;

        List<Integer> durations = scrapeResultRepository.durations7d();
        Integer p95 = null;
        if (!durations.isEmpty()) {
            int idx = Math.min((int) Math.floor(durations.size() * 0.95), durations.size() - 1);
            p95 = durations.get(idx);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("activeFeedsCount", activeFeeds);
        result.put("successRate7d",    successRate);
        result.put("totalHealed",      totalHealed);
        result.put("pendingCount",     pendingCount);
        result.put("avgDurationMs",    avgMs != null ? Math.round(avgMs) : null);
        result.put("p95DurationMs",    p95);
        result.put("resultCount7d",    total);
        return result;
    }

    // ── Approval processing ────────────────────────────────────────────────────

    public Map<String, Object> approve(Long proposalId) {
        HealProposal p = healProposalRepository.findById(proposalId)
            .orElseThrow(() -> new NoSuchElementException("Approval request not found."));
        Scraper s = scraperRepository.findById(p.getScraperId())
            .orElseThrow(() -> new NoSuchElementException("Scraper not found."));

        if (p.getFieldLabel() == null) {
            // Primary field approval — unchanged existing logic
            double scoreVal = Math.round(p.getConfidence() * 1000.0) / 10.0;
            s.setStatus("healthy");
            s.setScore(scoreVal);
            s.setLastValue(p.getExtractedText().isEmpty() ? "—" : p.getExtractedText());
            s.setLastRunAt(LocalDateTime.now().format(FMT));
            s.setHealedCount(s.getHealedCount() + 1);
            s.setCssSelector(p.getProposedSelector());
        } else {
            // Extra field approval — doesn't touch primary status (status/score/lastValue)
            List<Map<String, Object>> fields = parseFields(s.getExtraFields());
            boolean found = false;
            for (Map<String, Object> f : fields) {
                if (p.getFieldLabel().equals(f.get("label"))) {
                    f.put("selector", p.getProposedSelector());
                    f.put("lastValue", p.getExtractedText().isEmpty() ? "—" : p.getExtractedText());
                    found = true;
                    break;
                }
            }
            if (found) {
                s.setExtraFields(listToJson(fields));
                s.setHealedCount(s.getHealedCount() + 1);
            } else {
                log.warn("[approve] {} — no matching extra field '{}' to approve (already deleted/changed), ignoring", s.getId(), p.getFieldLabel());
            }
        }
        scraperRepository.save(s);

        p.setStatus("approved");
        p.setReviewedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(p);

        return Map.of("ok", true, "scraper", toDto(s));
    }

    public Map<String, Object> reject(Long proposalId) {
        HealProposal p = healProposalRepository.findById(proposalId)
            .orElseThrow(() -> new NoSuchElementException("Approval request not found."));
        // Only set the scraper status to failed when rejecting a primary field proposal — rejecting an extra field doesn't affect primary
        if (p.getFieldLabel() == null) {
            Scraper s = scraperRepository.findById(p.getScraperId()).orElse(null);
            if (s != null) {
                s.setStatus("failed");
                s.setLastRunAt(LocalDateTime.now().format(FMT));
                scraperRepository.save(s);
            }
        }
        p.setStatus("rejected");
        p.setReviewedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(p);
        return Map.of("ok", true);
    }

    /**
     * A report that an already-applied (auto_approved/approved) self-heal result was wrong.
     * If the scraper is still using the reported selector, it's reverted to the
     * pre-report selector; if it has already changed to something else (re-healed or
     * manually edited), the live state is left untouched and only a false-positive
     * record is kept — this record is later used as model retraining data.
     */
    public Map<String, Object> reportHeal(Long proposalId) {
        HealProposal p = healProposalRepository.findById(proposalId)
            .orElseThrow(() -> new NoSuchElementException("Heal history not found."));

        if (!"auto_approved".equals(p.getStatus()) && !"approved".equals(p.getStatus())) {
            throw new IllegalStateException("Only an applied self-heal result can be reported.");
        }
        if (p.isReported()) {
            return Map.of("ok", true, "reverted", false);
        }

        boolean reverted = false;
        Scraper s = scraperRepository.findById(p.getScraperId()).orElse(null);
        if (s != null) {
            if (p.getFieldLabel() == null) {
                if (p.getProposedSelector().equals(s.getCssSelector())) {
                    s.setCssSelector(p.getOldSelector());
                    s.setStatus("failed");
                    s.setHealedCount(Math.max(0, s.getHealedCount() - 1));
                    scraperRepository.save(s);
                    reverted = true;
                }
            } else {
                List<Map<String, Object>> fields = parseFields(s.getExtraFields());
                for (Map<String, Object> f : fields) {
                    if (p.getFieldLabel().equals(f.get("label"))
                            && p.getProposedSelector().equals(String.valueOf(f.get("selector")))) {
                        f.put("selector", p.getOldSelector());
                        s.setExtraFields(listToJson(fields));
                        s.setHealedCount(Math.max(0, s.getHealedCount() - 1));
                        scraperRepository.save(s);
                        reverted = true;
                        break;
                    }
                }
            }
        }

        p.setReported(true);
        p.setReportedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(p);

        return Map.of("ok", true, "reverted", reverted, "scraper", s != null ? toDto(s) : Map.of());
    }

    /**
     * Exports every reported (reported=true) self-heal case for retraining data extraction.
     * Cases where HTML wasn't captured (from before the migration) are excluded from the
     * list and split out into skippedMissingHtmlIds. This always does a full re-export —
     * the server doesn't track an "already exported" state; the caller (the retraining
     * script) is expected to overwrite its data wholesale each time.
     */
    public Map<String, Object> exportReportedHeals() {
        List<HealProposal> reported = healProposalRepository.findByReportedTrueOrderByIdAsc();

        List<Map<String, Object>> items = new ArrayList<>();
        List<Long> skippedMissingHtmlIds = new ArrayList<>();

        for (HealProposal p : reported) {
            if (p.getV1Html() == null || p.getV2Html() == null) {
                skippedMissingHtmlIds.add(p.getId());
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id",               p.getId());
            item.put("scraperId",        p.getScraperId());
            item.put("scraperName",      p.getScraperName());
            item.put("fieldLabel",       p.getFieldLabel());
            item.put("oldSelector",      p.getOldSelector());
            item.put("proposedSelector", p.getProposedSelector());
            item.put("v1Html",           p.getV1Html());
            item.put("v2Html",           p.getV2Html());
            item.put("status",           p.getStatus());
            item.put("createdAt",        p.getCreatedAt());
            item.put("reportedAt",       p.getReportedAt());
            items.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count",                items.size());
        result.put("generatedAt",          LocalDateTime.now().format(FMT));
        result.put("items",                items);
        result.put("skippedMissingHtmlIds", skippedMissingHtmlIds);
        return result;
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    public Map<String, Object> toDto(Scraper s) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id",           s.getId());
        dto.put("name",         s.getName());
        dto.put("url",          s.getUrl());
        dto.put("css_selector", s.getCssSelector());
        dto.put("user_intent",  s.getUserIntent());
        dto.put("extra_fields", parseFields(s.getExtraFields()));
        dto.put("threshold",    s.getThreshold());
        dto.put("schedule",     SCHEDULE_LABELS.getOrDefault(s.getSchedule(), "Cron: " + s.getSchedule()));
        dto.put("scheduleKey",  s.getSchedule());
        dto.put("channels",     parseJson(s.getChannels()));
        dto.put("domain",       s.getDomain());
        dto.put("org",          s.getOrg());
        dto.put("owner",        s.getOwner());
        dto.put("status",       s.getStatus());
        dto.put("score",        s.getScore());
        dto.put("lastValue",    s.getLastValue());
        dto.put("lastRun",      s.getLastRunAt().isEmpty() ? "—" : s.getLastRunAt());
        dto.put("healed",       s.getHealedCount());
        dto.put("runs7d",       0);
        dto.put("spark",        List.of());
        dto.put("type",         s.getDomain());
        dto.put("altCategory",  DOMAIN_LABELS.getOrDefault(s.getDomain(), s.getDomain()));
        dto.put("delivery",     parseJson(s.getChannels()));
        dto.put("createdAt",      s.getCreatedAt());
        dto.put("webhookUrl",     s.getWebhookUrl());
        dto.put("webhookType",    s.getWebhookType() != null ? s.getWebhookType() : "generic");
        dto.put("alertOnChange",  s.getAlertOnChange());
        dto.put("alertDelta",     s.getAlertDelta());
        dto.put("alertRangeMin",  s.getAlertRangeMin());
        dto.put("alertRangeMax",  s.getAlertRangeMax());
        return dto;
    }

    private List<Double> sparkScores(String scraperId) {
        List<Double> all = scrapeResultRepository.findByScraperIdOrderByRunAtAsc(scraperId)
            .stream().map(ScrapeResult::getScore).collect(Collectors.toList());
        return all.subList(Math.max(0, all.size() - 20), all.size());
    }

    @SuppressWarnings("unchecked")
    private List<Object> parseJson(String json) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, List.class);
        } catch (Exception e) {
            return List.of();
        }
    }

    private String listToJson(List<?> list) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(list);
        } catch (Exception e) {
            return "[\"REST API\"]";
        }
    }

    // ── Extra field (N) helpers ────────────────────────────────────────────────

    /** Both Scraper.extraFields ([{label,selector,lastValue}]) and ScrapeResult.extraValues
     * ([{label,value}]) are parsed through this method — they only need to share the shape
     * "a JSON array of objects with a label". */
    public List<Map<String, Object>> parseFields(String json) {
        if (json == null || json.isBlank()) return new ArrayList<>();
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                json,
                new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    /** raw is the [{label, selector}, ...] shape sent by the frontend. Entries with an empty
     * label/selector are dropped, and lastValue is reset to "—" every time (re-selecting a
     * selector invalidates the existing value — same policy as in the old single-field days). */
    @SuppressWarnings("unchecked")
    private String normalizeExtraFieldsJson(Object raw) {
        if (!(raw instanceof List<?> list) || list.isEmpty()) return null;
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> m = (Map<String, Object>) rawMap;
            String label = String.valueOf(m.getOrDefault("label", "")).trim();
            String selector = String.valueOf(m.getOrDefault("selector", "")).trim();
            if (label.isEmpty() || selector.isEmpty()) continue;
            Map<String, Object> field = new LinkedHashMap<>();
            field.put("label", label);
            field.put("selector", selector);
            field.put("lastValue", "—");
            fields.add(field);
        }
        return fields.isEmpty() ? null : listToJson(fields);
    }
}
