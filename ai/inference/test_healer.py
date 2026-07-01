"""
Self-Healing Crawler — CLI 테스트 러너
실제 추론 로직은 healer.py에 있습니다.
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from healer import heal_target

TEST_CASES = [
    {
        "site_name": "사이트 A (토스 증권)",
        "v1_file":   "data/testdata/html1_v1.html",
        "v2_file":   "data/testdata/html1_v2.html",
        "targets": [
            {
                "name":        "나스닥 가격",
                "user_intent": "현재 나스닥의 실시간 지수를 숫자 형태로 추출해줘. 상승/하락 기호나 등락폭은 제외하고 순수한 지수 값만 필요해.",
                "css":         "#major-indicators-carousel > div.tw4l-e3e6ffb > ul > li:nth-child(4) > a > div > div > span:nth-child(1)",
                "v2_css":      "#__next > div > div.ho2myi1 > main > div > div > div > div > div:nth-child(3) > aside > div:nth-child(3) > section > div > li:nth-child(1) > a > div > div > span:nth-child(1)",
            },
            {
                "name":        "달러 환율",
                "user_intent": "현재 원/달러 환율을 숫자 형태로 추출해줘. 부가적인 기호나 등락폭 없이 순수한 환율 값만 가져와 줘.",
                "css":         "#major-indicators-carousel > div.tw4l-e3e6ffb > ul > li:nth-child(3) > a > div > div > span:nth-child(1)",
                "v2_css":      "#__next > div > div.ho2myi1 > main > div > div > div > div > div:nth-child(3) > aside > div:nth-child(3) > section > div > li:nth-child(4) > a > div > div > span:nth-child(1)",
            },
        ],
    },
    {
        "site_name": "사이트 B (쿠팡 로켓프레시)",
        "v1_file":   "data/testdata/html2_v1.html",
        "v2_file":   "data/testdata/html2_v2.html",
        "targets": [
            {
                "name":        "로켓프레시 랭킹 1위",
                "user_intent": "광고 상품이나 스폰서 상품을 제외하고, 실제 판매량 순위가 가장 높은 첫 번째 상품의 정확한 이름을 찾아줘.",
                "css":         "[id=\"6345944285\"] > a > dl > dd > div.name",
                "v2_css":      "#product-list > li:nth-child(1) > a > div > div.ProductUnit_productNameV2__cV9cw",
            },
        ],
    },
    {
        "site_name": "사이트 C (멜론 차트)",
        "v1_file":   "data/testdata/html3_v1.html",
        "v2_file":   "data/testdata/html3_v2.html",
        "targets": [
            {
                "name":        "차트 랭킹 1위",
                "user_intent": "음원 차트에서 현재 1위를 차지하고 있는 곡의 제목을 찾아줘.",
                "css":         "#real_conts > div.wrap_top3 > div > div.real_wrap > div.rank_cont.d_songrankcont > ol > li:nth-child(1) > div.rank_music > div > div.info_top > div.song_info_cont > div.song_info_cont2 > div.wrap_song_info.ellipsis > strong > a > span > span.tit",
                "v2_css":      "#lst50 > td:nth-child(6) > div > div > div.ellipsis.rank01 > span > a",
            },
        ],
    },
    {
        "site_name": "사이트 D (교보문고 온라인 일간 베스트)",
        "v1_file":   "data/testdata/html4_v1.html",
        "v2_file":   "data/testdata/html4_v2.html",
        "targets": [
            {
                "name":        "베스트 1위 책 제목",
                "user_intent": "베스트셀러 목록에서 1위인 책의 제목을 정확히 발췌해줘.",
                "css":         r"body > div.relative.min-w-\[1440px\] > main > section > div > div > section > ol.grid.border-t.border-gray-400.grid-cols-1.pt-9 > li:nth-child(1) > div > div.flex.items-top.justify-start.mr-\[35px\] > div.ml-4.w-\[516px\] > a",
                "v2_css":      r"body > div.relative.min-w-\[1440px\] > main > section > div > div > section > ol.grid.border-t.border-gray-400.grid-cols-1.pt-9 > li:nth-child(1) > div > div.flex.items-top.justify-start.mr-\[35px\].w-full > div.ml-4.w-full.min-w-\[516px\] > a",
            },
        ],
    },
    {
        "site_name": "사이트 E (investing.com 한국 지수)",
        "v1_file":   "data/testdata/html5_v1.html",
        "v2_file":   "data/testdata/html5_v2.html",
        "targets": [
            {
                "name":        "코스피지수 종가",
                "user_intent": "코스피 지수의 현재 종가를 찾아줘. 부가 설명 없이 순수한 숫자값만 필요해.",
                "css":         "#sidebar > div.bp3-card.bp3-elevation-0.inv-card.quotes-box_quotes-box__3cPIr.no-border > div.inv-card-body.quotes-box_quotes-box__body__1oVEW > div > table:nth-child(4) > tbody > tr.datatable_row__2vgJl.datatable_selected__O2jpX > td:nth-child(2)",
                "v2_css":      r"#__next > div.md\:relative.md\:bg-white > div.relative.flex > div.grid.flex-1.grid-cols-1.px-4.pt-5.font-sans-v2.text-\[\#232526\].antialiased.xl\:container.sm\:px-6.md\:grid-cols-\[1fr_72px\].md\:gap-6.md\:px-7.md\:pt-10.md2\:grid-cols-\[1fr_420px\].md2\:gap-8.md2\:px-8.xl\:mx-auto.xl\:gap-10.xl\:px-10 > div.min-w-0 > div:nth-child(4) > div.relative.w-full > div.relative.dynamic-table-v2_dynamic-table-wrapper__fBEvo.dynamic-table-v2_scrollbar-x__R96pe > table > tbody > tr:nth-child(1) > td:nth-child(3) > span",
            },
        ],
    },
    {
        "site_name": "사이트 F (옥션 베스트)",
        "v1_file":   "data/testdata/html6_v1.html",
        "v2_file":   "data/testdata/html6_v2.html",
        "targets": [
            {
                "name":        "베스트 1위 상품명",
                "user_intent": "종합 베스트 상품 목록에서 1위 상품의 이름을 찾아줘.",
                "css":         "#itembest_T > ul.uxb-img.first > li.first > div > div.info > em > a",
                "v2_css":      "#itembest_T > ul.list__best-items.uxb-img.first > li.first.box_best-item-wrap > div > div.info.box__best-card > div.box__best-item > h4 > a",
            },
        ],
    },
    {
        "site_name": "사이트 G (스포티파이)",
        "v1_file":   "data/testdata/html7_v1.html",
        "v2_file":   "data/testdata/html7_v2.html",
        "targets": [
            {
                "name":        "1위 곡 제목",
                "user_intent": "인기 곡 목록에서 1위를 차지하고 있는 곡의 제목을 찾아줘.",
                "css":         "div > div.ZQftYELq0aOsg6tPbVbV > div.jEMA2gVoLgPQqAFrPhFw > div.main-view-container > div.main-view-container__scroll-node > div:nth-child(2) > div.main-view-container__scroll-node-child > main > div.GlueDropTarget > section > div.rezqw3Q4OEPB1m4rmwfw > div.contentSpacing > div.UqzBuREVmvcEOZYWEGCM.oIeuP60w1eYpFaXESRSg.oYS_3GP9pvVjqbFlh9tq > div.JUa6JJNj7R_Y3i4P8YUX > div:nth-child(2) > div:nth-child(1) > div > div.w46g_LQVSLE9xK399VYf > div > div",
                "v2_css":      "#main-view > div > div.main-view-container__scroll-node.qLlzLghnvcCySJ8T > div:nth-child(1) > div > main > section > div.LUXUp8VNfbIoaJCl > div.q8mQFn7r8UYsKdHE > div > div.eaxF79s4oV8I2CPQ > div > div.m9t_KhZ6MI0XQj9b > div:nth-child(2) > div:nth-child(1) > div > div.NILrlF6tOUcbSyzo > div > a > div",
            },
        ],
    },
    {
        "site_name": "사이트 H (애플뮤직)",
        "v1_file":   "data/testdata/html8_v1.html",
        "v2_file":   "data/testdata/html8_v2.html",
        "targets": [
            {
                "name":        "1위 곡 제목",
                "user_intent": "인기 곡 목록에서 1위를 차지하고 있는 곡의 제목을 찾아줘.",
                "css":         "#scrollable-page > main > div > div:nth-child(2) > div > div > div:nth-child(2) > div > div.songs-list__col.songs-list__col--song.svelte-17mxcgw > div > div.songs-list-row__song-wrapper.svelte-17mxcgw > div > div.songs-list-row__explicit-wrapper.svelte-17mxcgw > div",
                "v2_css":      "#scrollable-page > main > div > div:nth-child(2) > div > div > div:nth-child(2) > div.songs-list__col.songs-list__col--song.svelte-fcu18p > div > div.songs-list-row__song-wrapper.svelte-fcu18p > div > a > div",
            },
        ],
    },
    {
        "site_name": "사이트 I (직방)",
        "v1_file":   "data/testdata/html9_v1.html",
        "v2_file":   "data/testdata/html9_v2.html",
        "targets": [
            {
                "name":        "첫 번째 뉴스 제목",
                "user_intent": "페이지의 뉴스 섹션에 나열된 기사 목록 중 첫 번째 기사의 제목 텍스트를 추출해줘.",
                "css":         "#__next > div._app__Body-sc-1bdsqic-0.bQmjmR > div > div.pages__-lex7c7-18.kKNLkW.css-1dbjc4n > div > div.pages__-lex7c7-21.fpRCKs.css-1dbjc4n > div.css-1dbjc4n.r-150rngu.r-eqz5dr.r-16y2uox.r-1wbh5a2.r-11yh6sk.r-1rnoaur.r-1sncvnh > div > div:nth-child(2) > div > div.css-1563yu1.css-vcwn7f.r-143r1dj.r-1enofrn.r-fxxt2n.r-3s2u2q",
                "v2_css":      "#__next > div.sc-60c3970c-0.kDqIRH > div > div.sc-22c1c0c9-18.bNzZCE.css-1dbjc4n > div > div.sc-22c1c0c9-21.gJSBYe.css-1dbjc4n > div.css-1dbjc4n.r-150rngu.r-eqz5dr.r-16y2uox.r-1wbh5a2 > div > div:nth-child(2) > div",
            },
        ],
    },
    {
        "site_name": "사이트 J (네이버)",
        "v1_file":   "data/testdata/html10_v1.html",
        "v2_file":   "data/testdata/html10_v2.html",
        "targets": [
            {
                "name":        "실시간검색어 1위 이름",
                "user_intent": "오늘의 실시간 급상승 검색어 순위에서 1위를 차지하고 있는 검색어의 이름을 추출해줘.",
                "css":         "#realrank > li:nth-child(1) > a",
                "v2_css":      "#PM_ID_ct > div.header > div.section_navbar > div.area_hotkeyword.PM_CL_realtimeKeyword_base > div.ah_list.PM_CL_realtimeKeyword_list_base > ul:nth-child(4) > li:nth-child(1) > a.ah_a",
            },
        ],
    },
]


def main():
    # test_healer.py는 capstone_dataset/ 루트에서 실행해야 합니다.
    # ex) python inference/test_healer.py
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    print("=" * 50)
    print(" Self-Healing Crawler — 배치 테스트")
    print("=" * 50)

    total = correct = 0

    for case in TEST_CASES:
        site_name = case["site_name"]
        v1_path   = os.path.join(base, case["v1_file"])
        v2_path   = os.path.join(base, case["v2_file"])

        print(f"\n[사이트] {site_name}")

        if not (os.path.exists(v1_path) and os.path.exists(v2_path)):
            print(f"  [-] 파일 없음: {v1_path}")
            continue

        with open(v1_path, encoding="utf-8") as f:
            v1_html = f.read()
        with open(v2_path, encoding="utf-8") as f:
            v2_html = f.read()

        for target in case["targets"]:
            total += 1
            print(f"\n  [타겟] {target['name']}")

            result = heal_target(
                v1_html=v1_html,
                v2_html=v2_html,
                css_selector=target["css"],
                user_intent=target["user_intent"],
                target_name=target["name"],
            )

            status = result.get("status")
            if status == "no_change_needed":
                print(f"  [=] 셀렉터 유효, 값: '{result['extracted_text']}'")
                correct += 1
                continue
            if status == "failed":
                print(f"  [X] 실패: {result.get('reason')}")
                continue

            print(f"  [+] 복구 완료 (신뢰도 {result['confidence']*100:.0f}%)")
            print(f"      값:       '{result['extracted_text']}'")
            print(f"      셀렉터:   {result['robust_selector']}")
            print(f"      근거:     {result['reasoning']}")

            # 정답 대조
            true_v2_css = target.get("v2_css")
            if true_v2_css:
                from bs4 import BeautifulSoup
                soup_v2    = BeautifulSoup(v2_html, "lxml")
                true_node  = soup_v2.select_one(true_v2_css)
                true_text  = true_node.get_text(strip=True) if true_node else ""
                if result["extracted_text"] == true_text:
                    print("  [채점] ✅ 정답")
                    correct += 1
                else:
                    print(f"  [채점] ❌ 오답 (정답: '{true_text}')")

    print(f"\n{'='*50}")
    print(f" 결과: {correct}/{total} 정확")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
