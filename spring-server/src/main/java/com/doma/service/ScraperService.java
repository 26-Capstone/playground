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

    // run()을 동시에 두 번 태우는 걸 막는 가드 — "지금 실행" 버튼이 스케줄 실행과 겹치거나,
    // updateSettings() 직후 재등록된 job이 smartInitialDelay=0으로 즉시 발동해 기존에
    // 돌고 있던 실행과 겹치는 두 경우 모두 여기서 막힌다.
    private final Set<String> runningIds = ConcurrentHashMap.newKeySet();

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

    // ── 삭제 ────────────────────────────────────────────────────────────────────

    @Transactional
    public void delete(String id) {
        healProposalRepository.deleteByScraperId(id);
        scrapeResultRepository.deleteByScraperId(id);
        scraperRepository.deleteById(id);
    }

    // ── 셀렉터 업데이트 ──────────────────────────────────────────────────────────

    /**
     * extraFields는 "전체 교체" 시맨틱이다 — 호출자가 유지하고 싶은 필드까지 포함해서
     * 매번 완전한 배열을 보내야 한다 (channels와 동일한 계약). null이면 보조 필드는
     * 건드리지 않고, 비어있지 않은(빈 배열 포함) 값이 오면 그 배열로 완전히 대체한다.
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
        if (!runningIds.add(scraperId)) {
            log.info("[run] {} — 이미 실행 중이라 건너뜀 (중복 실행 방지)", scraperId);
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
            .orElseThrow(() -> new NoSuchElementException("스크래퍼를 찾을 수 없습니다: " + scraperId));

        List<Map<String, Object>> extraFields = parseFields(scraper.getExtraFields());

        // Node.js 스크래퍼 서비스 호출
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

        if (result == null) throw new RuntimeException("Node.js 스크래퍼 응답 없음");

        String status     = (String) result.getOrDefault("status", "failed");
        String value      = (String) result.getOrDefault("value", "");
        String html       = (String) result.getOrDefault("html", "");
        int    durationMs = ((Number) result.getOrDefault("durationMs", 0)).intValue();
        String now        = LocalDateTime.now().format(FMT);
        boolean succeeded = "healthy".equals(status);

        // 보조 필드 응답 병합 — Node가 입력 순서를 보장하므로 인덱스 기준 매칭
        // (라벨 유일성에 의존하지 않기 위함. 라벨 기준 매칭은 approve()에서만 사용)
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

        // 결과 저장
        ScrapeResult sr = new ScrapeResult();
        sr.setScraperId(scraperId);
        sr.setStatus(status);
        sr.setValue(value);
        sr.setExtraValues(snapshotExtraValues.isEmpty() ? null : listToJson(snapshotExtraValues));
        sr.setScore(succeeded ? 99.0 : 0.0);
        sr.setDurationMs(durationMs);
        sr.setNote(succeeded ? "정상 수집 — " + value : "셀렉터 매칭 실패");
        scrapeResultRepository.save(sr);

        // 스크래퍼 상태 업데이트 (primary 결과만 반영 — 보조 필드는 status/score에 영향 없음)
        double recentScore = scrapeResultRepository
            .findTop50ByScraperIdOrderByRunAtDesc(scraperId)
            .stream().findFirst().map(ScrapeResult::getScore).orElse(0.0);

        String previousValue = scraper.getLastValue(); // setLastValue 전에 캡처

        scraper.setStatus(succeeded ? "healthy" : "healing");
        scraper.setScore(recentScore);
        scraper.setLastValue(succeeded ? value : "—");
        scraper.setLastRunAt(now);
        scraperRepository.save(scraper);

        // primary 또는 보조 필드 중 하나라도 깨졌으면 자가치유 비동기 시도 (단일 스레드에서 순차 처리)
        boolean primaryBroken = !succeeded;
        if ((primaryBroken || !brokenExtraLabels.isEmpty()) && !html.isEmpty()) {
            new Thread(() -> healService.tryHeal(scraperId, html, primaryBroken, brokenExtraLabels)).start();
        }

        // 알람 판정 및 webhook 발송 (primary 기준)
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

    // "값에 숫자가 섞여 있는가"가 아니라 "값이 숫자로 시작하는가"로 판단한다 — 안 그러면
    // "통밤파이만주9입"처럼 끝에 수량 표기가 붙은 상품명이 숫자값으로 오판돼 가격 변동
    // 알림이 잘못 나간다. "81.8M subscribers"처럼 숫자로 시작하고 짧은 단위/설명이 뒤에
    // 붙는 진짜 수치 지표는 계속 숫자로 인정돼야 한다(client screens.jsx의 isNumericStr와 동일 기준).
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
        Object extraFieldsObj = p.get("extra_fields");
        if (extraFieldsObj instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> f) {
                    sb.append("\n*").append(f.get("label")).append(":* `").append(f.get("value")).append("`");
                }
            }
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

    /** ScrapeResult.extraValues는 엔티티에 JSON 문자열로 저장돼 있다 — 그대로 직렬화하면
     * 프론트가 배열이 아니라 이스케이프된 문자열을 받게 되므로, API로 나갈 땐 항상
     * 이 메서드로 파싱해서 내보내야 한다. */
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

    // ── 자가치유 이력 ────────────────────────────────────────────────────────────

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
            return dto;
        }).collect(Collectors.toList());
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

        if (p.getFieldLabel() == null) {
            // primary 필드 승인 — 기존 로직 그대로
            double scoreVal = Math.round(p.getConfidence() * 1000.0) / 10.0;
            s.setStatus("healthy");
            s.setScore(scoreVal);
            s.setLastValue(p.getExtractedText().isEmpty() ? "—" : p.getExtractedText());
            s.setLastRunAt(LocalDateTime.now().format(FMT));
            s.setHealedCount(s.getHealedCount() + 1);
            s.setCssSelector(p.getProposedSelector());
        } else {
            // 보조 필드 승인 — primary 상태(status/score/lastValue)는 건드리지 않음
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
                log.warn("[approve] {} — 보조 필드 '{}' 승인 대상 없음(이미 삭제/변경됨), 무시", s.getId(), p.getFieldLabel());
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
            .orElseThrow(() -> new NoSuchElementException("승인 요청을 찾을 수 없습니다."));
        // primary 필드 제안 거절 시에만 스크래퍼 상태를 failed로 — 보조 필드 거절은 primary에 영향 없음
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

    // ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

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

    // ── 보조 필드(N개) 헬퍼 ─────────────────────────────────────────────────────

    /** Scraper.extraFields([{label,selector,lastValue}])와 ScrapeResult.extraValues([{label,value}])
     * 둘 다 이 메서드로 파싱한다 — 둘 다 "라벨을 가진 객체의 JSON 배열"이라는 형태만 공유하면 됨. */
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

    /** raw는 프론트가 보낸 [{label, selector}, ...] 형태. 라벨/셀렉터가 비어있는 항목은 버리고,
     * 매번 lastValue를 "—"로 리셋한다(선택자 재선택 시 기존 값은 무효화 — 기존 단일 필드 시절과 동일한 정책). */
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
