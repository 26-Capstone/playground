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

    // Null means a proposal for the primary (css_selector) field; a value means a proposal for the extra field with that label
    @Column(name = "field_label", columnDefinition = "TEXT")
    private String fieldLabel;

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

    // A record the user has flagged as "this self-heal was wrong." Only meaningful
    // for records that were actually applied (auto_approved/approved) — when
    // flagged, the live selector is reverted and the record is later used as
    // false-positive data for model retraining.
    // This column is added via ddl-auto=update to a table that already has rows,
    // so DEFAULT must be specified or ALTER TABLE fails with "contains null values".
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean reported = false;

    @Column(name = "reported_at", nullable = false, columnDefinition = "text not null default ''")
    private String reportedAt = "";

    // The V1/V2 HTML that the heal decision was based on. Re-extracting a flagged
    // record later as a negative feature for retraining requires the actual HTML
    // from that point in time, but node-scraper keeps only a single rolling V1
    // snapshot and never persists V2 at all, so we save both here at heal time.
    // nullable — no need to worry about DEFAULT; older rows are simply left NULL (not captured).
    @Column(name = "v1_html", columnDefinition = "TEXT")
    private String v1Html;

    @Column(name = "v2_html", columnDefinition = "TEXT")
    private String v2Html;

    // The selector a person picked by hand to fix the break this record describes
    // (a heal that gave up, was held for review, or was rejected). Together with
    // oldSelector and the V1/V2 HTML above it forms a labelled drift pair — the
    // only source of *correct* answers from production, since a report only says
    // a heal was wrong. Null until someone re-picks the element.
    @Column(name = "resolved_selector", columnDefinition = "TEXT")
    private String resolvedSelector;

    @Column(name = "resolved_at", nullable = false, columnDefinition = "text not null default ''")
    private String resolvedAt = "";

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
