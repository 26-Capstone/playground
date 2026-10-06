package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.ScrapeResult;
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
        // lenient: the missing-snapshot tests replace this stub with their own.
        lenient().when(restTemplate.getForObject(contains("/internal/snapshot/"), eq(Map.class)))
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
        // As in production: the failed run that triggered this heal has already
        // reset lastValue to "—", so the established value only survives in the
        // run history. Setting lastValue directly here is what let this guard ship
        // without ever firing.
        scraper.setLastValue("—");
        ScrapeResult lastGood = new ScrapeResult();
        lastGood.setValue("37억원");
        when(scrapeResultRepository.findFirstByScraperIdAndStatusOrderByRunAtDesc("s1", "healthy"))
            .thenReturn(Optional.of(lastGood));
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

    @Test
    @SuppressWarnings("unchecked")
    void confidentExtraFieldHealIsHeldForReviewWhenTheValueKindChanges() {
        // The failed run already wrote "—" into the field; the real value is in history.
        scraper.setExtraFields("[{\"label\":\"Price\",\"selector\":\".price\",\"lastValue\":\"—\"}]");
        ScrapeResult lastGood = new ScrapeResult();
        lastGood.setExtraValues("[{\"label\":\"Price\",\"value\":\"74,432원\"}]");
        when(scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc("s1")).thenReturn(List.of(lastGood));
        when(restTemplate.postForObject(contains("/heal"), any(), eq(Map.class)))
            .thenReturn(Map.of("status", "healed", "confidence", 0.95,
                               "robust_selector", ".rank-badge", "extracted_text", "1"));

        healService.tryHeal("s1", "<html>v2</html>", false, List.of("Price"));

        ArgumentCaptor<HealProposal> saved = ArgumentCaptor.forClass(HealProposal.class);
        verify(healProposalRepository).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("pending");
        assertThat(scraper.getExtraFields()).contains("\".price\"");
    }

    @Test
    void givingUpKeepsTheHtmlSoAReselectCanBecomeATrainingPair() {
        when(restTemplate.postForObject(contains("/heal"), any(), eq(Map.class)))
            .thenReturn(Map.of("status", "failed", "confidence", 0,
                               "reason", "LLM found no suitable node"));

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        ArgumentCaptor<HealProposal> saved = ArgumentCaptor.forClass(HealProposal.class);
        verify(healProposalRepository).save(saved.capture());
        HealProposal record = saved.getValue();
        assertThat(record.getStatus()).isEqualTo("needs_user");
        assertThat(record.getFieldLabel()).isNull();
        assertThat(record.getOldSelector()).isEqualTo(".old-selector");
        assertThat(record.getV1Html()).isEqualTo("<html>v1</html>");
        assertThat(record.getV2Html()).isEqualTo("<html>v2</html>");
        assertThat(record.getReasoning()).isEqualTo("LLM found no suitable node");
    }

    private void stubRecentRuns(String... statusesNewestFirst) {
        List<ScrapeResult> rows = new java.util.ArrayList<>();
        for (String s : statusesNewestFirst) {
            ScrapeResult r = new ScrapeResult();
            r.setStatus(s);
            rows.add(r);
        }
        when(scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc("s1")).thenReturn(rows);
    }

    @Test
    @SuppressWarnings("unchecked")
    void missingSnapshotAlertsInsteadOfFailingQuietly() {
        // Nothing to heal against, and the person is the only one who can fix it.
        when(restTemplate.getForObject(contains("/internal/snapshot/"), eq(Map.class)))
            .thenReturn(Map.of());
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubRecentRuns("failed", "healthy");

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForObject(contains("/heal"), any(), eq(Map.class));
        assertThat(scraper.getStatus()).isEqualTo("failed");

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString())
            .contains("No baseline snapshot")
            .contains("/?scraper=s1");
    }

    @Test
    @SuppressWarnings("unchecked")
    void missingSnapshotDoesNotRepeatTheAlertEveryRun() {
        // Already failing before this run, so the alert for this episode has gone out.
        when(restTemplate.getForObject(contains("/internal/snapshot/"), eq(Map.class)))
            .thenReturn(Map.of());
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");
        stubRecentRuns("failed", "failed");

        healService.tryHeal("s1", "<html>v2</html>", true, List.of());

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(String.class));
        assertThat(scraper.getStatus()).isEqualTo("failed");
    }

    @Test
    @SuppressWarnings("unchecked")
    void anUnrenderedPageSkipsHealingEntirely() {
        // The page came back as its own chrome with the list missing. Healing here
        // spends an LLM call on nav text and ends by asking someone to re-pick an
        // element the page does not contain.
        // The V1 snapshot stubbed in setUp never carried this notice; V2 is nothing
        // but chrome and a maintenance line. Sizes are covered in
        // HealServicePageCheckTest — here the point is that healing is skipped.
        scraper.setWebhookType("slack");
        scraper.setWebhookUrl("https://hooks.slack.com/test");

        healService.tryHeal("s1",
            "<html><body><nav>MUSINSA 검색 장바구니</nav><div>지금은 점검중이에요</div></body></html>",
            true, List.of("Price"));

        verify(restTemplate, never()).postForObject(contains("/heal"), any(), eq(Map.class));
        verify(healProposalRepository, never()).save(any());
        assertThat(scraper.getStatus()).isEqualTo("failed");

        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/test"), captor.capture(), eq(String.class));
        assertThat(captor.getValue().getBody().toString())
            .contains("Could not load the page")
            .contains("점검중")
            .doesNotContain("pick the element again");
    }

}
