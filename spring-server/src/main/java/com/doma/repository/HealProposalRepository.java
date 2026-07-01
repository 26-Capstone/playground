package com.doma.repository;

import com.doma.domain.HealProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface HealProposalRepository extends JpaRepository<HealProposal, Long> {

    List<HealProposal> findByStatusOrderByCreatedAtDesc(String status);

    void deleteByScraperId(String scraperId);
}
