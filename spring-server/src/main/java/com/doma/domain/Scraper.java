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

    @Column(nullable = false, columnDefinition = "TEXT")
    private String url;

    @Column(name = "css_selector", nullable = false, columnDefinition = "TEXT")
    private String cssSelector = "";

    @Column(name = "user_intent", nullable = false, columnDefinition = "TEXT")
    private String userIntent = "";

    /** @deprecated 1개짜리 파일럿 시절 컬럼. {@link #extraFields}로 대체됨 — ExtraFieldMigration이
     * 이 값을 읽어 extraFields로 옮긴 뒤에만 참조해야 하며, 마이그레이션 확인 후 제거 예정. */
    @Deprecated
    @Column(name = "extra_selector", columnDefinition = "TEXT")
    private String extraSelector;

    /** @deprecated {@link #extraFields}로 대체됨. */
    @Deprecated
    @Column(name = "extra_label", columnDefinition = "TEXT")
    private String extraLabel;

    // 보조 필드 N개 — JSON 배열: [{"label":"...", "selector":"...", "lastValue":"..."}]
    @Column(name = "extra_fields", columnDefinition = "TEXT")
    private String extraFields;

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

    @Column(name = "last_value", nullable = false, columnDefinition = "TEXT")
    private String lastValue = "—";

    /** @deprecated {@link #extraFields}의 각 항목 lastValue로 대체됨. */
    @Deprecated
    @Column(name = "last_extra_value", columnDefinition = "TEXT")
    private String lastExtraValue = "—";

    @Column(name = "last_run_at", nullable = false)
    private String lastRunAt = "";

    @Column(name = "healed_count", nullable = false)
    private Integer healedCount = 0;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    @Column(name = "webhook_url")
    private String webhookUrl;

    @Column(name = "webhook_type", nullable = false)
    private String webhookType = "generic";

    @Column(name = "alert_on_change", nullable = false)
    private Boolean alertOnChange = false;

    @Column(name = "alert_delta")
    private Double alertDelta;

    @Column(name = "alert_range_min")
    private Double alertRangeMin;

    @Column(name = "alert_range_max")
    private Double alertRangeMax;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}
