package com.doma.config;

import com.doma.domain.Scraper;
import com.doma.repository.ScraperRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 1개짜리 보조 필드 파일럿(extraSelector/extraLabel/lastExtraValue)에서
 * N개 보조 필드(extraFields JSON 배열)로 넘어가는 1회성 마이그레이션.
 *
 * "복사"가 아니라 "이동"이어야 한다 — 옮긴 뒤 원본(extraSelector) 컬럼을 비워야
 * idempotent 조건(extraSelector 비어있지 않음)이 다시 참이 되지 않는다. 옮기기만
 * 하고 원본을 안 지우면, 사용자가 새 UI에서 보조 필드를 전부 지워도(extraFields를
 * 빈 배열로) 재기동할 때마다 이 러너가 낡은 extraSelector 값으로 되살려버린다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ExtraFieldMigration implements ApplicationRunner {

    private final ScraperRepository scraperRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void run(ApplicationArguments args) {
        int migrated = 0;
        for (Scraper s : scraperRepository.findAll()) {
            if (s.getExtraSelector() == null || s.getExtraSelector().isBlank()) continue;
            if (s.getExtraFields() != null && !s.getExtraFields().isBlank()) continue;

            Map<String, Object> field = new LinkedHashMap<>();
            field.put("label", s.getExtraLabel() != null ? s.getExtraLabel() : "");
            field.put("selector", s.getExtraSelector());
            field.put("lastValue", s.getLastExtraValue() != null ? s.getLastExtraValue() : "—");

            try {
                s.setExtraFields(objectMapper.writeValueAsString(List.of(field)));
                // 원본 컬럼을 비워서 "이동"을 완료 — 재기동 시 재마이그레이션(데이터 부활) 방지
                s.setExtraSelector(null);
                s.setExtraLabel(null);
                s.setLastExtraValue(null);
                scraperRepository.save(s);
                migrated++;
            } catch (Exception e) {
                log.error("[migration] {} 보조 필드 마이그레이션 실패: {}", s.getId(), e.getMessage());
            }
        }
        if (migrated > 0) {
            log.info("[migration] 보조 필드 파일럿 → extraFields 배열 마이그레이션 완료: {}건", migrated);
        }
    }
}
