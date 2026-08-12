package com.doma.config;

import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

@Configuration
public class AppConfig {

    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        // Explicitly use an HTTP/1.1-only SimpleClientHttpRequestFactory.
        // RestTemplateBuilder's default factory (JDK HttpClient) attempts a cleartext
        // (h2c) upgrade, but node-scraper also runs a ws WebSocket server on the same
        // port, so the ws server intercepts requests carrying an Upgrade header and
        // rejects them with "405 Invalid HTTP method".
        return builder
            .requestFactory(SimpleClientHttpRequestFactory.class)
            .connectTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(90))
            .build();
    }

    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("doma-scheduler-");
        scheduler.initialize();
        return scheduler;
    }
}
