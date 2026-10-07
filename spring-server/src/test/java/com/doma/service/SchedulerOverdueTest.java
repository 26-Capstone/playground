package com.doma.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Whether a scheduled run failed to happen at all. The grace period has to clear
 * the 15-minute spread window, or a scraper holding a late slot would look overdue
 * the moment its tick passed.
 */
class SchedulerOverdueTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 7, 12, 0, 0);

    private static long overdue(String schedule, LocalDateTime lastRun) {
        return SchedulerService.overdueMinutes(schedule, lastRun.format(
            java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), NOW);
    }

    @Test
    void aRunInsideTheGraceWindowIsNotLate() {
        // 15m scraper last ran 30 min ago: due 15 min ago, still inside the 20 min grace.
        assertThat(overdue("15m", NOW.minusMinutes(30))).isZero();
    }

    @Test
    void aRunPastTheGraceWindowIsLate() {
        assertThat(overdue("15m", NOW.minusMinutes(90))).isEqualTo(75);
    }

    @Test
    void hourlyIsMeasuredFromItsOwnPeriod() {
        assertThat(overdue("hourly", NOW.minusMinutes(70))).isZero();        // due 10 min ago
        assertThat(overdue("hourly", NOW.minusHours(3))).isEqualTo(120);
    }

    @Test
    void aDailyScraperIsLateOnlyAfterItsNextNineAM() {
        // Yesterday 09:00, so the next due time is today 09:00 — three hours ago.
        assertThat(overdue("daily-9", NOW.minusDays(1).withHour(9).withMinute(0)))
            .isEqualTo(180);
        // Ran today at 09:10: the next due time is tomorrow, nothing is missing.
        assertThat(overdue("daily-9", NOW.withHour(9).withMinute(10))).isZero();
    }

    @Test
    void aSecondsLevelCronIsLateWithinTheHour() {
        // The demo scrapers use raw cron strings; a 30s scraper idle for an hour is late.
        assertThat(overdue("*/30 * * * * *", NOW.minusHours(1))).isEqualTo(59);
    }

    @Test
    void aScraperThatHasNeverRunIsNotReported() {
        // No baseline to measure against — it has never produced a run.
        assertThat(SchedulerService.overdueMinutes("15m", "", NOW)).isZero();
        assertThat(SchedulerService.overdueMinutes("15m", null, NOW)).isZero();
    }

    @Test
    void anUnparseableScheduleIsNotReported() {
        // buildTrigger rejected this schedule too, so no job was ever registered.
        assertThat(overdue("every other tuesday", NOW.minusDays(5))).isZero();
        assertThat(overdue("* * * * *", NOW.minusDays(5))).isZero(); // 5-field cron: rejected
    }
}
