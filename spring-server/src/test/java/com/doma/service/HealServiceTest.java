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
        ReflectionTestUtils.setField(healService, "appBaseUrl", "https://doma.example.com");

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
    @SuppressWarnings("unchecked")
    void alertIsSentWhenHealerGivesUp() {
        // This used to assert the opposite — a failed heal sent nothing, and the
        // scraper sat at status=failed until somebody opened the dashboard. That
        // is the one case where nothing will fix itself, so it is the one worth
        // interrupting a person for.
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("failed", 0.0);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString())
            .contains("pick the element again")
            .contains("/?scraper=s1");   // 사용자가 곧장 갈 수 있어야 알림이 쓸모 있다
    }

    @Test
    void noChangeNeededIsNotAFailureAndCallsNobody() {
        // The healer returns no_change_needed when the old selector still resolves
        // in the snapshot — the scrape failed for some other reason, most often a
        // page that moved between the run and the snapshot. A ranking page does
        // that on every refresh, so treating it as "could not heal" fired the
        // pick-the-element-again alert every time the top item changed.
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubHealResult("no_change_needed", 1.0);

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
        assertThat(scraper.getStatus()).isNotEqualTo("failed");
    }

    @Test
    @SuppressWarnings("unchecked")
    void confidentHealIsHeldForReviewWhenTheValueKindChanges() {
        // Confidence clears the bar, but '37억원' becoming '1' means the healer
        // landed on the row's rank badge. Auto-approving would overwrite the last
        // good value along with the selector.
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        scraper.setLastValue("37억원");
        when(restTemplate.postForObject(contains("/heal"), any(), eq(Map.class)))
            .thenReturn(Map.of("status", "healed", "confidence", 0.95,
                               "robust_selector", ".new-selector", "extracted_text", "1"));

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString())
            .contains("different field")
            .contains("/?view=approvals");
        // The selector must not have been swapped in.
        assertThat(scraper.getCssSelector()).isEqualTo(".old-selector");
    }

}
