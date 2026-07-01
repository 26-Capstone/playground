package com.doma.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

// 클라이언트가 직접 호출하는 레거시 경로 프록시
@RestController
@RequiredArgsConstructor
public class ProxyController {

    private final RestTemplate restTemplate;

    @Value("${doma.scraper-service-url}")
    private String scraperServiceUrl;

    @Value("${doma.python-api-url}")
    private String pythonApiUrl;

    // 셀렉터 지정 UI에서 호출 → Node.js Playwright로 프록시
    @PostMapping("/fetch-html")
    public ResponseEntity<?> fetchHtml(@RequestBody Map<String, Object> body) {
        try {
            Map<?, ?> result = restTemplate.postForObject(
                scraperServiceUrl + "/internal/fetch-html", body, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", "Node.js 연결 실패: " + e.getMessage()));
        }
    }

    // 수동 heal 호출 → Python AI로 프록시
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
