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

    @PostConstruct
    public void init() {
        scraperRepository.findAllByOrderByCreatedAtDesc().forEach(this::addJob);
        log.info("[scheduler] {}개 job 등록 완료", jobs.size());
    }

    public void addJob(Scraper scraper) {
        if (scraper.getCssSelector() == null || scraper.getCssSelector().isBlank()) return;

        Trigger trigger = buildTrigger(scraper.getSchedule());
        if (trigger == null) return;

        removeJob(scraper.getId());

        ScheduledFuture<?> future = taskScheduler.schedule(
            () -> {
                log.info("[scheduler] {} 실행 시작", scraper.getName());
                try {
                    scraperService.run(scraper.getId());
                } catch (Exception e) {
                    log.error("[scheduler] {} 실행 오류: {}", scraper.getName(), e.getMessage());
                }
            },
            trigger
        );
        jobs.put(scraper.getId(), future);
        log.info("[scheduler] {} → \"{}\" 등록", scraper.getName(), scraper.getSchedule());
    }

    private Trigger buildTrigger(String schedule) {
        // 간격 기반: 등록 시점으로부터 N분 뒤 첫 실행, 이후 동일 간격 반복
        switch (schedule) {
            case "15m": {
                PeriodicTrigger t = new PeriodicTrigger(Duration.ofMinutes(15));
                t.setInitialDelay(Duration.ofMinutes(15));
                return t;
            }
            case "hourly": {
                PeriodicTrigger t = new PeriodicTrigger(Duration.ofHours(1));
                t.setInitialDelay(Duration.ofHours(1));
                return t;
            }
            default: {
                // 크론 표현식 (daily-9, 또는 custom cron)
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
