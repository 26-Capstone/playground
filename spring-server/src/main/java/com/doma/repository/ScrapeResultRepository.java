package com.doma.repository;

import com.doma.domain.ScrapeResult;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface ScrapeResultRepository extends JpaRepository<ScrapeResult, Long> {

    List<ScrapeResult> findTop50ByScraperIdOrderByRunAtDesc(String scraperId);

    Optional<ScrapeResult> findFirstByScraperIdAndStatusOrderByRunAtDesc(String scraperId, String status);

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

    long countByScraperIdAndStatusAndRunAtBetween(String scraperId, String status, String from, String to);

    // ── Metrics (demo scrapers excluded — see Scraper.demo) ────────────────────

    /** [total, success] over the window, for scrapers that count. */
    @Query(value = """
        SELECT COUNT(*), COUNT(*) FILTER (WHERE r.status = 'healthy')
        FROM scrape_results r JOIN scrapers s ON s.id = r.scraper_id
        WHERE s.demo = FALSE
          AND CAST(r.run_at AS TIMESTAMP) >= NOW() - (:days * INTERVAL '1 day')
        """, nativeQuery = true)
    List<Object[]> runTotals(@Param("days") int days);

    /** [failure_kind, count] over the window, for scrapers that count. */
    @Query(value = """
        SELECT COALESCE(r.failure_kind, 'unknown'), COUNT(*)
        FROM scrape_results r JOIN scrapers s ON s.id = r.scraper_id
        WHERE s.demo = FALSE AND r.status <> 'healthy'
          AND CAST(r.run_at AS TIMESTAMP) >= NOW() - (:days * INTERVAL '1 day')
        GROUP BY 1
        """, nativeQuery = true)
    List<Object[]> failureKinds(@Param("days") int days);

    /**
     * Fills failure_kind for rows written before the column existed, from the note
     * text those rows already carry. One statement, run once at startup.
     */
    @Modifying
    @Transactional
    @Query(value = """
        UPDATE scrape_results SET failure_kind =
          CASE WHEN note LIKE 'Could not load the page%' THEN 'page_load'
               WHEN note LIKE 'Could not run%'           THEN 'run_error'
               ELSE 'selector' END
        WHERE failure_kind IS NULL AND status <> 'healthy'
        """, nativeQuery = true)
    int backfillFailureKind();

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
