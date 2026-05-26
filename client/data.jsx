// data.jsx — mock data + shared atoms (icons, chips, etc.)
// All exports are attached to window so other Babel scripts can use them.

// ─── Icons (inline SVGs, stroke-based, 1.6 weight) ─────────────────────────
const Icon = ({ name, className = "icon", size }) => {
  const paths = {
    grid:        <><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></>,
    crawler:     <><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></>,
    inbox:       <><path d="M3 13l3-8h12l3 8"/><path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/><path d="M3 13h5l1 2h6l1-2h5"/></>,
    deploy:      <><path d="M4 16l8-12 8 12"/><path d="M9 20l3-4 3 4"/></>,
    spark:       <><path d="M12 3v3M12 18v3M5.5 5.5L7.6 7.6M16.4 16.4l2.1 2.1M3 12h3M18 12h3M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/></>,
    settings:    <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    plus:        <path d="M12 5v14M5 12h14"/>,
    arrow_r:     <path d="M5 12h14M13 6l6 6-6 6"/>,
    arrow_l:     <path d="M19 12H5M11 6l-6 6 6 6"/>,
    chevron_r:   <path d="M9 6l6 6-6 6"/>,
    chevron_d:   <path d="M6 9l6 6 6-6"/>,
    chevron_u:   <path d="M6 15l6-6 6 6"/>,
    check:       <path d="M5 12l5 5L20 7"/>,
    x:           <path d="M6 6l12 12M18 6L6 18"/>,
    dot:         <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>,
    play:        <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none"/>,
    pause:       <><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></>,
    refresh:     <><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></>,
    bolt:        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>,
    bell:        <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
    code:        <><path d="M16 6l6 6-6 6"/><path d="M8 18l-6-6 6-6"/></>,
    link:        <><path d="M10 13a5 5 0 0 0 7.1.1l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1-.1l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></>,
    cube:        <><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5M12 22V12"/></>,
    target:      <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
    search:      <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    user:        <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    eye:         <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    fork:        <><circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 6v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6M12 12v6"/></>,
    activity:    <path d="M22 12h-4l-3 9-6-18-3 9H2"/>,
    db:          <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    rocket:      <><path d="M14 11a4 4 0 1 0-4-4"/><path d="M14 11l5-2 2-7-7 2-2 5M14 11l-3 3-5 1-1 5 5-1 3-3M9 19l-3 3M14 17l-3 3"/></>,
    slack:       <><rect x="3" y="10" width="6" height="4" rx="2"/><rect x="15" y="10" width="6" height="4" rx="2"/><rect x="10" y="3" width="4" height="6" rx="2"/><rect x="10" y="15" width="4" height="6" rx="2"/></>,
    mail:        <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></>,
    csv:         <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2M8 17h2M14 13h2M14 17h2"/></>,
    history:     <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4M12 7v5l3 2"/></>,
    chart:       <><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-7"/></>,
    layers:      <><path d="M12 2l10 6-10 6L2 8l10-6z"/><path d="M2 14l10 6 10-6M2 11l10 6 10-6"/></>,
    filter:      <path d="M3 4h18l-7 9v7l-4-2v-5L3 4z"/>,
    download:    <><path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 21h16"/></>,
    more:        <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
    sigma:       <path d="M18 4H6l7 8-7 8h12"/>,
    triangle_up: <path d="M12 6l6 10H6l6-10z" fill="currentColor" stroke="none"/>,
    triangle_dn: <path d="M12 18l6-10H6l6 10z" fill="currentColor" stroke="none"/>,
    sun:         <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon:        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>,
    sparkles:    <><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M19 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z"/></>,
    cpu:         <><rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>,
    funnel:      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4z"/>,
    wand:        <><path d="M15 4l-7 7"/><path d="M19 2v2M21 4h-2M19 6V4M17 4h2"/><path d="M3 21l9-9 3 3-9 9-3-3z"/></>,
    edit:        <><path d="M12 20h9"/><path d="M16.5 3.5a2 2 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></>,
    info:        <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></>,
  };
  const s = size ? { width: size, height: size } : null;
  return <svg className={className} style={s} viewBox="0 0 24 24" aria-hidden="true">{paths[name] || null}</svg>;
};

