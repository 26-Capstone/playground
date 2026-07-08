package com.doma.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Entity
@Table(name = "scrape_results")
@Getter @Setter @NoArgsConstructor
public class ScrapeResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scraper_id", nullable = false)
    private String scraperId;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String value = "";

    @Column(name = "extra_value", columnDefinition = "TEXT")
    private String extraValue = "";

    @Column(nullable = false)
    private Double score = 0.0;

    @Column(name = "duration_ms", nullable = false)
    private Integer durationMs = 0;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String note = "";

    @Column(name = "run_at", nullable = false)
    private String runAt;

    @PrePersist
    void prePersist() {
        if (runAt == null) {
            runAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
