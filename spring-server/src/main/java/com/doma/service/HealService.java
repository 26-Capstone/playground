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

    @SuppressWarnings("unchecked")
    public void tryHeal(String scraperId, String v2Html) {
        Scraper scraper = scraperRepository.findById(scraperId).orElse(null);
        if (scraper == null) return;

        // V1 스냅샷 조회
        String v1Html;
        try {
            Map<String, String> snap = restTemplate.getForObject(
                scraperServiceUrl + "/internal/snapshot/" + scraperId, Map.class);
            if (snap == null || snap.get("html") == null) {
                log.info("[healer] {} — V1 스냅샷 없음, 자가치유 건너뜀", scraper.getName());
                updateScraperFailed(scraper);
                return;
            }
            v1Html = snap.get("html");
        } catch (Exception e) {
            log.info("[healer] {} — V1 스냅샷 없음, 자가치유 건너뜀", scraper.getName());
            updateScraperFailed(scraper);
            return;
        }

        // Python AI 호출
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
            double scoreVal = Math.round(confidence * 1000.0) / 10.0;
            updateLastScore(scraperId, scoreVal);
            scraper.setStatus("healthy");
            scraper.setScore(scoreVal);
            scraper.setLastValue((String) result.getOrDefault("extracted_text", "—"));
            scraper.setLastRunAt(now);
            scraper.setHealedCount(scraper.getHealedCount() + 1);
            scraper.setCssSelector((String) result.getOrDefault("robust_selector", scraper.getCssSelector()));
            scraperRepository.save(scraper);
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
}