// ─── Score donut ───────────────────────────────────────────────────────────
const ScoreRing = ({ value, threshold = 90, size = 64, stroke = 6, label = true }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = value >= threshold ? 'var(--ok)' : value >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{position:'relative', width:size, height:size, flexShrink:0}}>
      <svg className="ring" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{transition:'stroke-dashoffset .4s ease'}}/>
        {/* threshold tick */}
        <circle cx={size/2} cy={size/2} r={r}
          stroke="rgba(255,255,255,0.35)" strokeWidth={1} fill="none"
          strokeDasharray={`1 ${c - 1}`}
          strokeDashoffset={c - (threshold / 100) * c}/>
      </svg>
      {label && (
        <div style={{
          position:'absolute', inset:0, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', fontFamily:'var(--mono)'
        }}>
          <div style={{fontSize: size > 50 ? 16 : 13, fontWeight:600, lineHeight:1}}>
            {value.toFixed(0)}
          </div>
          {size > 50 && <div style={{fontSize:9, color:'var(--text-dim)', marginTop:2, letterSpacing:'0.06em'}}>SCORE</div>}
        </div>
      )}
    </div>
  );
};

// ─── Sparkline (inline SVG) ────────────────────────────────────────────────
const Spark = ({ data, w = 80, h = 24, color = "var(--accent)", fill = true }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = Math.max(max - min, 0.0001);
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i*step},${h - ((v-min)/span)*(h-2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:'block'}}>
      {fill && (
        <polygon points={`0,${h} ${points} ${w},${h}`} fill={color} opacity="0.12"/>
      )}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ─── Status chip ───────────────────────────────────────────────────────────
const STATUS_LABEL = {
  healthy: { label: '정상', cls: 'ok' },
  healing: { label: '자가치유 중', cls: 'healing' },
  pending: { label: '승인 대기', cls: 'warn' },
  failed:  { label: '실패', cls: 'danger' },
  paused:  { label: '일시중지', cls: '' },
};
const StatusChip = ({ status }) => {
  const s = STATUS_LABEL[status] || STATUS_LABEL.healthy;
  return <span className={`chip ${s.cls}`}><span className="dot"/>{s.label}</span>;
};

// ─── Mock data ─────────────────────────────────────────────────────────────
const seedSpark = (n, base, jitter, trend = 0) => {
  const out = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * jitter + trend;
    out.push(Math.max(0, Math.min(100, v)));
  }
  return out;
};

