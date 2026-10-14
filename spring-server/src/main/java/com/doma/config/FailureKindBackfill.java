package com.doma.config;

import com.doma.repository.ScrapeResultRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Fills ScrapeResult.failureKind for rows written before that column existed.
 *
 * The classification comes from the note text those rows already carry, which is
 * the only record of why they failed. Idempotent: it only touches rows where
 * failure_kind is still null, so later restarts do nothing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FailureKindBackfill implements ApplicationRunner {

    private final ScrapeResultRepository scrapeResultRepository;

    @Override
    public void run(ApplicationArguments args) {
        int filled = scrapeResultRepository.backfillFailureKind();
        if (filled > 0) {
            log.info("[migration] failure_kind backfilled on {} past failure row(s)", filled);
        }
    }
}
