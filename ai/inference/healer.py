"""
Self-Healing Crawler — 핵심 추론 모듈
heal_target()을 호출해 V2 HTML에서 복구된 셀렉터와 값을 반환합니다.
"""
import os
import re
import json
import pathlib
import difflib

import numpy as np
import pandas as pd
from bs4 import BeautifulSoup
import joblib
from anthropic import Anthropic

_BASE_DIR = pathlib.Path(__file__).parent.parent
_MODEL_FILE    = _BASE_DIR / "models" / "best_self_healing_model.pkl"
_FEATURES_FILE = _BASE_DIR / "models" / "model_features.pkl"

_model    = None
_features = None
_llm      = None

TOP_K = 30
# A bare ranking word carries no number, so it keeps the original meaning of
# "the top one". Numbered patterns are tried first — see _requested_rank.
_RANK_WORDS = ['첫 번째', '베스트', '순위', '랭킹', 'first', 'best']
_RANK_PATTERNS = [
    re.compile(r'(?:top|rank|no\.?)\s*(\d+)', re.I),   # "top1 coin name", "rank 2"
    re.compile(r'#\s*(\d+)'),                          # "currently #1 trending"
    re.compile(r'(\d+)\s*위'),                          # "1위 종목명"
]


def _requested_rank(target_name):
    """Which position in a ranked list the user asked for, or None if this
    target is not rank-oriented.

    Replaces a Korean-only keyword list that fed a hardcoded rank of 1. Every
    English target name ("top1 coin name") read as non-ranking, so the whole
    ranking-correction path was dead for them; and had it fired, rank 1 is the
    wrong answer for every "top2 ..." target.
    """
    for pat in _RANK_PATTERNS:
        m = pat.search(target_name)
        if m:
            return int(m.group(1))
    low = target_name.lower()
    return 1 if any(w in low for w in _RANK_WORDS) else None


def _get_resources():
    global _model, _features, _llm
    if _model is None:
        _model    = joblib.load(_MODEL_FILE)
        _features = joblib.load(_FEATURES_FILE)
    if _llm is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")
        _llm = Anthropic(api_key=api_key)
    return _model, _features, _llm


# ─── DOM 헬퍼 ────────────────────────────────────────────────────────────────

def _dom_depth(el):
    d = 0
    while el.parent is not None:
        d += 1
        el = el.parent
    return d

def _max_nth_child(el):
    max_nth = 0
    cur = el
    while cur.parent is not None:
        sibs = [s for s in cur.parent.children if s.name is not None and s.name == cur.name]
        try:
            idx = sibs.index(cur)
            if idx > max_nth:
                max_nth = idx
        except ValueError:
            pass
        cur = cur.parent
    return max_nth

def _list_ancestor_index(el, min_siblings=3):
    cur = el
    for _ in range(10):
        if cur.parent is None:
            break
        cur = cur.parent
        if cur.name in ['tr', 'tbody', 'thead', 'table']:
            return -1
        sibs = [s for s in cur.parent.children if s.name is not None] if cur.parent else []
        if len(sibs) >= min_siblings:
            try:
                return sibs.index(cur)
            except ValueError:
                pass
    return -1

def _path_classes(el):
    tokens = set()
    cur = el
    for _ in range(5):
        if not cur:
            break
        if cur.get('id'):
            tokens.add(cur.get('id'))
        for c in (cur.get('class') or []):
            tokens.add(c)
        cur = cur.parent
    return tokens

def _ancestor_tags(node, levels=5):
    tags, cur = [], node.parent if node else None
    for _ in range(levels):
        if cur and cur.name:
            tags.append(cur.name)
            cur = cur.parent
        else:
            break
    return tags

# ─── 앵커(칼럼 헤더 / 섹션 제목) ────────────────────────────────────────────
#
# src/processing/feature_extractor.py와 동일 구현. 값이 학습 때와 달라지면
# 안 되므로 한쪽만 고치지 말 것.
#
# 기존 피처는 전부 "V1 노드와 이 후보가 구조적으로 얼마나 닮았나"였다. 사이트가
# 개편되면 클래스명도 DOM 경로도 전부 바뀌어, 모든 후보가 똑같이 안 닮은 상태가
# 되어 판별이 되지 않았다. 반면 '거래대금'(칼럼 헤더)이나 '새로운 베스트도전'
# (섹션 제목)은 남는다 — 개편 상황에서 유일하게 기댈 수 있는 신호다.

_HEADING_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'legend'}


def _build_heading_map(soup, max_len=40):
    """각 요소에 '문서 순서상 직전 제목'을 매긴다.

    제목 후보를 class="...title..."까지 넓히면 항목 자신의 제목(웹툰 이름 등)이
    잡혀 섹션 이름을 덮어쓴다. 반복 항목을 제외해 더 정확히 만들어봤지만 홀드아웃
    Recall@30이 +8 → +5로 나빠졌다. 시맨틱 제목 태그만 쓰는 쪽이 측정상 낫다.
    """
    out, last = {}, ''
    for el in soup.find_all(True):
        if el.name in _HEADING_TAGS:
            t = el.get_text(strip=True)
            if t:
                last = t[:max_len]
        out[id(el)] = last
    return out