const CRAWLERS = [
  {
    id: 'cr_8x2k',
    name: '쿠팡 노트북 카테고리 베스트 1위',
    url: 'coupang.com/np/categories/178794',
    org: '핀치 리서치',
    status: 'healthy',
    score: 97.8,
    threshold: 90,
    schedule: '1분마다',
    lastRun: '40초 전',
    lastValue: 'LG 그램 14 (2025)',
    runs7d: 10080,
    healed: 2,
    spark: seedSpark(30, 96, 3),
    altCategory: '소비 수요',
    type: 'commerce',
    delivery: ['REST API', 'Webhook'],
    owner: 'minji.k',
  },
  {
    id: 'cr_4n1p',
    name: '쿠팡 PS5 슬림 판매가',
    url: 'coupang.com/vp/products/7382947123',
    org: '핀치 리서치',
    status: 'pending',
    score: 86.3,
    threshold: 90,
    css_selector: 'span.price_old',
    user_intent: '광고·배송비 제외, 실제 판매가(원 단위 숫자)를 추출해줘.',
    schedule: '5분마다',
    lastRun: '4분 전',
    lastValue: '529,000원',
    runs7d: 2016,
    healed: 3,
    spark: seedSpark(30, 88, 8, -0.3),
    altCategory: '소비 수요',
    type: 'commerce',
    delivery: ['Webhook', 'CSV'],
    owner: 'jw.han',
  },
  {
    id: 'cr_q72j',
    name: '잡코리아 IT개발 신규 공고 수',
    url: 'jobkorea.co.kr/recruit/joblist?dev',
    org: '매크로 리서치',
    status: 'healthy',
    score: 99.1,
    threshold: 80,
    schedule: '10분마다',
    lastRun: '3분 전',
    lastValue: '14,392건',
    runs7d: 1008,
    healed: 0,
    spark: seedSpark(30, 99, 1),
    altCategory: '노동 시장',
    type: 'labor',
    delivery: ['REST API'],
    owner: 'soohyun.lee',
  },
  {
    id: 'cr_5bw0',
    name: '네이버 부동산 — 서초 84A 호가 평균',
    url: 'land.naver.com/complexes/8928',
    org: '리얼리티 랩',
    status: 'healing',
    score: 73.2,
    threshold: 85,
    schedule: '30분마다',
    lastRun: '진행 중',
    lastValue: '—',
    runs7d: 336,
    healed: 1,
    spark: seedSpark(30, 80, 12, -0.6),
    altCategory: '부동산',
    type: 'realestate',
    delivery: ['Webhook'],
    owner: 'minji.k',
  },
  {
    id: 'cr_h93s',
    name: 'DART 공시 — 코스피200 신규/정정',
    url: 'dart.fss.or.kr/dsab001/main.do',
    org: '핀치 리서치',
    status: 'healthy',
    score: 97.8,
    threshold: 95,
    schedule: '1분마다',
    lastRun: '20초 전',
    lastValue: '신규 공시 3건',
    runs7d: 10080,
    healed: 2,
    spark: seedSpark(30, 97, 2),
    altCategory: '규제·공시',
    type: 'regulatory',
    delivery: ['REST API', 'Webhook', 'Slack'],
    owner: 'soohyun.lee',
  },
  {
    id: 'cr_2vqt',
    name: '11번가 — 가전 카테고리 베스트 Top 20',
    url: '11st.co.kr/browsing/BestSeller.tmall',
    org: '핀치 리서치',
    status: 'failed',
    score: 24.1,
    threshold: 90,
    css_selector: '#itembest_T > ul.uxb-img.first > li.first > div > div.info > em > a',
    user_intent: '종합 베스트 상품 목록에서 1위 상품의 이름을 찾아줘.',
    schedule: '15분마다',
    lastRun: '38분 전',
    lastValue: '—',
    runs7d: 672,
    healed: 0,
    spark: seedSpark(30, 70, 20, -1.5),
    altCategory: '소비 수요',
    type: 'commerce',
    delivery: ['CSV'],
    owner: 'jw.han',
  },
  {
    id: 'cr_v6m1',
    name: '사람인 — 신규 채용공고 일일 집계',
    url: 'saramin.co.kr/zf_user/jobs/list/job-category',
    org: '매크로 리서치',
    status: 'healthy',
    score: 99.5,
    threshold: 85,
    schedule: '1시간마다',
    lastRun: '12분 전',
    lastValue: '8,214건',
    runs7d: 168,
    healed: 0,
    spark: seedSpark(30, 99, 1.5),
    altCategory: '노동 시장',
    type: 'labor',
    delivery: ['REST API'],
    owner: 'soohyun.lee',
  },
  {
    id: 'cr_p3la',
    name: '멜론 차트 실시간 1위 — 곡 제목',
    url: 'melon.com/chart/index.htm',
    org: '엔터 인덱스',
    status: 'healthy',
    score: 94.2,
    threshold: 80,
    schedule: '5분마다',
    lastRun: '2분 전',
    lastValue: 'APT. (ROSÉ, Bruno Mars)',
    runs7d: 2016,
    healed: 4,
    spark: seedSpark(30, 92, 5),
    altCategory: '미디어 트렌드',
    type: 'media',
    delivery: ['Webhook'],
    owner: 'jw.han',
  },
];

