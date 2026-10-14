package com.doma.service;

import com.doma.domain.HealProposal;
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

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The metrics are what gets quoted about this project, so the two judgement calls
 * they encode are the things worth pinning: demo scrapers stay out, and an applied
 * heal only counts as accurate once it has actually kept collecting.
 */
@ExtendWith(MockitoExtension.class)
class MetricsServiceTest {

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Mock ScraperRepository scraperRepository;
    @Mock ScrapeResultRepository scrapeResultRepository;
    @Mock HealProposalRepository healProposalRepository;

    private MetricsService service;

    @BeforeEach
    void setUp() {
        service = new MetricsService(scraperRepository, scrapeResultRepository, healProposalRepository);
        lenient().when(scrapeResultRepository.runTotals(anyInt()))
            .thenReturn(List.<Object[]>of(new Object[]{100L, 95L}));
        lenient().when(scrapeResultRepository.failureKinds(anyInt()))
            .thenReturn(List.<Object[]>of(new Object[]{"selector", 3L}, new Object[]{"page_load", 2L}));
    }

    private Scraper scraper(String id, boolean demo) {
        Scraper s = new Scraper();
        s.setId(id);
        s.setName("scraper " + id);
        s.setDemo(demo);
        return s;
    }

    private HealProposal heal(String id, String status, LocalDateTime at) {
        HealProposal h = new HealProposal();
        h.setScraperId(id);
        h.setScraperName("scraper " + id);
        h.setStatus(status);
        h.setOldSelector(".old");
        h.setProposedSelector(".new");
        h.setCreatedAt(at.format(FMT));
        h.setReviewedAt(at.format(FMT));
        return h;
    }

    private void stubRepos(List<Scraper> scrapers, List<HealProposal> heals) {
        when(scraperRepository.findAll()).thenReturn(scrapers);
        when(healProposalRepository.findAllByOrderByCreatedAtDesc()).thenReturn(heals);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> sub(Map<String, Object> m, String... path) {
        Map<String, Object> cur = m;
        for (String p : path) cur = (Map<String, Object>) cur.get(p);
        return cur;
    }

    @Test
    void demoScrapersAreLeftOutOfScopeAndOfHealCounts() {
        LocalDateTime now = LocalDateTime.now();
        stubRepos(
            List.of(scraper("real1", false), scraper("real2", false), scraper("demo1", true)),
            List.of(heal("real1", "auto_approved", now.minusDays(30)),
                    heal("demo1", "auto_approved", now.minusDays(30))));
        lenient().when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(40L);

        Map<String, Object> m = service.metrics();

        assertThat(sub(m, "scope")).containsEntry("scrapersCounted", 2).containsEntry("demoExcluded", 1);
        // The demo scraper's heal must not inflate the attempt count.
        assertThat(sub(m, "selfHealing")).containsEntry("attempts", 1);
    }

    @Test
    void successRateAndFailureCausesComeFromTheWindowQueries() {
        stubRepos(List.of(scraper("real1", false)), List.of());

        Map<String, Object> m = service.metrics();
        Map<String, Object> week = sub(m, "collection", "7d");

        assertThat(week).containsEntry("runs", 100L).containsEntry("success", 95L)
            .containsEntry("successRate", 95.0);
        assertThat((Map<String, Long>) week.get("failures"))
            .containsEntry("selector", 3L)
            .containsEntry("page_load", 2L);
    }

    @Test
    void anAppliedHealThatKeptCollectingCountsAsHoldingUp() {
        LocalDateTime now = LocalDateTime.now();
        stubRepos(List.of(scraper("real1", false)),
            List.of(heal("real1", "auto_approved", now.minusDays(21))));
        when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            eq("real1"), eq("healthy"), anyString(), anyString())).thenReturn(300L);

        Map<String, Object> d = sub(service.metrics(), "selfHealing", "durability");

