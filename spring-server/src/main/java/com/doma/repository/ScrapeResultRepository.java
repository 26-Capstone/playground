package com.doma.repository;

import com.doma.domain.ScrapeResult;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ScrapeResultRepository extends JpaRepository<ScrapeResult, Long> {

    List<ScrapeResult> findTop50ByScraperIdOrderByRunAtDesc(String scraperId);

    List<ScrapeResult> findByScraperIdOrderByRunAtAsc(String scraperId);

    void deleteByScraperId(String scraperId);

    @Query(value = "SELECT COUNT(*) FROM scrape_results WHERE CAST(run_at AS TIMESTAMP) >= NOW() - INTERVAL '7 days'", nativeQuery = true)
    Long countTotal7d();

    @Query(value = "SELECT COUNT(*) FROM scrape_results WHERE status='healthy' AND CAST(run_at AS TIMESTAMP) >= NOW() - INTERVAL '7 days'", nativeQuery = true)
    Long countSuccess7d();

    @Query(value = "SELECT AVG(duration_ms) FROM scrape_results WHERE CAST(run_at AS TIMESTAMP) >= NOW() - INTERVAL '7 days'", nativeQuery = true)
    Double avgDuration7d();

    @Query(value = """
        SELECT duration_ms FROM scrape_results
        WHERE CAST(run_at AS TIMESTAMP) >= NOW() - INTERVAL '7 days'
        ORDER BY duration_ms
        """, nativeQuery = true)
    List<Integer> durations7d();

    @Query(value = """
        SELECT * FROM scrape_results
        WHERE scraper_id = :id
          AND (:from IS NULL OR run_at >= CAST(:from AS TIMESTAMP))
          AND (:to IS NULL OR run_at <= CAST(:to AS TIMESTAMP))
          AND (:status IS NULL OR status = :status)
        ORDER BY run_at DESC
        LIMIT :lim
        """, nativeQuery = true)
    List<ScrapeResult> query(
        @Param("id") String id,
        @Param("from") String from,
        @Param("to") String to,
        @Param("status") String status,
        @Param("lim") int lim
    );
}
