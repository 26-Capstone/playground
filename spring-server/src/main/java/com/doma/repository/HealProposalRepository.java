package com.doma.repository;

import com.doma.domain.HealProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface HealProposalRepository extends JpaRepository<HealProposal, Long> {

    List<HealProposal> findByStatusOrderByCreatedAtDesc(String status);

    // fieldLabel is null for the primary field — Spring Data JPA generates
    // "field_label IS NULL" for a null argument here, not "= NULL", so this
    // correctly matches primary-field proposals too.
    Optional<HealProposal> findFirstByScraperIdAndFieldLabelAndStatusOrderByCreatedAtDesc(
        String scraperId, String fieldLabel, String status);

    List<HealProposal> findByScraperIdOrderByCreatedAtDesc(String scraperId);

    List<HealProposal> findAllByOrderByCreatedAtDesc();

    List<HealProposal> findByReportedTrueOrderByIdAsc();

    // Primary-field records still describing an unfixed break, newest first.
    List<HealProposal> findByScraperIdAndFieldLabelIsNullAndResolvedSelectorIsNullAndStatusInOrderByCreatedAtDesc(
        String scraperId, Collection<String> statuses);

    List<HealProposal> findByResolvedSelectorIsNotNullOrderByIdAsc();

    void deleteByScraperId(String scraperId);
}
