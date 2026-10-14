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

    // Snapshot of N extra fields — JSON array: [{"label":"...", "value":"..."}]
    // The (old) single extra_value column still exists in the DB but is no longer referenced — historical data is not migrated
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

    /**
     * Why a failed run failed: "selector" (the page rendered, the selector missed),
     * "page_load" (the page never arrived), or "run_error" (the scraper service
     * itself failed). Null on success.
     *
     * Kept as its own column rather than parsed out of {@link #note} at query time —
     * the note is a human-facing sentence, and metrics that depend on its wording
     * break silently the first time someone rewords it. Rows from before this column
     * are filled in once by FailureKindBackfill.
     */
    @Column(name = "failure_kind")
    private String failureKind;

    @PrePersist
    void prePersist() {
        if (runAt == null) {
            runAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
