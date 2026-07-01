package com.doma.repository;

import com.doma.domain.Scraper;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface ScraperRepository extends JpaRepository<Scraper, String> {

    List<Scraper> findAllByOrderByCreatedAtDesc();

    @Query("SELECT COUNT(s) FROM Scraper s WHERE s.status != 'paused'")
    long countActive();

    @Query("SELECT COALESCE(SUM(s.healedCount), 0) FROM Scraper s")
    long sumHealedCount();
}
