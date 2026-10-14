package com.doma.controller;

import com.doma.service.MetricsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Performance metrics, deliberately separate from /api/stats.
 *
 * /api/stats is the dashboard header and counts everything that runs, demo
 * scrapers included. This endpoint answers "how is the system doing" — demo
 * scrapers excluded, failures split by cause, heal accuracy led by durability.
 * See MetricsService for why those choices.
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MetricsController {

    private final MetricsService metricsService;

    @GetMapping("/metrics")
    public Map<String, Object> metrics() {
        return metricsService.metrics();
    }
}