def _build_column_header_map(soup, max_len=40):
    """표의 각 데이터 셀에 같은 칼럼의 헤더 텍스트를 매긴다."""
    out = {}
    for table in soup.find_all('table'):
        header = None
        for tr in table.find_all('tr'):
            cells = [c for c in tr.children if getattr(c, 'name', None) in ('td', 'th')]
            if not cells:
                continue
            if header is None and all(c.name == 'th' for c in cells):
                header = [c.get_text(strip=True)[:max_len] for c in cells]
                continue
            if header is None:
                continue
            for i, c in enumerate(cells):
                out[id(c)] = header[i] if i < len(header) else ''
    return out


def _anchor_maps(node):
    """노드가 속한 문서의 앵커 맵. 문서 객체에 캐싱한다 — 후보 1,500개마다 전체
    순회를 다시 하면 치유 한 건이 분 단위가 된다."""
    root = node
    while root.parent is not None:
        root = root.parent
    maps = getattr(root, '_doma_anchor_maps', None)
    if maps is None:
        maps = (_build_heading_map(root), _build_column_header_map(root))
        root._doma_anchor_maps = maps
    return maps


def _column_header(node):
    _, colmap = _anchor_maps(node)
    cur = node
    for _ in range(12):
        if cur is None or getattr(cur, 'name', None) is None:
            return ''
        if id(cur) in colmap:
            return colmap[id(cur)]
        cur = cur.parent
    return ''


def _section_heading(node):
    headmap, _ = _anchor_maps(node)
    cur = node
    for _ in range(12):
        if cur is None or getattr(cur, 'name', None) is None:
            return ''
        if id(cur) in headmap:
            return headmap[id(cur)]
        cur = cur.parent
    return ''


def _anchor_similarity(a, b):
    """앵커가 한쪽이라도 없으면 0 — '정보 없음'을 '일치'로 세지 않는다."""
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


# ─── 반복 블록 식별 ──────────────────────────────────────────────────────────
#
# 아래 세 함수는 src/processing/feature_extractor.py의 find_repeated_block /
# get_block_label / get_block_identity_text를 그대로 옮긴 것이다. 학습 파이프라인은
# 두 피처(block_label_match, block_identity_similarity)를 계산해 왔는데 추론 쪽에는
# 구현이 없었다. heal_target이 없는 컬럼을 0으로 채우기 때문에 오류 없이 넘어갔고,
# 모델은 그 피처를 쓰도록 학습된 채로 운영에서는 늘 0을 받고 있었다.
#
# 하필 이 둘이 재설계에서 살아남는 신호다 — 클래스명과 DOM 경로가 전부 바뀌어도
# 반복 블록의 라벨(브랜드명·언론사명 같은 그룹 식별자)과 블록 본문은 남는 편이다.
# 값이 학습 때와 달라지면 안 되므로 구현을 바꾸지 말고 원본과 동일하게 유지할 것.


def _repeated_block(node, min_repeat=3, max_levels=8):
    """타겟이 속한 '거의 동일한 블록이 반복되는' 조상을 찾는다. class 없는 레벨은
    그룹 식별자로 부적합하므로 건너뛰고, 같은 class를 가진 형제가 min_repeat개
    이상인 첫 조상을 반환한다."""
    cur = node
    for _ in range(max_levels):
        if cur is None or cur.parent is None:
            return None
        cur = cur.parent
        if cur.parent is None:
            return None
        cur_classes = set(cur.get('class') or [])
        if not cur_classes:
            continue
        sibs = [s for s in cur.parent.children if getattr(s, 'name', None) == cur.name]
        similar = [s for s in sibs if set(s.get('class') or []) & cur_classes]
        if len(similar) >= min_repeat:
            return cur
    return None


def _block_label(node):
    """반복 블록의 첫 단어 — 보통 그룹을 식별하는 라벨이다."""
    blk = _repeated_block(node)
    if blk is None:
        return ''
    parts = blk.get_text(strip=True, separator=' ').split()
    return parts[0] if parts else ''


def _block_identity_text(node, max_len=60):
    blk = _repeated_block(node)
    if blk is None:
        return ''
    return blk.get_text(strip=True, separator=' ')[:max_len]


def _text_similarity(text1, text2):
    """feature_extractor.calc_text_similarity와 동일 규칙. 둘 다 비면 1.0,
    한쪽만 비면 0.0 — healer의 context_similarity와 결측 처리가 다르므로 공용화하지 않는다."""
    if not text1 and not text2:
        return 1.0
    if not text1 or not text2:
        return 0.0
    return difflib.SequenceMatcher(None, text1, text2).ratio()


def _extract_float(text):
    clean = re.sub(r'[^\d.]', '', text)
    try:
        return float(clean)
    except ValueError:
        return None

def _currency_symbol(text):
    m = re.search(r'[\$\€\£\₩\¥]', text)
    return m.group(0) if m else None

def _is_financial_number(text):
    if not text:
        return 0
    return 0 if re.search(r'[a-zA-Z가-힣]', text) else 1

def _direct_child_count(node):
    return len([c for c in node.children if c.name is not None])


# ─── 피처 추출 ───────────────────────────────────────────────────────────────