// pending-approval candidate (the centerpiece of the Approvals screen)
const PENDING_APPROVAL = {
  crawlerId: 'cr_4n1p',
  crawler: '쿠팡 PS5 슬림 가격',
  url: 'coupang.com/vp/products/7382947123',
  detectedAt: '2026-05-12 09:14:22 KST',
  errorReason: '기존 selector `span.price_old` 가 매칭되지 않음. 페이지 구조가 변경됨.',
  threshold: 90,
  finalScore: 86.3,

  oldElement: {
    tag: 'span',
    classes: ['price_old'],
    attrs: { 'font-weight':'bold', color:'red' },
    text: '529,000원',
    context: ['장바구니', '바로구매', '와우 무료배송', '재고 있음'],
  },
  newElement: {
    tag: 'div',
    classes: ['val_new', 'bold-num'],
    attrs: { 'font-weight':'bold', color:'black' },
    text: '529,000원',
    context: ['장바구니 담기', '바로구매', '로켓배송', '재고 있음'],
  },

  // breakdown — matches the spec
  signals: [
    { key: 'data_type',  label: '데이터 타입',      weight: 0.50, raw: 1.00, why: '숫자 + 천단위 콤마 + "원" 접미, 기존과 동일 패턴' },
    { key: 'context',    label: '주변 문맥',        weight: 0.30, raw: 0.93, why: '"장바구니", "바로구매" 등 4개 키워드 일치 (cos θ)' },
    { key: 'visual',     label: '시각 속성',        weight: 0.15, raw: 0.20, why: 'font-weight 일치, color/tag 불일치 (Jaccard)' },
    { key: 'dom',        label: 'DOM 구조',         weight: 0.05, raw: 0.05, why: '경로 깊이 7→9, 부모 셀렉터 변경' },
  ],

  candidates: [
    { rank:1, selector:'div.val_new.bold-num', score:86.3, preview:'529,000원' },
    { rank:2, selector:'div.product-price__amount', score:71.4, preview:'529,000원' },
    { rank:3, selector:'span.price.discount', score:54.0, preview:'19% 할인' },
  ],
};

const RUN_HISTORY = [
  { ts:'09:14:22', status:'pending', dur:'1.2s', note:'자가치유 후보 발견, 사용자 확인 대기', score:86.3 },
  { ts:'08:59:14', status:'failed',  dur:'0.4s', note:'span.price_old 매칭 실패', score:null },
  { ts:'08:44:09', status:'healthy', dur:'1.1s', note:'정상 수집 — 529,000원', score:98.7 },
  { ts:'08:29:08', status:'healthy', dur:'1.0s', note:'정상 수집 — 529,000원', score:98.7 },
  { ts:'08:14:11', status:'healthy', dur:'1.3s', note:'정상 수집 — 539,000원', score:98.4 },
  { ts:'07:59:09', status:'healing', dur:'2.1s', note:'미세 변동 감지, 자가복구 (92.4)',  score:92.4 },
  { ts:'07:44:08', status:'healthy', dur:'0.9s', note:'정상 수집 — 539,000원', score:99.0 },
  { ts:'07:29:12', status:'healthy', dur:'1.0s', note:'정상 수집 — 539,000원', score:99.0 },
];

const ORGS = ['핀치 리서치', '매크로 리서치', '리얼리티 랩', '엔터 인덱스'];

