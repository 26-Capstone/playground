package com.doma.service;

import com.doma.domain.Scraper;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScrapeResultRepository;
import com.doma.repository.ScraperRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * HealService의 자가치유 Slack 알림 로직(sendHealSlackAlert)만 검증한다.
 * 치유 판정 로직 자체는 기존 동작이라 다시 검증하지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class HealServiceTest {

    @Mock RestTemplate restTemplate;
    @Mock ScraperRepository scraperRepository;
    @Mock ScrapeResultRepository scrapeResultRepository;
    @Mock HealProposalRepository healProposalRepository;

    private HealService healService;
    private Scraper scraper;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        healService = new HealService(restTemplate, scraperRepository, scrapeResultRepository, healProposalRepository);
        ReflectionTestUtils.setField(healService, "scraperServiceUrl", "http://node-scraper");
        ReflectionTestUtils.setField(healService, "pythonApiUrl", "http://python-ai");

        scraper = new Scraper();
        scraper.setId("s1");
        scraper.setName("테스트 스크래퍼");
        scraper.setUrl("https://example.com");
        scraper.setCssSelector(".old-selector");
        scraper.setThreshold(50);
        scraper.setHealedCount(0);

        when(scraperRepository.findById("s1")).thenReturn(Optional.of(scraper));
        lenient().when(scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc("s1")).thenReturn(List.of());
        when(restTemplate.getForObject(contains("/internal/snapshot/"), eq(Map.class)))
            .thenReturn(Map.of("html", "<html>v1</html>"));
    }

    @SuppressWarnings("unchecked")
    private void stubHealResult(String status, double confidence) {
        when(restTemplate.postForObject(contains("/heal"), any(), eq(Map.class)))
            .thenReturn(Map.of(
                "status", status,
                "confidence", confidence,
                "robust_selector", ".new-selector",
                "extracted_text", "값",
                "reasoning", "이유"
            ));
    }

    @Test
    @SuppressWarnings("unchecked")
    void 자동복구시_슬랙알림이_발송된다() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("healed", 0.9); // threshold 0.5 이상

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString()).contains("자동복구 완료");
    }

    @Test
    @SuppressWarnings("unchecked")
    void 승인대기시_슬랙알림이_발송된다() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("healed", 0.3); // threshold 0.5 미달

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString()).contains("승인 대기");
    }

    @Test
    void webhookType가_generic이면_슬랙알림_발송안함() {
        scraper.setWebhookType("generic");
        scraper.setWebhookUrl("https://example.com/hook");
        stubHealResult("healed", 0.9);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }

    @Test
    void webhookUrl이_비어있으면_슬랙알림_발송안함() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("");
        stubHealResult("healed", 0.9);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }

    @Test
    void 치유실패시_슬랙알림_발송안함() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("failed", 0.0);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }
}
