package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.Scraper;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScrapeResultRepository;
import com.doma.repository.ScraperRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A person re-picking the primary element is the only production signal that says
 * what the right answer was. These cover when that re-pick is recorded as the
 * answer to an open break, and when it must not be.
 */
@ExtendWith(MockitoExtension.class)
class ScraperServiceReselectTest {

    @Mock ScraperRepository scraperRepository;
    @Mock ScrapeResultRepository scrapeResultRepository;
    @Mock HealProposalRepository healProposalRepository;
    @Mock HealService healService;
    @Mock RestTemplate restTemplate;

    private ScraperService service;
    private Scraper scraper;

    @BeforeEach
    void setUp() {
        service = new ScraperService(scraperRepository, scrapeResultRepository,
            healProposalRepository, healService, restTemplate);

        scraper = new Scraper();
        scraper.setId("s1");
        scraper.setName("Test Scraper");
        scraper.setUrl("https://example.com/ranking");
        scraper.setCssSelector(".old");
        scraper.setUserIntent("top1 product name");
        scraper.setStatus("failed");

        lenient().when(scraperRepository.findById("s1")).thenReturn(Optional.of(scraper));
        lenient().when(scraperRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private HealProposal record(String status, String createdAt) {
        HealProposal p = new HealProposal();
        p.setScraperId("s1");
        p.setScraperName("Test Scraper");
        p.setOldSelector(".old");
        p.setProposedSelector("needs_user".equals(status) ? "" : ".wrong");
        p.setStatus(status);
        p.setCreatedAt(createdAt);
        p.setV1Html("<html>v1</html>");
        p.setV2Html("<html>v2</html>");
        return p;
    }

    private void openRecords(HealProposal... newestFirst) {
        when(healProposalRepository
            .findByScraperIdAndFieldLabelIsNullAndResolvedSelectorIsNullAndStatusInOrderByCreatedAtDesc(
                eq("s1"), anyCollection()))
            .thenReturn(List.of(newestFirst));
    }

    @Test
    void reselectAfterTheHealerGaveUpBecomesALabelledPair() {
        HealProposal gaveUp = record("needs_user", "2026-09-15 10:00:00");
        openRecords(gaveUp);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(gaveUp.getResolvedSelector()).isEqualTo(".new");
        assertThat(gaveUp.getResolvedAt()).isNotEmpty();
        assertThat(gaveUp.getStatus()).isEqualTo("user_resolved");
        verify(healProposalRepository).save(gaveUp);
    }

    @Test
    void reselectIsNotAnAnswerOnceARunSucceededSinceTheBreak() {
        // The break this record captured went away on its own; its V2 HTML is not
        // the page the new selector was picked for.
        HealProposal gaveUp = record("needs_user", "2026-09-15 10:00:00");
        openRecords(gaveUp);
        when(scrapeResultRepository.existsByScraperIdAndStatusAndRunAtGreaterThan(
            "s1", "healthy", "2026-09-15 10:00:00")).thenReturn(true);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(gaveUp.getResolvedSelector()).isNull();
        assertThat(gaveUp.getStatus()).isEqualTo("superseded");
    }

    @Test
    void reselectWithAChangedIntentIsNotAnAnswer() {
        // A different intent means the user is tracking something else now, not
        // re-finding the target that moved.
        HealProposal gaveUp = record("needs_user", "2026-09-15 10:00:00");
        openRecords(gaveUp);

        service.updateSelector("s1", ".new", "cheapest product price", null);

        assertThat(gaveUp.getResolvedSelector()).isNull();
        assertThat(gaveUp.getStatus()).isEqualTo("superseded");
    }

    @Test
    void reselectOnAHealthyScraperIsNotAnAnswer() {
        // e.g. a later heal was auto-approved — that doesn't write a healthy run,
        // but the break is no longer open.
        scraper.setStatus("healthy");
        HealProposal gaveUp = record("needs_user", "2026-09-15 10:00:00");
        openRecords(gaveUp);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(gaveUp.getResolvedSelector()).isNull();
    }

    @Test
    void pendingProposalLeavesTheQueueSoItCannotOverwriteTheReselect() {
        HealProposal pending = record("pending", "2026-09-15 10:00:00");
        openRecords(pending);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(pending.getStatus()).isEqualTo("superseded");
        assertThat(pending.getReviewedAt()).isNotEmpty();
        // Still the answer: its proposedSelector is a known wrong one on the same page.
        assertThat(pending.getResolvedSelector()).isEqualTo(".new");
    }

    @Test
    void onlyTheNewestRecordGetsTheAnswerButEveryOpenOneIsClosed() {
        HealProposal gaveUp = record("needs_user", "2026-09-15 10:15:00");
        HealProposal olderPending = record("pending", "2026-09-15 10:00:00");
        openRecords(gaveUp, olderPending);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(gaveUp.getResolvedSelector()).isEqualTo(".new");
        assertThat(olderPending.getResolvedSelector()).isNull();
        assertThat(olderPending.getStatus()).isEqualTo("superseded");
    }

    @Test
    void rejectedRecordGetsTheAnswerButKeepsItsReview() {
        HealProposal rejected = record("rejected", "2026-09-15 10:00:00");
        openRecords(rejected);

        service.updateSelector("s1", ".new", "top1 product name", null);

        assertThat(rejected.getResolvedSelector()).isEqualTo(".new");
        assertThat(rejected.getStatus()).isEqualTo("rejected");
    }

    @Test
    void savingWithTheSamePrimarySelectorTouchesNoRecords() {
        // The same PATCH is used to edit only the extra fields.
        service.updateSelector("s1", ".old", "top1 product name", List.of());

        verifyNoInteractions(healProposalRepository);
    }

    @Test
    @SuppressWarnings("unchecked")
    void exportCarriesThePairAndSkipsRecordsWithoutHtml() {
        HealProposal pair = record("user_resolved", "2026-09-15 10:00:00");
        pair.setId(1L);
        pair.setResolvedSelector(".new");
        HealProposal noHtml = record("user_resolved", "2026-09-15 10:00:00");
        noHtml.setId(2L);
        noHtml.setResolvedSelector(".new");
        noHtml.setV2Html(null);
        when(healProposalRepository.findByResolvedSelectorIsNotNullOrderByIdAsc()).thenReturn(List.of(pair, noHtml));

        Map<String, Object> out = service.exportReselections();

        List<Map<String, Object>> items = (List<Map<String, Object>>) out.get("items");
        assertThat(items).hasSize(1);
        assertThat(items.get(0))
            .containsEntry("oldSelector", ".old")
            .containsEntry("resolvedSelector", ".new")
            .containsEntry("scraperUrl", "https://example.com/ranking");
        assertThat((List<Long>) out.get("skippedMissingHtmlIds")).containsExactly(2L);
    }
}
