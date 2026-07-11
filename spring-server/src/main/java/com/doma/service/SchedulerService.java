package com.doma.service;

import com.doma.domain.Scraper;
import com.doma.repository.ScraperRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.scheduling.support.PeriodicTrigger;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
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
        log.info("[scheduler] {}개 job 등록 완료", jobs.size());
    }

    // 기본 스케줄(예: daily-9)로 여러 스크래퍼를 만들면 전부 같은 틱에 몰려서 동시에
    // /internal/run을 호출한다 — 브라우저 세마포어(2개)/스레드풀(4개)이 감당 못 하면
    // 뒤로 갈수록 대기가 쌓이다 타임아웃까지 번진다. 스크래퍼 ID로 결정적 지터를 줘서
    // 몰림을 분산시킨다(같은 스크래퍼는 재시작해도 항상 같은 오프셋 → 스케줄이 들쭉날쭉해지지 않음).
    private static final long JITTER_MAX_MS = 3 * 60 * 1000; // 최대 3분

    public void addJob(Scraper scraper) {
        if (scraper.getCssSelector() == null || scraper.getCssSelector().isBlank()) return;

        Trigger trigger = buildTrigger(scraper.getSchedule(), scraper.getLastRunAt());
        if (trigger == null) return;

        removeJob(scraper.getId());

        long jitterMs = Math.floorMod(scraper.getId().hashCode(), JITTER_MAX_MS);

        // 트리거가 울리면 스레드를 붙잡고 sleep하는 대신, jitterMs 뒤로 실제 실행을
        // 한 번 더 예약만 하고 즉시 반환한다 — 지터 대기 중에도 풀 스레드가 묶이지 않는다.
        ScheduledFuture<?> future = taskScheduler.schedule(
            () -> taskScheduler.schedule(
                () -> {
                    log.info("[scheduler] {} 실행 시작", scraper.getName());
                    try {
                        scraperService.run(scraper.getId());
                    } catch (Exception e) {
                        log.error("[scheduler] {} 실행 오류: {}", scraper.getName(), e.getMessage());
                    }
                },
                java.time.Instant.now().plusMillis(jitterMs)
            ),
            trigger
        );
        jobs.put(scraper.getId(), future);
        log.info("[scheduler] {} → \"{}\" (+{}ms 지터) 등록", scraper.getName(), scraper.getSchedule(), jitterMs);
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
                    log.warn("[scheduler] 유효하지 않은 스케줄: \"{}\" (건너뜀)", schedule);
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