// ─── Alt-data templates (used by new-crawler wizard) ───────────────────────
const TEMPLATES = [
  { id:'tpl_coupang_rank', cat:'소비 수요', title:'쿠팡 카테고리 1위 추적',
    desc:'카테고리 베스트 페이지의 1위 상품명을 1분 단위로 추적',
    intent:'쿠팡 카테고리 베스트 페이지의 실시간 1위 상품명',
    icon:'cube', interval:'1분', users:128 },
  { id:'tpl_dart',         cat:'규제·공시', title:'DART 신규 공시 모니터',
    desc:'코스피200 종목의 신규/정정 공시를 즉시 감지',
    intent:'DART 공시 목록의 최신 공시 제목과 발행 시각',
    icon:'cube', interval:'1분', users:94 },
  { id:'tpl_naverland',    cat:'부동산',    title:'네이버 부동산 호가 평균',
    desc:'특정 단지·평형의 매매 호가 평균값',
    intent:'단지·평형 페이지의 매매 호가들의 평균값(만원 단위 숫자)',
    icon:'cube', interval:'30분', users:46 },
  { id:'tpl_saramin_jobs', cat:'노동 시장', title:'채용공고 신규 수',
    desc:'사람인·잡코리아의 일별 신규 채용공고 집계',
    intent:'카테고리별 신규 채용공고 수 (오늘 등록된 건수)',
    icon:'cube', interval:'1시간', users:31 },
  { id:'tpl_eleven_best',  cat:'소비 수요', title:'카테고리 베스트 Top N',
    desc:'베스트셀러 페이지의 상위 N개 상품명·랭킹·가격',
    intent:'베스트셀러 페이지 상위 20개의 상품명·랭킹·표시 가격',
    icon:'cube', interval:'15분', users:73 },
  { id:'tpl_melon_chart',  cat:'미디어',    title:'멜론 차트 1위',
    desc:'음원 차트의 실시간 1위 곡 제목',
    intent:'멜론 실시간 차트의 1위 곡 제목과 가수명',
    icon:'cube', interval:'5분', users:22 },
];

// ─── Tiny components shared across screens ────────────────────────────────
const SectionTitle = ({ eyebrow, title, children, action }) => (
  <div style={{display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:14, gap:16}}>
    <div>
      {eyebrow && <div style={{fontSize:11, color:'var(--text-dim)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4, fontFamily:'var(--mono)'}}>{eyebrow}</div>}
      <h2 style={{fontSize:22, fontWeight:600}}>{title}</h2>
      {children && <div style={{color:'var(--text-mute)', marginTop:6, fontSize:13}}>{children}</div>}
    </div>
    {action}
  </div>
);

const Stat = ({ label, value, sub, accent, icon }) => (
  <div className="card" style={{padding:'14px 16px', display:'flex', flexDirection:'column', gap:6}}>
    <div style={{display:'flex', alignItems:'center', gap:8, color:'var(--text-mute)', fontSize:11.5, letterSpacing:'0.04em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>
      {icon && <Icon name={icon} className="icon icon-sm"/>}
      {label}
    </div>
    <div style={{fontSize:26, fontWeight:600, fontFamily:'var(--mono)', letterSpacing:'-0.02em', color: accent || 'var(--text)'}}>{value}</div>
    {sub && <div style={{fontSize:12, color:'var(--text-mute)'}}>{sub}</div>}
  </div>
);

// ── 다음 실행 시각 계산 ────────────────────────────────────────────────────────
function nextRunLabel(scheduleKey) {
  const now = new Date();
  const next = new Date(now);

  if (scheduleKey === 'daily-9' || scheduleKey === '매일 09:00') {
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
  } else if (scheduleKey === 'hourly' || scheduleKey === '매시간') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
  } else if (scheduleKey === '15m' || scheduleKey === '15분마다') {
    const m = Math.ceil((now.getMinutes() + 1) / 15) * 15;
    next.setMinutes(m, 0, 0);
    if (m >= 60) { next.setHours(next.getHours() + 1); next.setMinutes(0, 0, 0); }
  } else {
    return '—';
  }

  const diffMs  = next - now;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1)   return '곧 실행';
  if (diffMin < 60)  return `${diffMin}분 후`;
  const h = Math.floor(diffMin / 60), m = diffMin % 60;
  return m > 0 ? `${h}시간 ${m}분 후` : `${h}시간 후`;
}

// expose
Object.assign(window, {
  Icon, ScoreRing, Spark, StatusChip, STATUS_LABEL,
  CRAWLERS, PENDING_APPROVAL, RUN_HISTORY, ORGS, TEMPLATES,
  SectionTitle, Stat, nextRunLabel,
});
