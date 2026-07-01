package com.doma.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Entity
@Table(name = "scrapers")
@Getter @Setter @NoArgsConstructor
public class Scraper {

    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String url;

    @Column(name = "css_selector", nullable = false)
    private String cssSelector = "";

    @Column(name = "user_intent", nullable = false)
    private String userIntent = "";

    @Column(nullable = false)
    private Integer threshold = 85;

    @Column(nullable = false)
    private String schedule = "daily-9";

    @Column(nullable = false)
    private String channels = "[\"REST API\"]";

    @Column(nullable = false)
    private String domain = "commerce";

    @Column(nullable = false)
    private String org = "";

    @Column(nullable = false)
    private String owner = "";

    @Column(nullable = false)
    private String status = "pending";

    @Column(nullable = false)
    private Double score = 0.0;

    @Column(name = "last_value", nullable = false)
    private String lastValue = "—";

    @Column(name = "last_run_at", nullable = false)
    private String lastRunAt = "";

    @Column(name = "healed_count", nullable = false)
    private Integer healedCount = 0;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
