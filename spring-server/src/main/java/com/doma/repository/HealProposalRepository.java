package com.doma.repository;

import com.doma.domain.HealProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface HealProposalRepository extends JpaRepository<HealProposal, Long> {

    List<HealProposal> findByStatusOrderByCreatedAtDesc(String status);

    List<HealProposal> findByScraperIdOrderByCreatedAtDesc(String scraperId);

    List<HealProposal> findAllByOrderByCreatedAtDesc();

    void deleteByScraperId(String scraperId);
}
