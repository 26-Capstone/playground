package com.doma.service;

import com.doma.domain.Scraper;
import com.doma.repository.ScraperRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.scheduling.support.PeriodicTrigger;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

@Slf4j
@Service
@RequiredArgsConstructor
public class SchedulerService {

    private final TaskScheduler taskScheduler;
    private final ScraperRepository scraperRepository;
    private final ScraperService scraperService;

    private final Map<String, ScheduledFuture<?>> jobs = new ConcurrentHashMap<>();

    private static final Map<String, String> CRON_MAP = Map.of(
        "daily-9", "0 0 9 * * *",
        "hourly",  "0 0 * * * *",
        "15m",     "0 */15 * * * *"
    );

    private Duration smartInitialDelay(String lastRunAt, Duration period) {
        if (lastRunAt == null || lastRunAt.isBlank()) return Duration.ZERO;
        try {
            LocalDateTime last = LocalDateTime.parse(lastRunAt,
                java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
            Duration elapsed   = Duration.between(last, LocalDateTime.now());
            Duration remaining = period.minus(elapsed);
            return remaining.isNegative() ? Duration.ZERO : remaining;
        } catch (Exception e) {
            return Duration.ZERO;
        }
    }

    @PostConstruct
    public void init() {
        scraperRepository.findAllByOrderByCreatedAtDesc().forEach(this::addJob);
        log.info("[scheduler] {} job(s) registered", jobs.size());
    }

    // If multiple scrapers use the default schedule (e.g. daily-9), they all pile
    // up on the same tick and call /internal/run at once — if the browser
    // semaphore (2 slots)/thread pool (4 threads) can't keep up, the backlog
    // grows until it spills into timeouts. We apply deterministic jitter based on
    // the scraper ID to spread out the pile-up (the same scraper always gets the
    // same offset even after a restart, so the schedule doesn't become erratic).
    // Widened from 3 minutes after node-scraper went down to one browser at a time
    // (2GB box, see docker-compose.yml): 16 scrapers share the default daily-9 tick,
    // and a scrape's 75s budget starts counting when the request arrives, not when a
    // browser frees up. With a 3-minute spread the tail of that queue spent its whole
    // budget waiting — today's catch-up burst ran a median of 36s against 5-17s a
    // week earlier, with three runs at the 76s ceiling — and a run that times out in
    // the queue is recorded as a selector failure even though the selector is fine.
    private static final long SPREAD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

    /**
     * Where this scraper starts inside the spread window: its place in the sorted
     * list of the scrapers sharing its schedule, as an even slice of the window.
     *
     * Hashing the id was the first attempt and isn't enough. For n offsets scattered
     * across a window the closest pair sits around window/n² apart — measured at
     * 3.5s for 16 scrapers — and two scrapes that close still queue behind the one
     * browser. A queued run spends its 75s budget waiting rather than loading the
     * page, and then gets recorded as a selector failure. Even slices put the same
     * 16 scrapers 56s apart, comfortably wider than the 5-17s a scrape takes.
     *
     * Adding or removing a scraper shifts its neighbours by a few seconds. That is
     * fine — these are offsets inside a tick, not times anything depends on.
     */
    static long slotOffset(List<String> peerIds, String scraperId) {
        List<String> sorted = peerIds.stream().sorted().collect(Collectors.toList());
        int count = Math.max(1, sorted.size());
        int index = Math.max(0, sorted.indexOf(scraperId));
        return (long) index * (SPREAD_WINDOW_MS / count);
    }

    /** Ids of every scraper on the same schedule, including this one. */
    private List<String> peersOn(String schedule) {
        return scraperRepository.findAllByOrderByCreatedAtDesc().stream()
            .filter(s -> schedule == null ? s.getSchedule() == null : schedule.equals(s.getSchedule()))
            .map(Scraper::getId)
            .collect(Collectors.toList());
    }

    public void addJob(Scraper scraper) {
        if (scraper.getCssSelector() == null || scraper.getCssSelector().isBlank()) return;

        Trigger trigger = buildTrigger(scraper.getSchedule(), scraper.getLastRunAt());
        if (trigger == null) return;

        removeJob(scraper.getId());

        long jitterMs = slotOffset(peersOn(scraper.getSchedule()), scraper.getId());

        // Instead of holding a thread and sleeping when the trigger fires, we just
        // schedule the actual run jitterMs later and return immediately — the pool
        // thread isn't tied up while waiting out the jitter.
        ScheduledFuture<?> future = taskScheduler.schedule(
            () -> taskScheduler.schedule(() -> runScraperJob(scraper), java.time.Instant.now().plusMillis(jitterMs)),
            trigger
        );
        jobs.put(scraper.getId(), future);
        log.info("[scheduler] {} → \"{}\" (+{}ms jitter) registered", scraper.getName(), scraper.getSchedule(), jitterMs);

        // Catch-up: a cron schedule (e.g. daily-9) doesn't notice on its own if it
        // missed a regular tick while the app was down, and will wait until the next
        // scheduled tick (up to a day). If there's an already-passed scheduled run
        // time based on lastRunAt, run a catch-up execution now. run()'s duplicate-run
        // guard is already in place, so it's safely skipped if another path happens
        // to be running at the same time.
        if (missedCronRun(scraper.getSchedule(), scraper.getLastRunAt())) {
            log.info("[scheduler] {} — missed run detected, scheduling catch-up run", scraper.getName());
            taskScheduler.schedule(() -> runScraperJob(scraper), java.time.Instant.now().plusMillis(jitterMs));
        }
    }

    private void runScraperJob(Scraper scraper) {
        log.info("[scheduler] {} run starting", scraper.getName());
        try {
            scraperService.run(scraper.getId());
        } catch (Exception e) {
            log.error("[scheduler] {} run error: {}", scraper.getName(), e.getMessage());
        }
    }

    /** For 15m/hourly, PeriodicTrigger's smartInitialDelay already compensates for
     * elapsed time. For cron schedules only, checks whether there's a scheduled
     * run time that has already passed since the last run. */
    private boolean missedCronRun(String schedule, String lastRunAt) {
        if ("15m".equals(schedule) || "hourly".equals(schedule)) return false;
        if (lastRunAt == null || lastRunAt.isBlank()) return false;
        String expr = CRON_MAP.getOrDefault(schedule, schedule);
        try {
            CronExpression cron = CronExpression.parse(expr);
            LocalDateTime last = LocalDateTime.parse(lastRunAt,
                java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
            LocalDateTime nextAfterLast = cron.next(last);
            return nextAfterLast != null && nextAfterLast.isBefore(LocalDateTime.now());
        } catch (Exception e) {
            return false;
        }
    }

    private Trigger buildTrigger(String schedule, String lastRunAt) {
        switch (schedule) {
            case "15m": {
                Duration period = Duration.ofMinutes(15);
                PeriodicTrigger t = new PeriodicTrigger(period);
                t.setInitialDelay(smartInitialDelay(lastRunAt, period));
                return t;
            }
            case "hourly": {
                Duration period = Duration.ofHours(1);
                PeriodicTrigger t = new PeriodicTrigger(period);
                t.setInitialDelay(smartInitialDelay(lastRunAt, period));
                return t;
            }
            default: {
                String expr = CRON_MAP.getOrDefault(schedule, schedule);
                try {
                    return new CronTrigger(expr);
                } catch (IllegalArgumentException e) {
                    log.warn("[scheduler] Invalid schedule: \"{}\" (skipping)", schedule);
                    return null;
                }
            }
        }
    }

    public void removeJob(String scraperId) {
        ScheduledFuture<?> f = jobs.remove(scraperId);
        if (f != null) f.cancel(false);
    }

    public Map<String, Object> getStatus() {
        Map<String, Object> result = new HashMap<>();
        jobs.forEach((id, f) -> {
            Map<String, Object> info = new HashMap<>();
            info.put("cancelled", f.isCancelled());
            info.put("done", f.isDone());
            result.put(id, info);
        });
        return result;
    }
}