def _extract_delta_features(v1_node, v2_cand, v1_pos_info, v2_pos_info):
    v1_text    = v1_node.get_text(strip=True)
    v2_text    = v2_cand.get_text(strip=True)
    v1_classes = v1_node.get("class", [])
    v2_classes = v2_cand.get("class", [])
    v1_depth   = _dom_depth(v1_node)
    v2_depth   = _dom_depth(v2_cand)
    v1_sibs    = len(v1_node.find_next_siblings()) + len(v1_node.find_previous_siblings())
    v2_sibs    = len(v2_cand.find_next_siblings()) + len(v2_cand.find_previous_siblings())
    v1_nth     = _max_nth_child(v1_node)
    v2_nth     = _max_nth_child(v2_cand)
    v1_parent_text = v1_node.parent.get_text(strip=True) if v1_node.parent else ""
    v2_parent_text = v2_cand.parent.get_text(strip=True) if v2_cand.parent else ""
    v1_parent_tag  = v1_node.parent.name if v1_node.parent else ""
    v2_parent_tag  = v2_cand.parent.name if v2_cand.parent else ""

    s1 = set(v1_classes); s2 = set(v2_classes)
    class_sim = (len(s1 & s2) / len(s1 | s2)) if (s1 or s2) else 1.0

    t1 = _path_classes(v1_node); t2 = _path_classes(v2_cand)
    path_sim = (len(t1 & t2) / len(t1 | t2)) if (t1 or t2) else 1.0

    v1t1 = _ancestor_tags(v1_node); v2t2 = _ancestor_tags(v2_cand)
    anc_sim = difflib.SequenceMatcher(None, v1t1, v2t2).ratio() if (v1t1 or v2t2) else 1.0

    text_sim = difflib.SequenceMatcher(None, v1_parent_text, v2_parent_text).ratio() \
        if (v1_parent_text or v2_parent_text) else 1.0

    val1 = _extract_float(v1_text); val2 = _extract_float(v2_text)
    val_diff = min(abs(val1 - val2) / val1, 5.0) if (val1 and val2 and val1 != 0) else 1.0

    pos_diff = 0.0
    if v1_pos_info[1] and v2_pos_info[1]:
        pos_diff = abs(
            v1_pos_info[0].get(id(v1_node), 0) / v1_pos_info[1] -
            v2_pos_info[0].get(id(v2_cand),  0) / v2_pos_info[1]
        )

    la_v1 = _list_ancestor_index(v1_node)
    la_v2 = _list_ancestor_index(v2_cand)
    la_diff = abs(la_v1 - la_v2) if (la_v1 >= 0 and la_v2 >= 0) else -1

    v1_label = _block_label(v1_node)

    d1 = sum(1 for c in v1_text if c.isdigit()) / len(v1_text) if v1_text else 0.0
    d2 = sum(1 for c in v2_text if c.isdigit()) / len(v2_text) if v2_text else 0.0

    return {
        "position_diff":            pos_diff,
        "nth_child_diff":           abs(v1_nth - v2_nth),
        "text_length_diff":         abs(len(v1_text) - len(v2_text)),
        "dom_depth_diff":           abs(v1_depth - v2_depth),
        "sibling_count_diff":       abs(v1_sibs - v2_sibs),
        "class_similarity":         class_sim,
        "path_similarity":          path_sim,
        "is_tag_match":             1 if v1_node.name == v2_cand.name else 0,
        "is_currency_match":        1 if _currency_symbol(v1_text) == _currency_symbol(v2_text) else 0,
        "is_financial_format_match":1 if _is_financial_number(v1_text) == _is_financial_number(v2_text) else 0,
        "is_comma_format_match":    1 if (',' in v1_text) == (',' in v2_text) else 0,
        "value_diff_ratio":         val_diff,
        "context_similarity":       text_sim,
        "parent_tag_match":         1 if v1_parent_tag == v2_parent_tag else 0,
        "ancestor_tag_path_sim":    anc_sim,
        "child_count_diff":         abs(_direct_child_count(v1_node) - _direct_child_count(v2_cand)),
        "text_digit_ratio_diff":    abs(d1 - d2),
        "list_ancestor_index_diff": la_diff,
        "block_label_match":        1 if v1_label and v1_label == _block_label(v2_cand) else 0,
        "block_identity_similarity": _text_similarity(
            _block_identity_text(v1_node), _block_identity_text(v2_cand)),
    }


# ─── 셀렉터 생성 ─────────────────────────────────────────────────────────────

# Same priority order as stableAttr() in server.js's picker (buildSelector) —
# keeping the two aligned means a self-healed selector is no more fragile than
# one a human would get from the picker. Without this, generate_full_selector
# ignored attributes like data-testid entirely and fell straight to raw
# class + nth-child chains, even on sites (e.g. Spotify's web player) that
# expose stable test IDs on exactly the nodes that matter. aria-colindex is
# included because some sites' cell-level classes regenerate on every render
# even though their ARIA grid semantics (and their row's data-testid) don't.
_STABLE_ATTRS = ['data-testid', 'data-test', 'data-id', 'data-name', 'aria-colindex', 'aria-label', 'name']


