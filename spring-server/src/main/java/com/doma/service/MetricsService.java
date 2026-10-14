package com.doma.service;

import com.doma.domain.HealProposal;
import com.doma.domain.Scraper;
import com.doma.repository.HealProposalRepository;
import com.doma.repository.ScrapeResultRepository;
import com.doma.repository.ScraperRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The numbers this project is judged on, kept apart from /api/stats (which is what
 * the dashboard header shows and counts everything that runs).
 *
 * Two decisions shape everything here:
 *
 * Demo scrapers are excluded. A single 30-second rehearsal scraper produced about
 * 20,000 of one week's 22,940 runs, so including it turned the success rate into a
 * measure of that scraper instead of the feeds that matter.
 *
 * Heal accuracy leads with durability, not reports. A report is the only direct
 * evidence that a heal was wrong, and there are none — reported alone would read as
 * 100% accurate, a claim nobody has checked. Durability (did the healed selector
 * keep collecting?) is observable without anyone reviewing, and "unverified" says
 * out loud how much of the applied set has neither.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MetricsService {

    private final ScraperRepository scraperRepository;
    private final ScrapeResultRepository scrapeResultRepository;
    private final HealProposalRepository healProposalRepository;

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** Statuses that mean the healed selector actually went live. */
    private static final List<String> APPLIED = List.of("auto_approved", "approved");

    /** A healed selector still collecting after this long is treated as holding up. */
    private static final int DURABLE_DAYS = 7;

    public Map<String, Object> metrics() {
        List<Scraper> all = scraperRepository.findAll();
        Set<String> demoIds = all.stream().filter(Scraper::isDemo)
            .map(Scraper::getId).collect(Collectors.toSet());

        List<HealProposal> heals = healProposalRepository.findAllByOrderByCreatedAtDesc().stream()
            .filter(h -> !demoIds.contains(h.getScraperId()))
            .collect(Collectors.toList());

        Map<String, Object> scope = new LinkedHashMap<>();
        scope.put("scrapersCounted", all.size() - demoIds.size());
        scope.put("demoExcluded", demoIds.size());

        Map<String, Object> collection = new LinkedHashMap<>();
        collection.put("7d", collectionWindow(7));
        collection.put("30d", collectionWindow(30));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("generatedAt", LocalDateTime.now().format(FMT));
        out.put("scope", scope);
        out.put("collection", collection);
        out.put("selfHealing", selfHealing(heals));
        out.put("humanWork", humanWork(heals));
        return out;
    }

    /** How much was collected, and what the failures were when it wasn't. */
    private Map<String, Object> collectionWindow(int days) {
        long runs = 0, success = 0;
        List<Object[]> totals = scrapeResultRepository.runTotals(days);
        if (!totals.isEmpty() && totals.get(0) != null) {
            runs = ((Number) totals.get(0)[0]).longValue();
            success = ((Number) totals.get(0)[1]).longValue();
        }

        Map<String, Long> failures = new LinkedHashMap<>();
        for (Object[] row : scrapeResultRepository.failureKinds(days)) {
            failures.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("runs", runs);
        m.put("success", success);
        m.put("successRate", runs > 0 ? round(success * 100.0 / runs) : null);
        // selector = the page rendered but the selector missed (what self-heal is for)
        // page_load / run_error = the page or the service never answered
        m.put("failures", failures);
        return m;
    }

    private Map<String, Object> selfHealing(List<HealProposal> heals) {
        Map<String, Long> byStatus = heals.stream().collect(Collectors.groupingBy(
            HealProposal::getStatus, LinkedHashMap::new, Collectors.counting()));
        List<HealProposal> applied = heals.stream()
            .filter(h -> APPLIED.contains(h.getStatus()))
            .collect(Collectors.toList());

        List<Long> runsHeld = new ArrayList<>();
        List<Long> daysHeld = new ArrayList<>();
        long durable = 0, unverified = 0;
        long reported = applied.stream().filter(HealProposal::isReported).count();

        for (HealProposal h : applied) {
            String start = (h.getReviewedAt() == null || h.getReviewedAt().isEmpty())
                ? h.getCreatedAt() : h.getReviewedAt();
            String end = windowEnd(heals, h, start);
            long successes = scrapeResultRepository
                .countByScraperIdAndStatusAndRunAtBetween(h.getScraperId(), "healthy", start, end);
            long held = daysBetween(start, end);

            runsHeld.add(successes);
            daysHeld.add(held);
            if (h.isReported()) continue;                       // known wrong
            if (held >= DURABLE_DAYS && successes > 0) durable++;
            else unverified++;                                  // neither proven nor disproven yet
        }

        Map<String, Object> durability = new LinkedHashMap<>();
        durability.put("appliedMeasured", applied.size());
        durability.put("medianSuccessfulRuns", median(runsHeld));
        durability.put("medianDaysHeld", median(daysHeld));
        durability.put("durableDays", DURABLE_DAYS);
        durability.put("heldUp", durable);
        durability.put("unverified", unverified);

        Map<String, Object> reports = new LinkedHashMap<>();
        reports.put("count", reported);
        reports.put("rateOfApplied", applied.isEmpty() ? null : round(reported * 100.0 / applied.size()));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("attempts", heals.size());
        m.put("byStatus", byStatus);
        m.put("autoApplied", byStatus.getOrDefault("auto_approved", 0L));
        m.put("manuallyApproved", byStatus.getOrDefault("approved", 0L));
        m.put("rejected", byStatus.getOrDefault("rejected", 0L));
        m.put("autoApplyRate", heals.isEmpty()
            ? null : round(byStatus.getOrDefault("auto_approved", 0L) * 100.0 / heals.size()));
        m.put("reported", reports);
        m.put("durability", durability);
        return m;
    }

    /** What the system cost a person: reviews, rejections, and picking elements again. */
    private Map<String, Object> humanWork(List<HealProposal> heals) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("approvals", heals.stream().filter(h -> "approved".equals(h.getStatus())).count());
        m.put("rejections", heals.stream().filter(h -> "rejected".equals(h.getStatus())).count());
        m.put("reselections", heals.stream().filter(h -> h.getResolvedSelector() != null).count());
        m.put("openNeedsUser", heals.stream().filter(h -> "needs_user".equals(h.getStatus())).count());
        return m;
    }

    /**
     * When this heal stopped being the live selector: the next record for the same
     * scraper and field that actually replaced it, or now if it is still in place.
     *
     * Only records that changed the selector count as the end — an applied heal, or
     * a person picking the element again. A rejected or given-up record leaves the
     * selector exactly as this heal left it, so the clock keeps running; treating
     * those as the end scored a 20-day-old heal as 0 successful runs in testing.
     */
    private String windowEnd(List<HealProposal> heals, HealProposal applied, String start) {
        String end = null;
        for (HealProposal other : heals) {
            if (other == applied) continue;
            if (!other.getScraperId().equals(applied.getScraperId())) continue;
            if (!sameField(other.getFieldLabel(), applied.getFieldLabel())) continue;
            if (!replacedTheSelector(other)) continue;
            String at = other.getCreatedAt();
            if (at == null || at.compareTo(start) <= 0) continue;
            if (end == null || at.compareTo(end) < 0) end = at;
        }
        return end != null ? end : LocalDateTime.now().format(FMT);
    }

    private static boolean replacedTheSelector(HealProposal h) {
        return APPLIED.contains(h.getStatus()) || h.getResolvedSelector() != null;
    }

    private static boolean sameField(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static long daysBetween(String from, String to) {
        try {
            return Duration.between(LocalDateTime.parse(from, FMT), LocalDateTime.parse(to, FMT)).toDays();
        } catch (Exception e) {
            return 0;
        }
    }

    private static Double median(List<Long> values) {
        if (values.isEmpty()) return null;
        List<Long> sorted = values.stream().sorted().collect(Collectors.toList());
        int n = sorted.size();
        double mid = n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
        return round(mid);
    }

    private static double round(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
