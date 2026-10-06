package com.doma.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Offsets inside a shared tick. 16 scrapers sit on the default daily-9 schedule
 * and only one browser runs at a time, so what matters is that neighbours are
 * further apart than a scrape takes (5-17s) — a run that waits in the queue
 * spends its 75s budget there and is then recorded as a selector failure.
 */
class SchedulerJitterTest {

    private static final long WINDOW_MS = 15 * 60 * 1000;

    @Test
    void sixteenScrapersAreSpacedWiderThanAScrapeTakes() {
        List<String> peers = ids(16);
        List<Long> offsets = new ArrayList<>();
        for (String id : peers) offsets.add(SchedulerService.slotOffset(peers, id));
        offsets.sort(null);

        long smallestGap = WINDOW_MS;
        for (int i = 1; i < offsets.size(); i++) {
            smallestGap = Math.min(smallestGap, offsets.get(i) - offsets.get(i - 1));
        }
        assertThat(smallestGap).isEqualTo(WINDOW_MS / 16); // 56,250ms
        assertThat(offsets.get(0)).isZero();
        assertThat(offsets.get(offsets.size() - 1)).isLessThan(WINDOW_MS);
    }

    @Test
    void offsetDoesNotDependOnTheOrderTheScrapersArriveIn() {
        // The peer list comes from a repository query, and a restart must not move
        // anyone's slot.
        List<String> peers = ids(9);
        List<String> shuffled = new ArrayList<>(peers);
        Collections.shuffle(shuffled, new java.util.Random(7));

        for (String id : peers) {
            assertThat(SchedulerService.slotOffset(shuffled, id))
                .isEqualTo(SchedulerService.slotOffset(peers, id));
        }
    }

    @Test
    void aLoneScraperRunsOnTheTick() {
        assertThat(SchedulerService.slotOffset(List.of("cr_ij8w"), "cr_ij8w")).isZero();
    }

    @Test
    void anIdMissingFromItsOwnScheduleFallsBackToTheFirstSlot() {
        // Can happen between a schedule change and the repository read that follows it.
        assertThat(SchedulerService.slotOffset(ids(4), "cr_zzzz")).isZero();
    }

    /** Ids shaped like the real ones: "cr_" followed by four characters. */
    private static List<String> ids(int count) {
        String alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
        List<String> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            out.add(String.format("cr_%c%c%c%c",
                alphabet.charAt(i % 36),
                alphabet.charAt((i * 7 + 3) % 36),
                alphabet.charAt((i * 13 + 5) % 36),
                alphabet.charAt((i * 29 + 11) % 36)));
        }
        return out;
    }
}
