package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.Scraper;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScrapeResultRepository;
import com.doma.repository.ScraperRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
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
     * primaryBroken/brokenExtraFieldLabels 중 깨진 것만 치유를 시도한다.
     * V1 스냅샷은 공용으로 한 번만 조회. primary 치유는 기존 로직 그대로(scraper의
     * status/score/lastValue를 갱신), 보조 필드 치유는 완전히 격리된 별도 경로로
     * 처리해서 서로의 결과가 덮어써지지 않도록 한다.
     */
    public void tryHeal(String scraperId, String v2Html, boolean primaryBroken, List<String> brokenExtraFieldLabels) {
        Scraper scraper = scraperRepository.findById(scraperId).orElse(null);
        if (scraper == null) return;

        // V1 스냅샷 조회
        String v1Html;
        try {
            Map<String, String> snap = restTemplate.getForObject(
                scraperServiceUrl + "/internal/snapshot/" + scraperId, Map.class);
            if (snap == null || snap.get("html") == null) {
                log.info("[healer] {} — V1 스냅샷 없음, 자가치유 건너뜀", scraper.getName());
                if (primaryBroken) updateScraperFailed(scraper);
                return;
            }
            v1Html = snap.get("html");
        } catch (Exception e) {
            log.info("[healer] {} — V1 스냅샷 없음, 자가치유 건너뜀", scraper.getName());
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
            log.error("[healer] {} — Python API 오류: {}", scraper.getName(), e.getMessage());
            updateScraperFailed(scraper);
            return;
        }

        if (result == null) { updateScraperFailed(scraper); return; }

        String status     = (String) result.getOrDefault("status", "failed");
        double confidence = ((Number) result.getOrDefault("confidence", 0)).doubleValue();
        double threshold  = scraper.getThreshold() / 100.0;
        String now        = LocalDateTime.now().format(FMT);

        if ("healed".equals(status) && confidence >= threshold) {
            // 신뢰도 충족 → 자동 복구
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
            saveHistoryEntry(scraper, null, oldSelector, result, confidence, now, "auto_approved");
            log.info("[healer] {} 자동 복구 완료 (신뢰도 {}%)", scraper.getName(), Math.round(confidence * 100));

        } else if ("healed".equals(status)) {
            // 신뢰도 미달 → 승인 큐 저장
            double scoreVal = Math.round(confidence * 1000.0) / 10.0;
            updateLastScore(scraperId, scoreVal);
            scraper.setStatus("pending");
            scraper.setScore(scoreVal);
            scraper.setLastValue("—");
            scraper.setLastRunAt(now);
            scraperRepository.save(scraper);

            HealProposal proposal = new HealProposal();
            proposal.setScraperId(scraperId);
            proposal.setScraperName(scraper.getName());
            proposal.setOldSelector(scraper.getCssSelector());
            proposal.setProposedSelector((String) result.getOrDefault("robust_selector", ""));
            proposal.setExtractedText((String) result.getOrDefault("extracted_text", ""));
            proposal.setConfidence(confidence);
            proposal.setReasoning((String) result.getOrDefault("reasoning", ""));
            healProposalRepository.save(proposal);
            log.info("[healer] {} 신뢰도 미달 ({}%) → 승인 큐 저장", scraper.getName(), Math.round(confidence * 100));

        } else {
            updateScraperFailed(scraper);
            log.info("[healer] {} 치유 불가 — {}", scraper.getName(), result.get("reason"));
        }
    }

    /**
     * 보조 필드 1개를 독립적으로 치유한다. primary 필드의 status/score/lastValue,
     * ScrapeResult.score는 절대 건드리지 않는다 — 보조 필드 실패가 정상 스크래퍼를
     * "failed"로 만들거나, 여러 필드가 순차 치유되며 서로의 confidence로 score를
     * 덮어쓰는 걸 막기 위함. 쓰기 직전에 스크래퍼를 다시 조회해서 race window를
     * 필드 1개(LLM 호출 1회) 분량으로 제한한다.
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
            log.info("[healer] {} — 보조 필드 '{}' 이미 삭제/변경됨, 치유 건너뜀", scraper.getName(), label);
            return;
        }
        String selector = String.valueOf(field.get("selector"));

        Map<String, Object> healReq = Map.of(
            "v1_html",      v1Html,
            "v2_html",      v2Html,
            "css_selector", selector,
            "user_intent",  scraper.getUserIntent() + " (보조 필드: " + label + ")",
            "target_name",  label
        );

        Map<String, Object> result;
        try {
            result = restTemplate.postForObject(pythonApiUrl + "/heal", healReq, Map.class);
        } catch (Exception e) {
            log.error("[healer] {} — 보조 필드 '{}' Python API 오류: {}", scraper.getName(), label, e.getMessage());
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
            saveHistoryEntry(scraper, label, selector, result, confidence,
                LocalDateTime.now().format(FMT), "auto_approved");
            log.info("[healer] {} 보조 필드 '{}' 자동 복구 완료 (신뢰도 {}%)", scraper.getName(), label, Math.round(confidence * 100));

        } else if ("healed".equals(status)) {
            HealProposal proposal = new HealProposal();
            proposal.setScraperId(scraperId);
            proposal.setScraperName(scraper.getName());
            proposal.setFieldLabel(label);
            proposal.setOldSelector(selector);
            proposal.setProposedSelector((String) result.getOrDefault("robust_selector", ""));
            proposal.setExtractedText((String) result.getOrDefault("extracted_text", ""));
            proposal.setConfidence(confidence);
            proposal.setReasoning((String) result.getOrDefault("reasoning", ""));
            healProposalRepository.save(proposal);
            log.info("[healer] {} 보조 필드 '{}' 신뢰도 미달 ({}%) → 승인 큐 저장", scraper.getName(), label, Math.round(confidence * 100));

        } else {
            log.info("[healer] {} 보조 필드 '{}' 치유 불가 — {}", scraper.getName(), label, result.get("reason"));
        }
    }

    /**
     * 승인 큐(HealProposal)는 원래 "대기 중인 제안"만 표현하도록 설계돼서, 자동 복구된
     * 건은 레코드 자체가 안 남았다 — 자가치유 이력 화면에서 자동 복구까지 함께 보려면
     * 이 경로도 같은 테이블에 (이미 처리 완료 상태로) 남겨야 한다.
     */
    private void saveHistoryEntry(Scraper scraper, String fieldLabel, String oldSelector,
                                   Map<String, Object> result, double confidence, String now, String status) {
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
        healProposalRepository.save(entry);
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
