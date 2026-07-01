package com.doma.controller;

import com.doma.domain.Scraper;
import com.doma.domain.ScrapeResult;
import com.doma.service.ScraperService;
import com.doma.service.SchedulerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.beans.factory.annotation.Value;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ScraperController {

    private final ScraperService scraperService;
    private final SchedulerService schedulerService;
    private final RestTemplate restTemplate;

    @Value("${doma.scraper-service-url}")
    private String scraperServiceUrl;

    @GetMapping("/scrapers")
    public List<Map<String, Object>> list() {
        return scraperService.listAll();
    }

    @GetMapping("/scrapers/{id}")
    public ResponseEntity<?> get(@PathVariable String id) {
        return scraperService.getOne(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/scrapers")
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        if (!body.containsKey("name") || !body.containsKey("url")) {
            return ResponseEntity.badRequest().body(Map.of("error", "name, url 필드가 필요합니다."));
        }
        Scraper created = scraperService.create(body);
        schedulerService.addJob(created);
        return ResponseEntity.status(201).body(scraperService.toDto(created));
    }

    @DeleteMapping("/scrapers/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        schedulerService.removeJob(id);
        scraperService.delete(id);
        return Map.of("ok", true);
    }

    @PatchMapping("/scrapers/{id}/selector")
    public ResponseEntity<?> updateSelector(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String cssSelector = (String) body.get("css_selector");
        String userIntent  = (String) body.get("user_intent");
        return scraperService.updateSelector(id, cssSelector, userIntent)
            .map(updated -> {
                schedulerService.addJob(updated);
                // Node.js의 V1 스냅샷 삭제 요청
                try {
                    restTemplate.delete(scraperServiceUrl + "/internal/snapshot/" + id);
                } catch (Exception ignored) {}
                return ResponseEntity.ok(scraperService.toDto(updated));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/scrapers/{id}/run")
    public ResponseEntity<?> run(@PathVariable String id) {
        try {
            Map<String, Object> result = scraperService.run(id);
            return ResponseEntity.ok(Map.of(
                "result",  result,
                "scraper", scraperService.getOne(id).orElse(Map.of())
            ));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/scrapers/{id}/results")
    public ResponseEntity<?> results(@PathVariable String id) {
        if (scraperService.getOne(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(scraperService.listResults(id));
    }

    @GetMapping("/scrapers/{id}/results/csv")
    public ResponseEntity<String> resultsCsv(@PathVariable String id) {
        var scraperOpt = scraperService.getOne(id);
        if (scraperOpt.isEmpty()) return ResponseEntity.notFound().build();

        List<ScrapeResult> rows = scraperService.listResults(id);
        String esc = "";
        StringBuilder sb = new StringBuilder("﻿수집시각,상태,추출값,신뢰도,응답시간(ms),비고\r\n");
        for (ScrapeResult r : rows) {
            sb.append(r.getRunAt()).append(",")
              .append(r.getStatus()).append(",")
              .append("\"").append(r.getValue().replace("\"", "\"\"")).append("\",")
              .append(r.getScore()).append(",")
              .append(r.getDurationMs()).append(",")
              .append("\"").append(r.getNote().replace("\"", "\"\"")).append("\"\r\n");
        }
        return ResponseEntity.ok()
            .header("Content-Type", "text/csv; charset=utf-8")
            .header("Content-Disposition", "attachment; filename=\"" + id + "_results.csv\"")
            .body(sb.toString());
    }

    @GetMapping("/scrapers/{id}/snapshot")
    public ResponseEntity<?> snapshot(@PathVariable String id) {
        try {
            Map<?, ?> snap = restTemplate.getForObject(
                scraperServiceUrl + "/internal/snapshot/" + id, Map.class);
            return ResponseEntity.ok(snap);
        } catch (Exception e) {
            return ResponseEntity.status(404).body(Map.of("error", "V1 스냅샷 없음"));
        }
    }

    @GetMapping("/scheduler/status")
    public Map<String, Object> schedulerStatus() {
        return schedulerService.getStatus();
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return scraperService.stats();
    }

    @GetMapping("/settings")
    public Map<String, Object> settings(
        @Value("${doma.api-token:}") String token,
        @Value("${server.port:8080}") String port
    ) {
        return Map.of("apiToken", token, "baseUrl", "http://localhost:" + port);
    }

    // ── 외부 데이터 API (토큰 인증은 TokenAuthFilter에서 처리) ────────────────────

    @GetMapping("/v1/scrapers/{id}/data")
    public ResponseEntity<?> externalData(
        @PathVariable String id,
        @RequestParam(required = false) String from,
        @RequestParam(required = false) String to,
        @RequestParam(required = false) String status,
        @RequestParam(required = false, defaultValue = "100") int limit
    ) {
        var scraperOpt = scraperService.getOne(id);
        if (scraperOpt.isEmpty()) return ResponseEntity.notFound().build();
        Map<String, Object> s = scraperOpt.get();

        List<ScrapeResult> data = scraperService.queryResults(id, from, to, status, limit);
        return ResponseEntity.ok(Map.of(
            "scraper_id", id,
            "name",       s.get("name"),
            "url",        s.get("url"),
            "count",      data.size(),
            "data",       data
        ));
    }

    // ── Python AI 프록시 ─────────────────────────────────────────────────────────

    @Value("${doma.python-api-url}")
    private String pythonApiUrl;

    @PostMapping("/heal")
    public ResponseEntity<?> heal(@RequestBody Map<String, Object> body) {
        try {
            Map<?, ?> result = restTemplate.postForObject(
                pythonApiUrl + "/heal", body, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", "Python API 연결 실패: " + e.getMessage()));
        }
    }
}
