package com.doma.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * valueKindChanged is a pure function, so it gets its own class — the mocks in
 * HealServiceTest are unused here and Mockito's strict stubbing rejects that.
 */
class HealServiceValueKindTest {
    // Cases taken from the holdout evaluation's actual false heals: a heal that
    // clears the confidence bar but lands on a neighbouring column or the row's
    // rank badge. Those overwrite cssSelector and lastValue together, so catching
    // them before auto-approval is the only chance to keep the previous value.

    @Test
    void valueKindChanged_flagsRankBadgeReplacingAnAmount() {
        // '37억원' -> '1' : the healer landed on the row's rank badge
        assertThat(HealService.valueKindChanged("37억원", "1")).isTrue();
    }

    @Test
    void valueKindChanged_flagsAmountReplacingAName() {
        // 'SOXL' -> '74,432원' : it landed on the price column instead of the name
        assertThat(HealService.valueKindChanged("SOXL", "74,432원")).isTrue();
    }

    @Test
    void valueKindChanged_flagsCurrencyAppearingOrVanishing() {
        assertThat(HealService.valueKindChanged("$3,694.22", "3694")).isTrue();
    }

    @Test
    void valueKindChanged_allowsAnOrdinaryValueUpdate() {
        // The field working normally: same kind of thing, different number.
        assertThat(HealService.valueKindChanged("74,432원", "75,100원")).isFalse();
        assertThat(HealService.valueKindChanged("-2.0%", "+10.3%")).isFalse();
        assertThat(HealService.valueKindChanged("SK하이닉스", "클래시스")).isFalse();
    }

    @Test
    void valueKindChanged_staysQuietWithoutAnEstablishedShape() {
        // "—" is what a pending or never-run field holds; there is nothing to
        // compare against yet, so this must not fire on every first heal.
        assertThat(HealService.valueKindChanged("—", "74,432원")).isFalse();
        assertThat(HealService.valueKindChanged(null, "74,432원")).isFalse();
        assertThat(HealService.valueKindChanged("", "74,432원")).isFalse();
    }
}
