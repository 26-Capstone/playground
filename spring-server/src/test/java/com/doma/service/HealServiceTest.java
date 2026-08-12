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
 * Verifies only HealService's self-heal Slack notification logic (sendHealSlackAlert).
 * The heal-decision logic itself is pre-existing behavior and is not re-verified here.
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
        scraper.setName("Test Scraper");
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
                "extracted_text", "Value",
                "reasoning", "Reason"
            ));
    }

    @Test
    @SuppressWarnings("unchecked")
    void slackAlertIsSentOnAutoRecovery() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("healed", 0.9); // threshold 0.5 or above

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString()).contains("Auto-recovery complete");
    }

    @Test
    @SuppressWarnings("unchecked")
    void slackAlertIsSentOnPendingApproval() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("healed", 0.3); // below threshold 0.5

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString()).contains("Pending approval");
    }

    @Test
    void noSlackAlertWhenWebhookTypeIsGeneric() {
        scraper.setWebhookType("generic");
        scraper.setWebhookUrl("https://example.com/hook");
        stubHealResult("healed", 0.9);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }

    @Test
    void noSlackAlertWhenWebhookUrlIsBlank() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("");
        stubHealResult("healed", 0.9);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }

    @Test
    void noSlackAlertWhenHealFails() {
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("failed", 0.0);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
    }
}
