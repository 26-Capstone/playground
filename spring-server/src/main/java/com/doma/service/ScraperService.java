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

    private static final DateTimeFormatter FMT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final Map<String, String> SCHEDULE_LABELS = Map.of(
        "daily-9", "매일 09:00",
        "hourly",  "매시간",
        "15m",     "15분마다"
    );

    private static final Map<String, String> DOMAIN_LABELS = Map.of(
        "commerce",   "소비 수요",
        "labor",      "노동 시장",
        "realestate", "부동산",
        "regulatory", "규제·공시",
        "media",      "미디어",
        "finance",    "금융"
    );

    // ── 목록 ────────────────────────────────────────────────────────────────────

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

    // ── 생성 ────────────────────────────────────────────────────────────────────

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
        s.setExtraSelector((String) body.get("extra_selector"));
        s.setExtraLabel((String) body.get("extra_label"));
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

    // ── 삭제 ────────────────────────────────────────────────────────────────────

    @Transactional
    public void delete(String id) {
        healProposalRepository.deleteByScraperId(id);
        scrapeResultRepository.deleteByScraperId(id);
        scraperRepository.deleteById(id);
    }

    // ── 셀렉터 업데이트 ──────────────────────────────────────────────────────────

    public Optional<Scraper> updateSelector(String id, String cssSelector, String userIntent,
                                             String extraSelector, String extraLabel) {
        return scraperRepository.findById(id).map(s -> {
            s.setCssSelector(cssSelector);
            if (userIntent != null) s.setUserIntent(userIntent);
            if (extraSelector != null) {
                s.setExtraSelector(extraSelector.isBlank() ? null : extraSelector);
                s.setExtraLabel(extraLabel);
                s.setLastExtraValue("—");
            }
            s.setStatus("pending");
            s.setScore(0.0);
            s.setLastValue("—");
            return scraperRepository.save(s);
        });
    }

    // ── 운영 설정 업데이트 (스케줄 · 임계값 · 채널) ──────────────────────────────

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

    // ── 즉시 실행 ────────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    public Map<String, Object> run(String scraperId) {
        Scraper scraper = scraperRepository.findById(scraperId)
            .orElseThrow(() -> new NoSuchElementException("스크래퍼를 찾을 수 없습니다: " + scraperId));

        // Node.js 스크래퍼 서비스 호출
        boolean extraConfigured = scraper.getExtraSelector() != null && !scraper.getExtraSelector().isBlank();
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("id",           scraper.getId());
        req.put("name",         scraper.getName());
        req.put("url",          scraper.getUrl());
        req.put("css_selector", scraper.getCssSelector());
        req.put("user_intent",  scraper.getUserIntent());
        if (extraConfigured) {
            req.put("extra_selector", scraper.getExtraSelector());
        }
        Map<String, Object> result = restTemplate.postForObject(
            scraperServiceUrl + "/internal/run", req, Map.class);

        if (result == null) throw new RuntimeException("Node.js 스크래퍼 응답 없음");

        String status     = (String) result.getOrDefault("status", "failed");
        String value      = (String) result.getOrDefault("value", "");
        String html       = (String) result.getOrDefault("html", "");
        int    durationMs = ((Number) result.getOrDefault("durationMs", 0)).intValue();
        String now        = LocalDateTime.now().format(FMT);
        boolean succeeded = "healthy".equals(status);

        // 보조 필드(있을 때만) — primary 성공/실패와 무관하게 독립적으로 처리
        String extraValue = (String) result.getOrDefault("extraValue", "");
        boolean extraSucceeded = extraConfigured && extraValue != null && !extraValue.isEmpty()
            && result.get("extraError") == null;

        // 결과 저장
        ScrapeResult sr = new ScrapeResult();
        sr.setScraperId(scraperId);
        sr.setStatus(status);
        sr.setValue(value);
        sr.setExtraValue(extraConfigured ? (extraValue != null ? extraValue : "") : "");
        sr.setScore(succeeded ? 99.0 : 0.0);
        sr.setDurationMs(durationMs);
        sr.setNote(succeeded ? "정상 수집 — " + value : "셀렉터 매칭 실패");
        scrapeResultRepository.save(sr);

        // 스크래퍼 상태 업데이트
        double recentScore = scrapeResultRepository
            .findTop50ByScraperIdOrderByRunAtDesc(scraperId)
            .stream().findFirst().map(ScrapeResult::getScore).orElse(0.0);

        String previousValue = scraper.getLastValue(); // setLastValue 전에 캡처

        scraper.setStatus(succeeded ? "healthy" : "healing");
        scraper.setScore(recentScore);
        scraper.setLastValue(succeeded ? value : "—");
        if (extraConfigured) {
            scraper.setLastExtraValue(extraSucceeded ? extraValue : "—");
        }
        scraper.setLastRunAt(now);
        scraperRepository.save(scraper);

        // 실패 시 자가치유 비동기 시도
        if (!succeeded && !html.isEmpty()) {
            new Thread(() -> healService.tryHeal(scraperId, html)).start();
        }

        // 알람 판정 및 webhook 발송
        if (succeeded && scraper.getWebhookUrl() != null && !scraper.getWebhookUrl().isBlank()) {
            new Thread(() -> checkAndFireAlert(scraper, value, previousValue, now)).start();
        }

        return result;
    }

    public Map<String, Object> testWebhook(String scraperId) {
        Scraper scraper = scraperRepository.findById(scraperId)
            .orElseThrow(() -> new NoSuchElementException("스크래퍼를 찾을 수 없습니다: " + scraperId));
        if (scraper.getWebhookUrl() == null || scraper.getWebhookUrl().isBlank())
            return Map.of("error", "webhook URL이 설정되지 않았습니다.");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("scraper_id",     scraper.getId());
        payload.put("name",           scraper.getName());
        payload.put("status",         "test");
        payload.put("value",          scraper.getLastValue());
        payload.put("previous_value", scraper.getLastValue());
        payload.put("trigger",        "test");
        payload.put("run_at",         scraper.getLastRunAt());
        if (scraper.getExtraLabel() != null && !scraper.getExtraLabel().isBlank()) {
            payload.put("extra_label", scraper.getExtraLabel());
            payload.put("extra_value", scraper.getLastExtraValue());
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

    private void checkAndFireAlert(Scraper scraper, String currentValue, String previousValue, String runAt) {
        String trigger = null;
        double currentNum = 0, previousNum = 0, delta = 0;
        boolean isNumeric = false;

        try {
            currentNum  = Double.parseDouble(currentValue.replaceAll("[^0-9.-]", ""));
            previousNum = Double.parseDouble(previousValue.replaceAll("[^0-9.-]", ""));
            delta       = currentNum - previousNum;
            isNumeric   = true;
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
        if (scraper.getExtraLabel() != null && !scraper.getExtraLabel().isBlank()) {
            payload.put("extra_label", scraper.getExtraLabel());
            payload.put("extra_value", scraper.getLastExtraValue());
        }

        Object body = "slack".equals(scraper.getWebhookType())
            ? buildSlackPayload(scraper, payload, trigger, isNumeric ? delta : null)
            : payload;

        try {
            restTemplate.postForEntity(scraper.getWebhookUrl(), jsonEntity(body), String.class);
            log.info("[webhook] {} → {} (trigger={})", scraper.getName(), scraper.getWebhookUrl(), trigger);
        } catch (Exception e) {
            log.warn("[webhook] 발송 실패 {}: {}", scraper.getWebhookUrl(), e.getMessage());
        }
    }

    private HttpEntity<Object> jsonEntity(Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }

    private Map<String, Object> buildSlackPayload(Scraper scraper, Map<String, Object> p, String trigger, Double delta) {
        String triggerLabel = switch (trigger) {
            case "on_change"      -> "값 변경";
            case "delta_exceeded" -> "변동폭 초과";
            case "out_of_range"   -> "범위 이탈";
            case "test"           -> "테스트 발송";
            default               -> trigger;
        };
        StringBuilder sb = new StringBuilder();
        sb.append("🔔 *DOMA 알람* — *").append(scraper.getName()).append("*\n");
        sb.append("*트리거:* `").append(triggerLabel).append("`\n");
        sb.append("*이전값:* `").append(p.get("previous_value")).append("`  →  ");
        sb.append("*현재값:* `").append(p.get("value")).append("`");
        if (delta != null) {
            sb.append("  (*Δ* ").append(delta >= 0 ? "+" : "").append(String.format("%.4f", delta)).append(")");
        }
        if (p.get("extra_label") != null) {
            sb.append("\n*").append(p.get("extra_label")).append(":* `").append(p.get("extra_value")).append("`");
        }
        sb.append("\n*수집 시각:* ").append(p.get("run_at"));
        sb.append("\n*URL:* ").append(scraper.getUrl());

        Map<String, Object> textObj = new LinkedHashMap<>();
        textObj.put("type", "mrkdwn");
        textObj.put("text", sb.toString());

        Map<String, Object> section = new LinkedHashMap<>();
        section.put("type", "section");
        section.put("text", textObj);

        Map<String, Object> slack = new LinkedHashMap<>();
        slack.put("text", "🔔 DOMA 알람 — " + scraper.getName()); // fallback (알림 미리보기)
        slack.put("blocks", List.of(section));
        return slack;
    }

    // ── 결과 조회 ────────────────────────────────────────────────────────────────

    public List<ScrapeResult> listResults(String scraperId) {
        return scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc(scraperId);
    }

    public List<ScrapeResult> queryResults(String id, String from, String to, String status, int limit) {
        return scrapeResultRepository.query(id, from, to, status, Math.min(limit, 1000));
    }

    // ── 통계 ────────────────────────────────────────────────────────────────────

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

    // ── 승인 처리 ────────────────────────────────────────────────────────────────

    public Map<String, Object> approve(Long proposalId) {
        HealProposal p = healProposalRepository.findById(proposalId)
            .orElseThrow(() -> new NoSuchElementException("승인 요청을 찾을 수 없습니다."));
        Scraper s = scraperRepository.findById(p.getScraperId())
            .orElseThrow(() -> new NoSuchElementException("스크래퍼를 찾을 수 없습니다."));

        double scoreVal = Math.round(p.getConfidence() * 1000.0) / 10.0;
        s.setStatus("healthy");
        s.setScore(scoreVal);
        s.setLastValue(p.getExtractedText().isEmpty() ? "—" : p.getExtractedText());
        s.setLastRunAt(LocalDateTime.now().format(FMT));
        s.setHealedCount(s.getHealedCount() + 1);
        s.setCssSelector(p.getProposedSelector());
        scraperRepository.save(s);

        p.setStatus("approved");
        p.setReviewedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(p);

        return Map.of("ok", true, "scraper", toDto(s));
    }

    public Map<String, Object> reject(Long proposalId) {
        HealProposal p = healProposalRepository.findById(proposalId)
            .orElseThrow(() -> new NoSuchElementException("승인 요청을 찾을 수 없습니다."));
        Scraper s = scraperRepository.findById(p.getScraperId()).orElse(null);
        if (s != null) {
            s.setStatus("failed");
            s.setLastRunAt(LocalDateTime.now().format(FMT));
            scraperRepository.save(s);
        }
        p.setStatus("rejected");
        p.setReviewedAt(LocalDateTime.now().format(FMT));
        healProposalRepository.save(p);
        return Map.of("ok", true);
    }

    // ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

    public Map<String, Object> toDto(Scraper s) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id",           s.getId());
        dto.put("name",         s.getName());
        dto.put("url",          s.getUrl());
        dto.put("css_selector", s.getCssSelector());
        dto.put("user_intent",  s.getUserIntent());
        dto.put("extra_selector", s.getExtraSelector());
        dto.put("extra_label",    s.getExtraLabel());
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
        dto.put("lastExtraValue", s.getLastExtraValue());
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
}
