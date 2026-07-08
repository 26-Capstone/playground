"""
Self-Healing Crawler — 핵심 추론 모듈
heal_target()을 호출해 V2 HTML에서 복구된 셀렉터와 값을 반환합니다.
"""
import os
import re
import json
import pathlib
import difflib

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
_RANKING_KEYWORDS = ['1위', '베스트', '순위', '랭킹', '첫 번째']


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
    }


# ─── 셀렉터 생성 ─────────────────────────────────────────────────────────────

def generate_full_selector(element):
    path, cur = [], element
    while cur is not None and cur.name is not None:
        sel = cur.name
        if cur.get('id'):
            sel += f"#{cur.get('id')}"
            path.insert(0, sel)
            break
        if cur.get('class'):
            sel += "." + ".".join(cur.get('class'))
        if cur.parent:
            sibs = [s for s in cur.parent.children if s.name is not None]
            if len(sibs) > 1:
                sel += f":nth-child({sibs.index(cur) + 1})"
        path.insert(0, sel)
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
    cur = candidate_node
    path_from_list_item = []
    list_item_node = list_container = None

    for _ in range(15):
        if cur.parent is None:
            break
        sibs = [s for s in cur.parent.children if s.name == cur.name]
        if len(sibs) >= 3 or cur.name in ['li', 'tr']:
            list_item_node = cur
            list_container = cur.parent
            break
        idx = sibs.index(cur)
        path_from_list_item.insert(0, (cur.name, idx))
        cur = cur.parent

    if not list_container:
        return None
    valid = [s for s in list_container.children if s.name == list_item_node.name]
    if not valid:
        return None
    target_item = valid[target_rank - 1] if len(valid) >= target_rank else valid[0]

    result = target_item
    for tag_name, child_idx in path_from_list_item:
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

    # 후보 수집 (텍스트 있고 50자 미만인 리프 노드)
    candidates = soup_v2.find_all(['b', 'td', 'span', 'div', 'a', 'p', 'strong', 'em', 'li'])
    filtered   = [c for c in candidates if c.get_text(strip=True) and len(c.get_text(strip=True)) < 50]

    # ML 필터링
    features_list = [_extract_delta_features(target_v1, c, v1_pos_info, v2_pos_info) for c in filtered]
    df = pd.DataFrame(features_list)
    for col in expected_columns:
        if col not in df.columns:
            df[col] = 0
    df = df[expected_columns]

    probs          = model.predict_proba(df)[:, 1]
    top_k_indices  = probs.argsort()[-TOP_K:][::-1]

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
    if final_id is None or not (0 <= final_id < TOP_K):
        return {"status": "failed", "reason": "LLM이 적합한 노드를 찾지 못했습니다."}

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
    robust_selector = llm_result.get("robust_selector") or generate_full_selector(healed_node)
    is_ranking = any(kw in target_name for kw in _RANKING_KEYWORDS)

    try:
        test_node = soup_v2.select_one(robust_selector)
        if test_node and test_node != healed_node and is_ranking and test_node.get_text(strip=True):
            healed_node = test_node
    except Exception:
        robust_selector = generate_full_selector(healed_node)

    if is_ranking:
        override = _rank_override_node(filtered[original_idx], target_rank=1)
        if override and override.get_text(strip=True):
            healed_node = override

    return {
        "status":          "healed",
        "robust_selector": robust_selector,
        "extracted_text":  healed_node.get_text(strip=True),
        "confidence":      float(llm_result.get("confidence", 0)),
        "reasoning":       llm_result.get("reasoning", ""),
    }
