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

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The watchdog reports runs that never arrived. It is the only check that can see
 * September's outage, where the scheduler kept firing into a broken browser for a
 * week and nothing was ever recorded.
 */
@ExtendWith(MockitoExtension.class)
class ScraperWatchdogTest {

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String OPS_HOOK = "https://hooks.slack.com/ops";

    @Mock ScraperRepository scraperRepository;
    @Mock ScrapeResultRepository scrapeResultRepository;
    @Mock HealProposalRepository healProposalRepository;
    @Mock HealService healService;
    @Mock RestTemplate restTemplate;

    private ScraperService service;

    @BeforeEach
    void setUp() {
        service = new ScraperService(scraperRepository, scrapeResultRepository,
            healProposalRepository, healService, restTemplate);
        ReflectionTestUtils.setField(service, "alertWebhookUrl", "");
    }

    private Scraper scraper(String id, String schedule, LocalDateTime lastRun, String webhook) {
        Scraper s = new Scraper();
        s.setId(id);
        s.setName("scraper " + id);
        s.setUrl("https://example.com/" + id);
        s.setCssSelector(".value");
        s.setSchedule(schedule);
        s.setLastRunAt(lastRun == null ? "" : lastRun.format(FMT));
        s.setWebhookUrl(webhook);
        return s;
    }

    private void registered(Scraper... all) {
        when(scraperRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(all));
    }

    private List<String> sentTexts() {
        ArgumentCaptor<HttpEntity<?>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, atLeastOnce()).postForEntity(anyString(), captor.capture(), eq(Void.class));
        List<String> out = new ArrayList<>();
        for (HttpEntity<?> e : captor.getAllValues()) out.add(String.valueOf(e.getBody()));
        return out;
    }

    @Test
    void oneLateScraperIsReportedOnItsOwnWebhook() {
        LocalDateTime now = LocalDateTime.now();
        registered(
            scraper("a", "15m", now.minusHours(2), "https://hooks.slack.com/a"), // 105 min late
            scraper("b", "15m", now, null),
            scraper("c", "hourly", now, null),
            scraper("d", "15m", now, null),
            scraper("e", "15m", now, null));

        service.checkMissedRuns();

        verify(restTemplate).postForEntity(eq("https://hooks.slack.com/a"), any(), eq(Void.class));
        assertThat(sentTexts().get(0))
            .contains("missed run")
            .contains("scraper a")
            .contains("min late");
    }

    @Test
    void anOutageHittingEverythingSendsOneGroupedAlert() {
        // September's shape: every scraper stops at once. Twenty separate messages
        // would bury the one fact that matters.
        LocalDateTime now = LocalDateTime.now();
        Scraper[] all = new Scraper[10];
        for (int i = 0; i < all.length; i++) {
            all[i] = scraper("s" + i, "15m", now.minusHours(5), "https://hooks.slack.com/" + i);
        }
        registered(all);
        ReflectionTestUtils.setField(service, "alertWebhookUrl", OPS_HOOK);

        service.checkMissedRuns();

        verify(restTemplate, times(1)).postForEntity(eq(OPS_HOOK), any(), eq(Void.class));
        assertThat(sentTexts().get(0))
            .contains("collection stalled")
            .contains("10 of 10");
    }

    @Test
    void theSameOutageIsNotReportedOnEverySweep() {
        LocalDateTime now = LocalDateTime.now();
        registered(
            scraper("a", "15m", now.minusHours(2), OPS_HOOK),
            scraper("b", "15m", now, null),
            scraper("c", "15m", now, null),
            scraper("d", "15m", now, null));

        service.checkMissedRuns();
        service.checkMissedRuns();
        service.checkMissedRuns();

        verify(restTemplate, times(1)).postForEntity(anyString(), any(), eq(Void.class));
    }

    @Test
    void aScraperThatRecoversCanBeReportedAgainLater() {
        LocalDateTime now = LocalDateTime.now();
        Scraper late = scraper("a", "15m", now.minusHours(2), OPS_HOOK);
        Scraper other = scraper("b", "15m", now, null);
        registered(late, other);

        service.checkMissedRuns();                       // reported
        late.setLastRunAt(now.format(FMT));              // a run arrives
        service.checkMissedRuns();                       // nothing to report
        late.setLastRunAt(now.minusHours(3).format(FMT)); // stops again
        service.checkMissedRuns();                       // reported again

        verify(restTemplate, times(2)).postForEntity(anyString(), any(), eq(Void.class));
    }

    @Test
    void withNoWebhookAnywhereNothingIsSent() {
        // The log line is the only record; this must not throw.
        LocalDateTime now = LocalDateTime.now();
        registered(
            scraper("a", "15m", now.minusHours(2), null),
            scraper("b", "15m", now, null),
            scraper("c", "15m", now, null),
            scraper("d", "15m", now, null));

        service.checkMissedRuns();

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(Void.class));
    }

    @Test
    void aScraperWithNoSelectorIsSkipped() {
        // Never registered with the scheduler, so it is not late.
        LocalDateTime now = LocalDateTime.now();
        Scraper unscheduled = scraper("a", "15m", now.minusDays(3), OPS_HOOK);
        unscheduled.setCssSelector("");
        registered(unscheduled, scraper("b", "15m", now, null));

        service.checkMissedRuns();

        verify(restTemplate, never()).postForEntity(anyString(), any(), eq(Void.class));
    }
}
