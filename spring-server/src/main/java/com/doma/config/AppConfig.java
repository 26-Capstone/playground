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
        // HTTP/1.1 전용 SimpleClientHttpRequestFactory를 명시적으로 지정한다.
        // RestTemplateBuilder의 기본 팩토리(JDK HttpClient)는 cleartext(h2c) 업그레이드를
        // 시도하는데, node-scraper가 같은 포트에서 ws WebSocket 서버를 같이 띄우고 있어서
        // Upgrade 헤더가 붙은 요청을 ws가 가로채 "405 Invalid HTTP method"로 거부해버린다.
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
