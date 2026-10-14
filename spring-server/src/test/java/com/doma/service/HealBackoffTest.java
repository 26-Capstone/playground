package com.doma.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The retry schedule for a selector that stays broken. Each attempt is an LLM call
 * at about $0.030, and a 30-second scraper would otherwise make 2,880 of them a day.
 */
class HealBackoffTest {

    @Test
    void theFirstAttemptIsNeverDelayed() {
        // Nothing has been tried yet — heal immediately.
        assertThat(HealService.backoffMinutes(0)).isZero();
    }

    @Test
    void theWaitDoublesWithEachAttempt() {
        assertThat(HealService.backoffMinutes(1)).isEqualTo(30);
        assertThat(HealService.backoffMinutes(2)).isEqualTo(60);
        assertThat(HealService.backoffMinutes(3)).isEqualTo(120);
        assertThat(HealService.backoffMinutes(4)).isEqualTo(240);
    }

    @Test
    void theWaitStopsGrowingAtOneDay() {
        assertThat(HealService.backoffMinutes(7)).isEqualTo(HealService.BACKOFF_MAX_MINUTES);
        assertThat(HealService.backoffMinutes(50)).isEqualTo(HealService.BACKOFF_MAX_MINUTES);
        // No overflow from the doubling at absurd attempt counts.
        assertThat(HealService.backoffMinutes(Integer.MAX_VALUE))
            .isEqualTo(HealService.BACKOFF_MAX_MINUTES);
    }

    @Test
    void aBrokenSelectorCostsAboutSixAttemptsOnTheFirstDay() {
        // 30m + 1h + 2h + 4h + 8h covers 15.5h; the sixth lands inside day one and
        // the cap takes over from there. Without this it would be 2,880 calls.
        long elapsed = 0;
        int attempts = 1;              // the first attempt happens right away
        while (true) {
            long wait = HealService.backoffMinutes(attempts);
            if (elapsed + wait > 24 * 60) break;
            elapsed += wait;
            attempts++;
        }
        assertThat(attempts).isBetween(5, 7);
    }
}
