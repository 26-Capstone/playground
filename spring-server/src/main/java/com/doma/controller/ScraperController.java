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

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
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
        String extraFieldsError = validateExtraFields(body.get("extra_fields"));
        if (extraFieldsError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", extraFieldsError));
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
        Object extraFields = body.get("extra_fields");
        String extraFieldsError = validateExtraFields(extraFields);
        if (extraFieldsError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", extraFieldsError));
        }
        return scraperService.updateSelector(id, cssSelector, userIntent, extraFields)
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

    @PatchMapping("/scrapers/{id}/settings")
    public ResponseEntity<?> updateSettings(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return scraperService.updateSettings(id, body)
            .map(updated -> {
                schedulerService.removeJob(id);
                schedulerService.addJob(updated);
                return ResponseEntity.ok(scraperService.toDto(updated));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/scrapers/{id}/webhook-test")
    public ResponseEntity<?> testWebhook(@PathVariable String id) {
        try {
            Map<String, Object> result = scraperService.testWebhook(id);
            if (result.containsKey("error"))
                return ResponseEntity.status(502).body(result);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/scrapers/{id}/run")
    public ResponseEntity<?> run(@PathVariable String id) {
        try {
            Map<String, Object> result = scraperService.run(id);
            if ("skipped".equals(result.get("status"))) {
                return ResponseEntity.status(409).body(Map.of("error", "이미 실행 중입니다."));
            }
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
        return ResponseEntity.ok(scraperService.resultsToDto(scraperService.listResults(id)));
    }

    @GetMapping("/scrapers/{id}/heal-history")
    public ResponseEntity<?> healHistory(@PathVariable String id) {
        if (scraperService.getOne(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(scraperService.healHistoryToDto(scraperService.listHealHistory(id)));
    }

    @GetMapping("/heal-history")
    public ResponseEntity<?> allHealHistory() {
        return ResponseEntity.ok(scraperService.healHistoryToDto(scraperService.listAllHealHistory()));
    }

    @SuppressWarnings("unchecked")
    @GetMapping("/scrapers/{id}/results/csv")
    public ResponseEntity<String> resultsCsv(@PathVariable String id) {
        var scraperOpt = scraperService.getOne(id);
        if (scraperOpt.isEmpty()) return ResponseEntity.notFound().build();

        List<ScrapeResult> rows = scraperService.listResults(id);

        // 스크래퍼의 "현재" extra_fields 라벨 순서 기준으로 동적 컬럼 생성.
        // 과거 실행 시점엔 없던 라벨은 빈칸으로 채운다.
        List<Map<String, Object>> extraFields = (List<Map<String, Object>>) scraperOpt.get().get("extra_fields");
        List<String> labels = extraFields == null ? List.of() : extraFields.stream()
            .map(f -> String.valueOf(f.get("label")))
            .collect(Collectors.toList());

        StringBuilder sb = new StringBuilder("﻿수집시각,상태,추출값,신뢰도,응답시간(ms),비고");
        for (String label : labels) sb.append(",").append(label.replace(",", " "));
        sb.append("\r\n");
        for (ScrapeResult r : rows) {
            sb.append(r.getRunAt()).append(",")
              .append(r.getStatus()).append(",")
              .append("\"").append(r.getValue().replace("\"", "\"\"")).append("\",")
              .append(r.getScore()).append(",")
              .append(r.getDurationMs()).append(",")
              .append("\"").append(r.getNote().replace("\"", "\"\"")).append("\"");
            if (!labels.isEmpty()) {
                Map<String, String> valuesByLabel = new HashMap<>();
                for (Map<String, Object> f : scraperService.parseFields(r.getExtraValues())) {
                    valuesByLabel.put(String.valueOf(f.get("label")), String.valueOf(f.getOrDefault("value", "")));
                }
                for (String label : labels) {
                    String v = valuesByLabel.getOrDefault(label, "");
                    sb.append(",\"").append(v.replace("\"", "\"\"")).append("\"");
                }
            }
            sb.append("\r\n");
        }
        return ResponseEntity.ok()
            .header("Content-Type", "text/csv; charset=utf-8")
            .header("Content-Disposition", "attachment; filename=\"" + id + "_results.csv\"")
            .body(sb.toString());
    }

    /** null이면 검증 통과(또는 extra_fields 없음). 라벨 공백/중복이면 에러 메시지 반환. */
    private String validateExtraFields(Object raw) {
        if (!(raw instanceof List<?> list)) return null;
        Set<String> seen = new HashSet<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Object labelObj = m.get("label");
            String label = labelObj == null ? "" : String.valueOf(labelObj).trim();
            if (label.isEmpty()) return "보조 필드 라벨은 비어있을 수 없습니다.";
            if (!seen.add(label)) return "보조 필드 라벨이 중복되었습니다: " + label;
        }
        return null;
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

        List<Map<String, Object>> data = scraperService.resultsToDto(
            scraperService.queryResults(id, from, to, status, limit));
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
