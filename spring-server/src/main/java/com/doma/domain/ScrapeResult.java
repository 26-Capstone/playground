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

    // 보조 필드 N개 스냅샷 — JSON 배열: [{"label":"...", "value":"..."}]
    // (구) extra_value 단일 컬럼은 DB에 남아있지만 더 이상 참조하지 않음 — 이력 데이터는 마이그레이션 대상 아님
    @Column(name = "extra_values", columnDefinition = "TEXT")
    private String extraValues;

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
