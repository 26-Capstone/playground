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

    // null이면 primary(css_selector) 필드에 대한 제안, 값이 있으면 그 라벨의 보조 필드에 대한 제안
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

    // 사용자가 "이 자가치유는 잘못됐다"고 신고한 건. 실제 반영된(auto_approved/approved)
    // 건에만 의미가 있으며, 신고 시 라이브 셀렉터를 되돌리고 이후 모델 재학습용
    // 오탐 데이터로 활용한다.
    // 기존 row가 있는 테이블에 ddl-auto=update로 붙는 컬럼이라 DEFAULT를 명시해야
    // ALTER TABLE이 "contains null values"로 실패하지 않는다.
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean reported = false;

    @Column(name = "reported_at", nullable = false, columnDefinition = "text not null default ''")
    private String reportedAt = "";

    // 치유 판단 근거였던 V1/V2 HTML. 신고된 건을 나중에 재학습용 negative feature로
    // 재추출하려면 그 시점의 실제 HTML이 있어야 하는데, node-scraper는 롤링 V1
    // 스냅샷 1장만 유지하고 V2는 아예 저장하지 않으므로 치유 시점에 여기 같이 남긴다.
    // nullable — DEFAULT 신경 쓸 필요 없이 과거 row는 그냥 NULL(미캡처)로 둔다.
    @Column(name = "v1_html", columnDefinition = "TEXT")
    private String v1Html;

    @Column(name = "v2_html", columnDefinition = "TEXT")
    private String v2Html;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
