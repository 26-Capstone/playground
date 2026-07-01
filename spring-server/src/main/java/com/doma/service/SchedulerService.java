package com.doma.service;

import com.doma.domain.Scraper;
import com.doma.repository.ScraperRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Service;

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

        String expr = CRON_MAP.getOrDefault(scraper.getSchedule(), scraper.getSchedule());
        try {
            new CronTrigger(expr); // validate
        } catch (IllegalArgumentException e) {
            log.warn("[scheduler] {} — 유효하지 않은 cron: \"{}\" (건너뜀)", scraper.getName(), expr);
            return;
        }

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
            new CronTrigger(expr)
        );
        jobs.put(scraper.getId(), future);
        log.info("[scheduler] {} → \"{}\" 등록", scraper.getName(), expr);
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
