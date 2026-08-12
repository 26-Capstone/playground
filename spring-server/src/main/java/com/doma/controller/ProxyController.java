package com.doma.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

// Legacy proxy path called directly by the client
@RestController
@RequiredArgsConstructor
public class ProxyController {

    private final RestTemplate restTemplate;

    @Value("${doma.scraper-service-url}")
    private String scraperServiceUrl;

    @Value("${doma.python-api-url}")
    private String pythonApiUrl;

    // Called from the selector-picker UI → proxies to Node.js Playwright
    @PostMapping("/fetch-html")
    public ResponseEntity<?> fetchHtml(@RequestBody Map<String, Object> body) {
        try {
            Map<?, ?> result = restTemplate.postForObject(
                scraperServiceUrl + "/internal/fetch-html", body, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", "Node.js connection failed: " + e.getMessage()));
        }
    }

    // Manual heal call → proxies to Python AI
    @PostMapping("/heal")
    public ResponseEntity<?> heal(@RequestBody Map<String, Object> body) {
        try {
            Map<?, ?> result = restTemplate.postForObject(
                pythonApiUrl + "/heal", body, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", "Python API connection failed: " + e.getMessage()));
        }
    }
}