def _stable_attr_pair(node):
    for attr in _STABLE_ATTRS:
        val = node.get(attr)
        if val:
            return attr, val
    return None, None


def _stable_attr_selector(node):
    attr, val = _stable_attr_pair(node)
    if attr is None:
        return None
    escaped = str(val).replace('\\', '\\\\').replace('"', '\\"')
    return f'[{attr}="{escaped}"]'


def _escape_css_ident(c):
    """Mirrors what CSS.escape() does for class names in server.js's picker.
    generate_full_selector concatenates raw class names into a selector
    string — Tailwind arbitrary-value classes like "text-[12px]" or variant
    classes like "desktop:text-[16px]" contain CSS-special characters
    ([, ], :, .) that make the resulting selector syntactically invalid
    unless escaped. The picker already escapes; this function didn't, which
    is how a self-heal on a Tailwind site produced a selector that crashed
    querySelectorAll with a SyntaxError on every subsequent run."""
    return re.sub(r'([^a-zA-Z0-9_-])', r'\\\1', c)


def _is_hash_class(c):
    """Same heuristic as isHashClass() in server.js's picker: a hyphen alone
    doesn't make a class "stable" — utility classes (flex-col) and hashed
    CSS-in-JS classes (tw69-y90cyth) both use hyphens. A low vowel ratio is a
    better signal of an auto-generated hash than hyphen presence."""
    if not c:
        return False
    letters = re.sub(r'[^a-zA-Z]', '', c)
    if len(letters) < 3:
        return False
    vowels = len(re.findall(r'[aeiouAEIOU]', letters))
    return vowels / len(letters) < 0.25


def _class_selector(node):
    """Same filtering as the picker's class fallback: drop hash-like classes,
    keep at most 2, and escape each one so the result is valid CSS."""
    classes = [c for c in (node.get('class') or []) if not _is_hash_class(c)][:2]
    if not classes:
        return ''
    return '.' + '.'.join(_escape_css_ident(c) for c in classes)


_NAV_ROLES = {'tab', 'tablist', 'menuitem', 'menu', 'menubar', 'navigation'}

# Landmark elements whose whole subtree is chrome rather than page data.
_NAV_CONTAINERS = {'nav', 'header', 'footer'}


def _looks_navigational(node):
    """Whether this node (or one of its near ancestors) is a UI navigation
    affordance — a tab or menu item — rather than a value the page is
    displaying right now. The prompt already tells the LLM not to pick these
    (a tab that *leads to* the data isn't the data), but it doesn't reliably
    comply — it has repeatedly picked exactly this kind of element with
    reasoning like "clicking this tab would show the real value." This is a
    hard backstop: excluded from the candidate pool entirely, so there's
    nothing for the LLM to pick even if it wants to.

    This used to also treat *any* node within 4 levels of an <a href> as
    navigational, which was far too broad: the data users actually target is
    very often itself a link. A product name in a ranking list, a news
    headline, a webtoon title — all of them are <a href> pointing at a detail
    page, and all of them were being deleted from the candidate pool before
    the ranker or the LLM ever saw them. Measured against the ground-truth
    holdout set, that one rule removed 21% of all correct targets, and for a
    link-heavy site (naverWebtoon) it removed 100% of them — making self-heal
    structurally impossible there no matter how good the model was.

    Real navigation affordances are identified by their semantics instead:
    an explicit ARIA role, aria-selected/data-landing-url, or living inside a
    <nav>/<header>/<footer> landmark. Those signals still catch the tabs the
    backstop was originally added for, without taking content links with
    them."""
    el = node
    for _ in range(4):
        if el is None or el.name is None:
            break
        role = (el.get('role') or '').lower()
        if role in _NAV_ROLES:
            return True
        if el.get('data-landing-url') or el.get('aria-selected') is not None:
            return True
        el = el.parent

    # Landmarks sit further up than 4 levels on most real pages, so this walk
    # is separate and deeper than the role/attribute one above.
    el = node
    for _ in range(8):
        if el is None or el.name is None:
            break
        if el.name in _NAV_CONTAINERS:
            return True
        el = el.parent
    return False


def _same_repeating_item(a, b):
    """Whether a and b look like two instances of the same repeating list
    item, not just incidentally-same-tag siblings that play different roles
    (e.g. an icon <div> and a text <div> inside one row are both <div>s but
    aren't repeating items of each other). Requires an actual shared class or
    a shared stable-attribute value — tag name alone isn't enough evidence."""
    if a is b:
        return True
    a_classes = set(a.get('class') or [])
    if a_classes and a_classes & set(b.get('class') or []):
        return True
    a_attr, a_val = _stable_attr_pair(a)
    if a_attr and b.get(a_attr) == a_val:
        return True
    return False


_LEADING_NUM_RE = re.compile(r'\d+')


def _announced_rank(item):
    """The rank an item announces, if it opens with an ordinal badge.
    Ranked lists render the position as the item's very first text
    ('1SK하이닉스'), so a leading number is that item's rank."""
    m = _LEADING_NUM_RE.match(item.get_text(strip=True))
    return int(m.group()) if m else None