        assertThat(d).containsEntry("appliedMeasured", 1)
            .containsEntry("heldUp", 1L)
            .containsEntry("unverified", 0L)
            .containsEntry("medianSuccessfulRuns", 300.0);
        assertThat((Double) d.get("medianDaysHeld")).isGreaterThanOrEqualTo(20.0);
    }

    @Test
    void aHealTooRecentToJudgeIsUnverifiedRatherThanAccurate() {
        // Two days of success is not yet evidence that the selector holds.
        LocalDateTime now = LocalDateTime.now();
        stubRepos(List.of(scraper("real1", false)),
            List.of(heal("real1", "auto_approved", now.minusDays(2))));
        when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(20L);

        Map<String, Object> d = sub(service.metrics(), "selfHealing", "durability");

        assertThat(d).containsEntry("heldUp", 0L).containsEntry("unverified", 1L);
    }

    @Test
    void aReportedHealIsCountedAsWrongNotAsUnverified() {
        LocalDateTime now = LocalDateTime.now();
        HealProposal bad = heal("real1", "auto_approved", now.minusDays(30));
        bad.setReported(true);
        stubRepos(List.of(scraper("real1", false)), List.of(bad));
        lenient().when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(300L);

        Map<String, Object> heal = sub(service.metrics(), "selfHealing");

        assertThat(sub(heal, "reported")).containsEntry("count", 1L).containsEntry("rateOfApplied", 100.0);
        assertThat(sub(heal, "durability")).containsEntry("heldUp", 0L).containsEntry("unverified", 0L);
    }

    @Test
    void durabilityStopsAtTheNextHealOfTheSameField() {
        // The second heal replaced the first selector, so the first one's run only
        // counts up to that point — not up to today.
        LocalDateTime now = LocalDateTime.now();
        HealProposal first = heal("real1", "auto_approved", now.minusDays(30));
        HealProposal second = heal("real1", "auto_approved", now.minusDays(28));
        stubRepos(List.of(scraper("real1", false)), List.of(second, first));
        when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(10L);

        service.metrics();

        ArgumentCaptor<String> from = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> to = ArgumentCaptor.forClass(String.class);
        verify(scrapeResultRepository, times(2)).countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), from.capture(), to.capture());

        List<String> windows = new ArrayList<>();
        for (int i = 0; i < from.getAllValues().size(); i++) {
            windows.add(from.getAllValues().get(i) + " → " + to.getAllValues().get(i));
        }
        // The window that starts at the first heal must end at the second one.
        assertThat(windows).anySatisfy(w ->
            assertThat(w).contains(first.getCreatedAt()).contains(second.getCreatedAt()));
    }

    @Test
    void aRejectedHealInBetweenDoesNotStopTheClock() {
        // Rejecting a proposal leaves the selector exactly as the earlier heal left
        // it, so the earlier heal is still the one collecting. Counting the rejection
        // as the end scored a 20-day-old heal as zero successful runs.
        LocalDateTime now = LocalDateTime.now();
        HealProposal appliedEarlier = heal("real1", "auto_approved", now.minusDays(20));
        HealProposal rejectedLater = heal("real1", "rejected", now.minusDays(10));
        stubRepos(List.of(scraper("real1", false)), List.of(rejectedLater, appliedEarlier));
        when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(300L);

        Map<String, Object> d = sub(service.metrics(), "selfHealing", "durability");

        assertThat(d).containsEntry("heldUp", 1L).containsEntry("unverified", 0L);
        assertThat((Double) d.get("medianDaysHeld")).isGreaterThanOrEqualTo(19.0);
    }

    @Test
    void humanWorkCountsReviewsAndReselections() {
        LocalDateTime now = LocalDateTime.now();
        HealProposal reselected = heal("real1", "user_resolved", now.minusDays(5));
        reselected.setResolvedSelector(".picked-by-hand");
        stubRepos(List.of(scraper("real1", false)),
            List.of(heal("real1", "approved", now.minusDays(9)),
                    heal("real1", "rejected", now.minusDays(8)),
                    heal("real1", "needs_user", now.minusDays(6)),
                    reselected));
        lenient().when(scrapeResultRepository.countByScraperIdAndStatusAndRunAtBetween(
            anyString(), anyString(), anyString(), anyString())).thenReturn(5L);

        Map<String, Object> work = sub(service.metrics(), "humanWork");

        assertThat(work).containsEntry("approvals", 1L)
            .containsEntry("rejections", 1L)
            .containsEntry("reselections", 1L)
            .containsEntry("openNeedsUser", 1L);
    }
}
