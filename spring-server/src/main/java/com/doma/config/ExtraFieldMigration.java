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
 * One-time migration from the single-field extra-field pilot
 * (extraSelector/extraLabel/lastExtraValue) to N extra fields
 * (extraFields JSON array).
 *
 * This must be a "move," not a "copy" — after moving the data, the original
 * (extraSelector) column must be cleared, or the idempotency condition
 * (extraSelector not blank) will become true again. If we move without
 * clearing the original, this runner will resurrect the stale extraSelector
 * value on every restart, even after the user clears all extra fields in the
 * new UI (extraFields set to an empty array).
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
                // Clear the original column to complete the "move" — prevents re-migration (data resurrection) on restart
                s.setExtraSelector(null);
                s.setExtraLabel(null);
                s.setLastExtraValue(null);
                scraperRepository.save(s);
                migrated++;
            } catch (Exception e) {
                log.error("[migration] {} extra-field migration failed: {}", s.getId(), e.getMessage());
            }
        }
        if (migrated > 0) {
            log.info("[migration] Extra-field pilot → extraFields array migration complete: {} record(s)", migrated);
        }
    }
}