def _looks_ranked(items):
    """Whether these siblings are the ranked items themselves.

    This is what separates a list of ranked rows from the cells of one row.
    Cells share a class, so they satisfy the repeating-sibling test just as
    rows do — but they read ['1SK하이닉스', '198,900원', '-2.0%'] instead of
    1, 2, 3. Treating them as the ranked items moves a sibling index across
    columns rather than up and down the ranking, which silently returns a
    neighbouring field's value while still looking like a successful heal.
    """
    if len(items) < 3:
        return False
    return all(_announced_rank(it) == i + 1 for i, it in enumerate(items[:3]))


def _repeating_siblings(item, container):
    return [s for s in container.children
            if s.name == item.name and _same_repeating_item(item, s)]


def _repeating_item_levels(element):
    """Every ancestor that could be the repeating list item, innermost first.

    Returned as (item, container, path), where path replays the descent from
    any sibling item back down to `element` as [(tag, index_among_same_tag)].
    Collecting all levels rather than stopping at the first is what lets the
    callers below pick the ranked list instead of a row's cells.
    """
    cur, path, levels = element, [], []
    for _ in range(15):
        if cur is None or cur.name is None or cur.parent is None:
            break
        sibs = [s for s in cur.parent.children
                if s.name == cur.name and _same_repeating_item(cur, s)]
        if len(sibs) >= 3 or cur.name in ['li', 'tr']:
            levels.append((cur, cur.parent, list(path)))
        same_tag = [s for s in cur.parent.children if s.name == cur.name]
        path.insert(0, (cur.name, same_tag.index(cur) if cur in same_tag else 0))
        cur = cur.parent
    return levels


def _ranked_level(levels):
    """The level whose sibling items announce 1, 2, 3 — the real ranked list."""
    for item, container, path in levels:
        if _looks_ranked(_repeating_siblings(item, container)):
            return item, container, path
    return None


def generate_full_selector(element):
    root = element
    while root.parent is not None:
        root = root.parent

    def is_unique(selector):
        try:
            return len(root.select(selector)) == 1
        except Exception:
            return False

    # Find the repeating "list item" boundary using the same heuristic as
    # _rank_override_node (a run of >=3 same-tag siblings, or a li/tr) — nth-child
    # stays meaningful from the target up through that level, since it's what
    # encodes the item's rank/position. But pinning nth-child on every ancestor
    # ABOVE the list container makes the whole selector brittle: an unrelated
    # layout shift up there (an ad slot, a conditional banner) changes sibling
    # counts and breaks the entire chain even though the ranked item itself never
    # moved. So ancestors above the list item are matched by tag+class only.
    # The innermost repeating level is often a row's cells rather than the list
    # of rows. Picking it drops the row's own position from the selector, so a
    # heal that correctly resolved rank 2 gets saved as a class-only path that
    # re-resolves to rank 1 on the next scrape — the value silently reverts.
    # Prefer the level whose items announce 1, 2, 3; fall back to the innermost
    # one for ordinary (unranked) lists.
    levels = _repeating_item_levels(element)
    ranked = _ranked_level(levels)
    list_item = ranked[0] if ranked else (levels[0][0] if levels else None)

    path, cur = [], element
    past_list_item = False
    while cur is not None and cur.name is not None:
        sel = cur.name
        if cur.get('id'):
            sel += f"#{cur.get('id')}"
            path.insert(0, sel)
            break
        attr_sel = _stable_attr_selector(cur)
        skip_position = False
        if attr_sel:
            sel += attr_sel
            # A stable attribute like data-testid identifies the *kind* of
            # node (every row in a list shares data-testid="tracklist-row"),
            # not which one — position is still needed there. But an
            # attribute like aria-colindex="3" is already unique among this
            # node's same-tag siblings, so nth-child on top is redundant and
            # fragile: if sibling structure shifts slightly on a later page
            # load (e.g. a conditionally-rendered column), the DOM-order
            # count can stop landing on the element the attribute already
            # uniquely identifies. Only add position when the (attr, value)
            # pair doesn't already disambiguate on its own.
            if cur.parent:
                attr_name, attr_val = _stable_attr_pair(cur)
                same_attr_sibs = [
                    s for s in cur.parent.children
                    if s.name == cur.name and s.get(attr_name) == attr_val
                ]
                skip_position = len(same_attr_sibs) == 1
        else:
            sel += _class_selector(cur)
        if not skip_position and not past_list_item and cur.parent:
            sibs = [s for s in cur.parent.children if s.name is not None]
            if len(sibs) > 1:
                sel += f":nth-child({sibs.index(cur) + 1})"
        path.insert(0, sel)
        if is_unique(" > ".join(path)):
            break
        if cur is list_item:
            past_list_item = True
        cur = cur.parent
    return " > ".join(path)


# ─── 컨텍스트 HTML ────────────────────────────────────────────────────────────

def _expanded_context_html(node, levels=3, max_length=3000):
    if not node:
        return ""
    anc = node
    for _ in range(levels):
        if anc.parent and anc.parent.name not in ['body', 'html', '[document]']:
            anc = anc.parent
    html = re.sub(r'<script.*?>.*?</script>', '', str(anc), flags=re.DOTALL)
    html = re.sub(r'<style.*?>.*?</style>',  '', html,      flags=re.DOTALL)
    return html[:max_length] + "\n...(생략)" if len(html) > max_length else html


