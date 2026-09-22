package com.doma.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Whether the V2 page was worth healing against at all. The cases below are the
 * shapes actually seen in production give-ups, plus the redesigns that must still
 * go through healing.
 */
class HealServicePageCheckTest {

    /** ~2,900 characters of visible text, the size of a rendered ranking page. */
    private static String rendered(String extra) {
        StringBuilder sb = new StringBuilder("<html><head><title>무신사 | 랭킹</title></head><body>");
        sb.append("<nav>MUSINSA BEAUTY SPORTS OUTLET KICKS KIDS 검색 좋아요 마이 장바구니</nav>");
        sb.append("<main>");
        for (int i = 1; i <= 60; i++) {
            sb.append("<div class=\"item\"><span>").append(i).append("</span>")
              .append("<a class=\"name\">에센셜 CP 이중지 크롭 긴팔티 7color</a>")
              .append("<span class=\"price\">39,000원</span></div>");
        }
        sb.append("</main>").append(extra).append("</body></html>");
        return sb.toString();
    }

    /** The same page's chrome with no list: nav, footer, and an error line. */
    private static String chromeOnly(String notice) {
        return "<html><head><title>무신사 | 랭킹</title></head><body>"
            + "<nav>MUSINSA BEAUTY SPORTS OUTLET KICKS KIDS 검색 좋아요 마이 장바구니</nav>"
            + "<div class=\"notice\">" + notice + "</div>"
            + "<footer>고객센터 이용약관 개인정보처리방침 사업자정보확인</footer>"
            + "</body></html>";
    }

    @Test
    void flagsAPageThatRenderedOnlyItsChrome() {
        // Musinsa: 2,996 characters of text became 1,370, with no notice to match on —
        // the list simply never filled. This is the shrink signal on its own.
        String reason = HealService.unavailableReason(rendered(""), chromeOnly("상품 목록을 불러오고 있어요"));
        assertThat(reason).isNotNull().contains("% of the last good capture");
    }

    @Test
    void flagsAMaintenanceNotice() {
        // Toss Securities returned this in place of the stock list.
        String v2 = rendered("<div>지금은 점검중이에요</div>");
        assertThat(HealService.unavailableReason(rendered(""), v2)).isNotNull();
    }

    @Test
    void flagsAnUnsupportedBrowserGate() {
        String v2 = rendered("<div>지원하지 않는 브라우저예요</div>");
        assertThat(HealService.unavailableReason(rendered(""), v2)).isNotNull();
    }

    @Test
    void flagsABlockPage() {
        // CGV served a Cloudflare error page carrying a Ray ID.
        assertThat(HealService.unavailableReason(rendered(""), chromeOnly("Access denied · Ray ID: 8f2c1a")))
            .isNotNull();
    }

    @Test
    void staysQuietOnARedesignThatStillRendered() {
        // The case self-heal exists for: same content, entirely different markup.
        String redesigned = rendered("").replace("class=\"item\"", "class=\"UIProductColumn\"")
                                        .replace("class=\"name\"", "class=\"prodName\"");
        assertThat(HealService.unavailableReason(rendered(""), redesigned)).isNull();
    }

    @Test
    void staysQuietWhenTheNoticeWordWasAlreadyOnTheGoodPage() {
        // This site carries "점검중" in its own footer year-round, so its presence on
        // V2 is not evidence of anything.
        String v1 = rendered("<footer>정기 점검중 안내를 확인하세요</footer>");
        String v2 = rendered("<footer>정기 점검중 안내를 확인하세요</footer>").replace("class=\"item\"", "class=\"row\"");
        assertThat(HealService.unavailableReason(v1, v2)).isNull();
    }

    @Test
    void staysQuietOnAPageThatWasAlwaysShort() {
        // No established size to shrink from — a one-value page, not a listing.
        String v1 = "<html><body><div>1,428.50</div></body></html>";
        String v2 = "<html><body><span>1,431.20</span></body></html>";
        assertThat(HealService.unavailableReason(v1, v2)).isNull();
    }

    @Test
    void staysQuietWhenTheNewPageIsLarger() {
        assertThat(HealService.unavailableReason(chromeOnly("안내"), rendered(""))).isNull();
    }

    @Test
    void staysQuietOnMissingHtml() {
        assertThat(HealService.unavailableReason(null, rendered(""))).isNull();
        assertThat(HealService.unavailableReason(rendered(""), null)).isNull();
    }
}
