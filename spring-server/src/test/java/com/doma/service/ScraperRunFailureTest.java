package com.doma.service;

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
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A run that never reaches the page must still be recorded. Before this, the
 * scraper service throwing meant nothing was written at all — no result row, no
 * status change, no alert — and the dashboard kept showing the last good value.
 */
@ExtendWith(MockitoExtension.class)
class ScraperRunFailureTest {

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
        scraper.setName("App store #1");
        scraper.setUrl("https://example.com/rank");
        scraper.setCssSelector(".name");
        scraper.setStatus("healthy");
        scraper.setLastValue("Muse from Meta");

        lenient().when(scraperRepository.findById("s1")).thenReturn(Optional.of(scraper));
        lenient().when(scraperRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(scrapeResultRepository.findTop50ByScraperIdOrderByRunAtDesc("s1"))
            .thenReturn(List.of());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aScraperServiceErrorIsRecordedAsAFailedRun() {
        when(restTemplate.postForObject(contains("/internal/run"), any(), eq(Map.class)))
            .thenThrow(new ResourceAccessException("Connection refused"));

        Map<String, Object> out = service.run("s1");

        assertThat(out).containsEntry("status", "failed");
        ArgumentCaptor<ScrapeResult> saved = ArgumentCaptor.forClass(ScrapeResult.class);
        verify(scrapeResultRepository).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("failed");
        assertThat(saved.getValue().getNote()).contains("Connection refused");
        assertThat(scraper.getStatus()).isEqualTo("failed");
        // Nothing to heal against: the page was never fetched.
        verify(healService, never()).tryHeal(anyString(), anyString(), anyBoolean(), anyList());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aPageThatNeverLoadedIsRecordedAsSuchAndNotHealed() {
        when(restTemplate.postForObject(contains("/internal/run"), any(), eq(Map.class)))
            .thenReturn(Map.of(
                "status", "failed",
                "value", "",
                "html", "",
                "durationMs", 46000,
                "error", "page.goto: Timeout 45000ms exceeded",
                "loadFailed", true));

        service.run("s1");

        ArgumentCaptor<ScrapeResult> saved = ArgumentCaptor.forClass(ScrapeResult.class);
        verify(scrapeResultRepository).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("failed");
        assertThat(saved.getValue().getNote())
            .contains("Could not load the page")
            .contains("Timeout 45000ms");
        // "healing" would claim a heal is under way; there is no V2 HTML for one.
        assertThat(scraper.getStatus()).isEqualTo("failed");
        verify(healService, never()).tryHeal(anyString(), anyString(), anyBoolean(), anyList());
    }

    @Test
    @SuppressWarnings("unchecked")
    void aSelectorFailureStillGoesToHealing() {
        when(restTemplate.postForObject(contains("/internal/run"), any(), eq(Map.class)))
            .thenReturn(Map.of(
                "status", "failed",
                "value", "",
                "html", "<html>v2</html>",
                "durationMs", 12000));

        service.run("s1");

        ArgumentCaptor<ScrapeResult> saved = ArgumentCaptor.forClass(ScrapeResult.class);
        verify(scrapeResultRepository).save(saved.capture());
        assertThat(saved.getValue().getNote()).isEqualTo("Selector match failed");
        assertThat(scraper.getStatus()).isEqualTo("healing");
    }
}