# ─── 랭킹 보정 ───────────────────────────────────────────────────────────────

def _rank_override_node(candidate_node, target_rank=1):
    ranked = _ranked_level(_repeating_item_levels(candidate_node))
    if ranked is None:
        return None
    item, container, path = ranked
    valid = _repeating_siblings(item, container)
    # Too few items to hold the requested rank: this is not the list the user
    # meant. Falling back to the first item would quietly answer a different
    # question than the one asked.
    if len(valid) < target_rank:
        return None

    result = valid[target_rank - 1]
    for tag_name, child_idx in path:
        children = [s for s in result.children if s.name == tag_name]
        if len(children) > child_idx:
            result = children[child_idx]
        elif children:
            result = children[0]
        else:
            return None
    return result if result.get_text(strip=True) else None


# ─── LLM 호출 ────────────────────────────────────────────────────────────────

def _call_llm(target_name, user_intent, v1_text, v1_css,
              v1_html_snippet, v1_context_html, candidates_list, client):
    system_prompt = (
        "너는 지능형 웹 크롤러의 'DOM 구조 분석 및 자가 복구(Self-Healing) 에이전트'야.\n"
        "응답은 반드시 JSON 형식으로만 반환해. 다른 설명은 절대 덧붙이지 마."
    )
    user_prompt = f"""
웹사이트가 개편되어 기존 타겟을 찾을 수 없어.
너의 목표는 제공된 후보군(V2) 중에서 과거 타겟(V1)의 역할과 **사용자의 목적(User Intent)**에 가장 정확하게 부합하는 단 하나의 요소를 찾는 거야.

[사용자 목적 (User Intent)]
"{user_intent}"

[과거 타겟 정보 (V1)]
- 타겟 이름: {target_name}
- 과거 텍스트: "{v1_text}"
- 과거 CSS 경로: "{v1_css}"
- 과거 타겟 HTML:
```html
{v1_html_snippet}
```
- 과거 타겟 주변 구조:
```html
{v1_context_html}
```

[현재 V2 후보군 (ML 1차 필터링 결과)]
{json.dumps(candidates_list, ensure_ascii=False, indent=2)}

🚨 **[의도 기반 추출 지침 - 반드시 준수]** 🚨
1. **순위/위치 타겟 (예: 1위, 베스트, 첫 번째)**:
   - 후보의 selector와 context_html을 분석해 V2의 반복 리스트 구조를 파악해.
   - V2 리스트의 첫 번째 항목을 정확히 가리키도록 robust_selector를 직접 수정해.
   - :nth-child(X)의 숫자만 1로 바꾸고, 기존 클래스 이름을 임의로 바꾸지 마.

2. **일반 데이터 (예: 주가, 환율, 지수 숫자)**:
   - 후보 중 정확한 포맷을 가진 가장 깊은 하위 노드를 골라.

3. **튼튼한 CSS 선택자 작성**:
   - 의미 있는 고유 속성(class, id)을 활용하고, 순위 목적이면 :nth-child(X)를 포함해 유일성 보장.

4. **네비게이션 요소는 데이터가 아니다 (반드시 준수)**:
   - robust_selector가 가리키는 요소는 반드시 [사용자 목적]이 요구하는 실제 데이터 값(예: 브랜드명이면 "블랙야크" 같은 브랜드명, 가격이면 숫자)을 **지금 이 순간 담고 있는** 텍스트 요소여야 해.
   - "이 탭/링크를 클릭하면 원하는 데이터가 있는 페이지로 이동한다"는 이유로 탭, 메뉴, "더보기"/"랭킹" 같은 네비게이션 링크나 버튼을 고르면 안 돼 — 그건 데이터가 아니라 페이지 이동 수단이야. [과거 텍스트]와 같은 종류의 값이 아니라 메뉴/탭 레이블(예: "랭킹", "Home", "더보기")이라면 그 후보는 제외해.
   - V2 후보군 전체를 살펴봐도 실제 데이터를 담은 요소가 하나도 없다면(예: 아직 목록 페이지로 진입하기 전 상태), 억지로 그럴듯한 후보를 골라내지 마. 이 경우 "selected_id": null, "confidence": 0.0으로 정직하게 응답하고, reasoning에 "V2에 실제 데이터가 없고 웹사이트 구조가 근본적으로 바뀌었을 가능성"을 명시해 — 틀린 답을 내는 것보다 모른다고 하는 게 낫다.

아래 JSON 포맷으로 출력해.
{{
  "selected_id": int,
  "robust_selector": "string",
  "confidence": float,
  "extracted_text": "string",
  "reasoning": "string"
}}
"""
    response_schema = {
        "type": "object",
        "properties": {
            "selected_id":     {"anyOf": [{"type": "integer"}, {"type": "null"}]},
            "robust_selector": {"type": "string"},
            "confidence":      {"type": "number"},
            "extracted_text":  {"type": "string"},
            "reasoning":       {"type": "string"},
        },
        "required": ["selected_id", "robust_selector", "confidence", "extracted_text", "reasoning"],
        "additionalProperties": False,
    }

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            output_config={"format": {"type": "json_schema", "schema": response_schema}},
        )
        return json.loads(resp.content[0].text)
    except Exception as e:
        return {"selected_id": None, "confidence": 0, "reasoning": f"API 에러: {e}"}


