package com.doma.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Entity
@Table(name = "heal_proposals")
@Getter @Setter @NoArgsConstructor
public class HealProposal {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scraper_id", nullable = false)
    private String scraperId;

    @Column(name = "scraper_name", nullable = false)
    private String scraperName = "";

    @Column(name = "old_selector", nullable = false, columnDefinition = "TEXT")
    private String oldSelector;

    @Column(name = "proposed_selector", nullable = false, columnDefinition = "TEXT")
    private String proposedSelector;

    @Column(name = "extracted_text", nullable = false, columnDefinition = "TEXT")
    private String extractedText = "";

    @Column(nullable = false)
    private Double confidence = 0.0;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String reasoning = "";

    @Column(nullable = false)
    private String status = "pending";

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    @Column(name = "reviewed_at", nullable = false)
    private String reviewedAt = "";

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