# ─── Tailwind 셀렉터 파싱 헬퍼 ───────────────────────────────────────────────

def _safe_select_one(soup, selector):
    """
    BeautifulSoup의 cssselect가 지원하지 않는 Tailwind arbitrary-value 클래스
    (예: min-h-\[170px\], w-\[516px\])가 포함된 셀렉터를 안전하게 처리합니다.

    1차: 원본 셀렉터로 시도
    2차: 이스케이프된 대괄호 (\[...\]) 클래스를 제거한 단순화 셀렉터로 재시도
    """
    try:
        node = soup.select_one(selector)
        if node:
            return node
    except Exception:
        pass

    # Tailwind arbitrary value 클래스 제거: min-h-\[170px\], w-\[516px\] 등
    simplified = re.sub(r'[\w-]+\\\[.*?\\\]', '', selector)
    # 연속된 점 정리 (.foo..bar → .foo.bar)
    simplified = re.sub(r'\.{2,}', '.', simplified)
    # 빈 선택자 조각 제거 (> . > 같은 경우)
    simplified = re.sub(r'>\s*[.#]?\s*>', '>', simplified)
    simplified = re.sub(r'\s+', ' ', simplified).strip()

    if simplified and simplified != selector:
        try:
            node = soup.select_one(simplified)
            if node:
                return node
        except Exception:
            pass

    return None


# ─── 공개 인터페이스 ──────────────────────────────────────────────────────────

def rank_candidates(target_v1, filtered, probs):
    """후보를 좋은 순으로 정렬한 인덱스를 돌려준다. 모델 확률에 앵커 정렬을 얹는다.

    평가(src/eval/eval_ranker.py)도 이 함수를 쓴다. 순위 결정을 양쪽에서 따로
    구현하면 평가가 실재하지 않는 파이프라인을 재게 된다 — nav 필터와 셀렉터
    생성에서 이미 같은 종류의 어긋남을 겪었다.

    왜 앵커를 학습 피처가 아니라 규칙으로 쓰는가:
      같은 신호를 피처로 넣어 재학습했더니 모델이 중요도 21위/22위로 사실상
      무시하면서 트리 분기만 흔들어, 홀드아웃 Recall@30이 69.6% → 65.9%로
      내려갔다. 학습 사이트 10곳은 기존 구조 피처가 잘 듣는 곳들이라 '개편으로
      클래스와 DOM 경로가 통째로 무너진' 상황이 학습 분포에 아예 없다. 모델은
      쓸 일이 없는 피처를 배울 수 없다. 규칙으로 적용하면 같은 신호가 Recall@30을
      69.6% → 75.4%로 올린다 (naverWebtoon 0% → 50%).
    """
    v1_col     = _column_header(target_v1)
    v1_section = _section_heading(target_v1)
    if not (v1_col or v1_section):
        return probs.argsort()[::-1]

    anchor = np.array([
        max(_anchor_similarity(v1_col, _column_header(c)),
            _anchor_similarity(v1_section, _section_heading(c)))
        for c in filtered
    ])
    # 굵게 끊어 층을 만든다. 층 안에서는 모델 확률이 순서를 정하므로, 앵커가
    # 비슷한 후보들 사이에서는 기존 랭커의 판단을 그대로 따른다.
    tier = np.round(anchor, 1)
    return np.lexsort((probs, tier))[::-1]


def heal_target(
    v1_html: str,
    v2_html: str,
    css_selector: str,
    user_intent: str,
    target_name: str = "타겟",
) -> dict:
    """
    HTML이 변경되어 깨진 CSS 셀렉터를 복구합니다.

    Returns:
        status: "healed" | "no_change_needed" | "failed"
        robust_selector, extracted_text, confidence, reasoning
    """
    model, expected_columns, llm_client = _get_resources()

    soup_v1 = BeautifulSoup(v1_html, "lxml")
    soup_v2 = BeautifulSoup(v2_html, "lxml")

    target_v1 = _safe_select_one(soup_v1, css_selector)
    if not target_v1:
        return {"status": "failed", "reason": f"V1에서 셀렉터를 찾지 못했습니다. (selector: {css_selector[:80]}...)"}

    # 기존 셀렉터가 V2에서도 동작하면 치유 불필요
    existing = _safe_select_one(soup_v2, css_selector)
    if existing:
        return {
            "status":           "no_change_needed",
            "robust_selector":  css_selector,
            "extracted_text":   existing.get_text(strip=True),
            "confidence":       1.0,
            "reasoning":        "기존 셀렉터가 V2에서도 유효합니다.",
        }

    v1_text = target_v1.get_text(strip=True)

    # 위치 정보
    v1_nodes   = soup_v1.find_all()
    v1_pos_info = ({id(t): i for i, t in enumerate(v1_nodes)}, len(v1_nodes))
    v2_nodes   = soup_v2.find_all()
    v2_pos_info = ({id(t): i for i, t in enumerate(v2_nodes)}, len(v2_nodes))

    # 후보 수집 (텍스트 있고 50자 미만인 리프 노드, 네비게이션 요소 제외)
    candidates = soup_v2.find_all(['b', 'td', 'span', 'div', 'a', 'p', 'strong', 'em', 'li'])
    filtered   = [
        c for c in candidates
        if c.get_text(strip=True) and len(c.get_text(strip=True)) < 50
        and not _looks_navigational(c)
    ]

    if not filtered:
        # V2 HTML에 텍스트를 가진 후보가 하나도 없으면(예: CSR 페이지가 아직 데이터를
        # 렌더링하기 전에 캡처됨) 0개 샘플로 StandardScaler에 넘어가 알아보기 힘든 sklearn
        # 에러가 난다 — 여기서 먼저 걸러서 명확한 실패 사유를 반환한다.
        return {"status": "failed", "reason": "V2 HTML에서 후보 요소를 찾지 못했습니다 (페이지가 비어있거나 아직 로드되지 않았을 수 있습니다)."}

    # ML 필터링
    features_list = [_extract_delta_features(target_v1, c, v1_pos_info, v2_pos_info) for c in filtered]
    df = pd.DataFrame(features_list)
    for col in expected_columns:
        if col not in df.columns:
            df[col] = 0
    df = df[expected_columns]

    probs         = model.predict_proba(df)[:, 1]
    top_k_indices = rank_candidates(target_v1, filtered, probs)[:TOP_K]

    candidates_for_llm = [
        {
            "id":           i,
            "ml_score":     round(probs[idx], 3),
            "text":         filtered[idx].get_text(strip=True),
            "selector":     generate_full_selector(filtered[idx]),
            "node_html":    str(filtered[idx]),
            "context_html": _expanded_context_html(filtered[idx], levels=3, max_length=2000),
        }
        for i, idx in enumerate(top_k_indices)
    ]

    # LLM 정밀 타겟팅
    llm_result = _call_llm(
        target_name, user_intent,
        v1_text, css_selector,
        str(target_v1), _expanded_context_html(target_v1, levels=3),
        candidates_for_llm, llm_client,
    )

    final_id = llm_result.get("selected_id")
    # Bound by the list actually sent, not TOP_K: a page with fewer than TOP_K
    # candidates sends a shorter list, and an id past its end used to raise
    # IndexError below — a 500 that Spring records as a bare failure with no
    # alert, so nobody was ever asked to pick the element again.
    if final_id is None or not (0 <= final_id < len(top_k_indices)):
        # llm_result["reasoning"] holds either the LLM's own explanation for
        # declining every candidate, or (on an API-level failure) the
        # "API 에러: ..." message _call_llm sets in its except clause — surface
        # whichever we have instead of this generic fallback, since collapsing
        # both cases into one message makes them impossible to tell apart later.
        detail = llm_result.get("reasoning") or "선택된 노드 없음"
        return {"status": "failed", "reason": f"LLM이 적합한 노드를 찾지 못했습니다: {detail}"}

    original_idx = top_k_indices[final_id]
    healed_node  = filtered[original_idx]

    # 후처리: extracted_text와 일치하는 자식 노드로 축소
    extracted_text = llm_result.get("extracted_text", "").strip()
    if extracted_text and extracted_text != healed_node.get_text(strip=True):
        for desc in healed_node.descendants:
            if desc.name and desc.get_text(strip=True) == extracted_text:
                healed_node = desc
                break

    # 셀렉터 검증 + 랭킹 타겟 override
    #
    # The LLM is asked to hand-edit a candidate's own selector text (e.g. bump
    # an nth-child index to point at rank #1), but it doesn't reliably follow
    # that instruction — sometimes it free-writes a selector from scratch, and
    # even when it "just changes the number" it doesn't know our own rules for
    # when position is redundant (see generate_full_selector / _class_selector).
    # Trusting that string when it happened to validate against V2 at heal
    # time is exactly how the same "nth-of-type stacked on an already-unique
    # attribute" selector kept getting re-saved no matter how much
    # generate_full_selector itself was fixed — it was simply never being
    # called. The LLM's text is now used only to detect the ranking-override
    # signal below (is it pointing at a different, better node?); the selector
    # string that actually gets saved always comes from our own
    # generate_full_selector(), never from the LLM's own CSS.
    llm_selector = llm_result.get("robust_selector") or ""
    requested_rank = _requested_rank(target_name)
    is_ranking = requested_rank is not None

    if llm_selector:
        try:
            test_node = soup_v2.select_one(llm_selector)
        except Exception:
            test_node = None
        if test_node and test_node != healed_node and is_ranking and test_node.get_text(strip=True):
            healed_node = test_node

    robust_selector = generate_full_selector(healed_node)

    if is_ranking:
        override = _rank_override_node(filtered[original_idx], target_rank=requested_rank)
        if override and override.get_text(strip=True):
            healed_node = override
            robust_selector = generate_full_selector(healed_node)

    return {
        "status":          "healed",
        "robust_selector": robust_selector,
        "extracted_text":  healed_node.get_text(strip=True),
        "confidence":      float(llm_result.get("confidence", 0)),
        "reasoning":       llm_result.get("reasoning", ""),
    }
