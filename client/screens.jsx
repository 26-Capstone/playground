// screens.jsx — All the screens for Mender.
// Components are attached to window for cross-script access.

// ─── Overview (Dashboard) ──────────────────────────────────────────────────
function OverviewScreen({ crawlers = [], stats, approvalCount = 0, onOpenCrawler, onGoApprovals, onNewCrawler, onRefresh, onDeleteCrawler }) {
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [menu, setMenu] = React.useState(null); // { id, name, x, y }

  // 메뉴 외부 클릭 시 닫기
  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [!!menu]);

  const handleRefresh = () => {
    if (!onRefresh) return;
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 800);
  };

  const tabs = [
    { id:'all',      label:'전체',         count: crawlers.length },
    { id:'pending',  label:'승인 대기',     count: crawlers.filter(c=>c.status==='pending').length },
    { id:'healing',  label:'자가치유 중',   count: crawlers.filter(c=>c.status==='healing').length },
    { id:'failed',   label:'실패',         count: crawlers.filter(c=>c.status==='failed').length },
    { id:'paused',   label:'일시중지',     count: crawlers.filter(c=>c.status==='paused').length },
  ];

  const rows = crawlers.filter(c =>
    (filter==='all' || c.status===filter) &&
    (!query || c.name.includes(query) || c.url.includes(query))
  );

  // stats 포맷 헬퍼
  const fmtMs = ms => {
    if (ms == null) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
  };
  const fmtPct = v => v != null ? v.toFixed(2) + '%' : '—';
  const activeFeeds   = stats ? stats.activeFeedsCount     : crawlers.filter(c => c.status !== 'paused').length;
  const successRate   = stats ? fmtPct(stats.successRate7d) : '—';
  const rateColor     = stats && stats.successRate7d != null
    ? (stats.successRate7d >= 95 ? 'var(--ok)' : stats.successRate7d >= 80 ? 'var(--warn)' : 'var(--danger)')
    : 'var(--text)';
  const totalHealed   = stats ? stats.totalHealed          : '—';
  const avgDur        = stats ? fmtMs(stats.avgDurationMs)  : '—';
  const p95Dur        = stats ? fmtMs(stats.p95DurationMs)  : '—';
  const noData        = stats && stats.resultCount7d === 0;

  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle
        eyebrow="ALTERNATIVE DATA — REAL-TIME PIPELINES"
        title="대안 데이터 운영 현황"
        action={
          <div style={{display:'flex', gap:8}}>
            <button className="btn" onClick={handleRefresh} disabled={refreshing}>
              <Icon name="refresh" className="icon icon-sm" style={{
                transition:'transform 0.6s', transform: refreshing ? 'rotate(360deg)' : 'none'
              }}/>새로고침
            </button>
            <button className="btn primary" onClick={onNewCrawler}>
              <Icon name="plus" className="icon icon-sm"/>새 크롤러
            </button>
          </div>
        }
      >
        API로 얻을 수 없는 데이터를, 사이트 구조가 바뀌어도 끊기지 않게 <strong style={{color:'var(--text)'}}>분 단위</strong>로. <span className="kbd">⌘K</span> 로 빠르게 찾기.
      </SectionTitle>

      {/* Top stats */}
      <div className="grid" style={{gridTemplateColumns:'repeat(4, 1fr)', marginBottom:18}}>
        <Stat icon="crawler"  label="ACTIVE FEEDS"
          value={String(activeFeeds)}
          sub={<><span className="mono">{crawlers.length}</span>개 중 활성</>}
        />
        <Stat icon="activity" label="7D 수집 성공률"
          value={noData ? '—' : successRate}
          sub={noData ? '아직 실행 기록 없음' : <>SLA 임계값 <span className="mono">95.00%</span> 기준</>}
          accent={noData ? undefined : rateColor}
        />
        <Stat icon="bolt" label="누적 자가치유"
          value={String(totalHealed)}
          sub={approvalCount > 0
            ? <><span style={{color:'var(--warn)'}}>승인 대기 {approvalCount}건</span></>
            : '모두 자동 복구됨'}
        />
        <Stat icon="inbox" label="평균 응답시간"
          value={noData ? '—' : avgDur}
          sub={noData ? '아직 실행 기록 없음' : `P95 ${p95Dur}`}
        />
      </div>

      {/* Banner: pending approvals — 0건이면 숨김 */}
      {approvalCount > 0 && (
        <div className="card" style={{
          padding:'14px 18px', display:'flex', alignItems:'center', gap:14,
          marginBottom:20, background:'linear-gradient(180deg, rgba(245,192,99,0.08), rgba(245,192,99,0.02))',
          borderColor:'var(--warn-line)'
        }}>
          <div style={{
            width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center',
            background:'var(--warn-soft)', color:'var(--warn)'
          }}>
            <Icon name="bell" className="icon"/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600}}>{approvalCount}건의 자가치유 결과가 승인을 기다리고 있습니다</div>
            <div className="muted" style={{fontSize:12, marginTop:2}}>
              AI 확신도가 임계값 미달 — 대시보드에서 확인 후 승인해 주세요.
            </div>
          </div>
          <button className="btn" onClick={onGoApprovals}>승인 큐로 이동<Icon name="arrow_r" className="icon icon-sm"/></button>
        </div>
      )}

      {/* Filter bar */}
      <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:12}}>
        <div style={{display:'flex', gap:4, padding:3, background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10}}>
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setFilter(t.id)}
              className="btn ghost sm"
              style={{
                background: filter===t.id ? 'var(--bg-3)' : 'transparent',
                color: filter===t.id ? 'var(--text)' : 'var(--text-mute)',
                borderColor:'transparent', borderRadius:7, padding:'5px 11px',
                fontWeight: filter===t.id ? 600 : 500,
              }}>
              {t.label}
              <span className="num" style={{
                marginLeft:6, color: filter===t.id ? 'var(--text-mute)' : 'var(--text-dim)',
                fontSize:10.5
              }}>{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{
          display:'flex', alignItems:'center', gap:8, padding:'5px 12px',
          background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10,
          minWidth:280, flex:1, maxWidth:380
        }}>
          <Icon name="search" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
          <input
            value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="이름, URL, 태그로 검색…"
            style={{flex:1, background:'transparent', border:0, color:'var(--text)', fontSize:13, fontFamily:'var(--sans)'}}
          />
          <span className="kbd" style={{fontSize:10}}>⌘K</span>
        </div>
        <div style={{flex:1}}/>
        <button className="btn ghost"><Icon name="filter" className="icon icon-sm"/>필터</button>
        <button className="btn ghost"><Icon name="download" className="icon icon-sm"/>내보내기</button>
      </div>

      {/* Crawler table */}
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{
          display:'grid',
          gridTemplateColumns:'minmax(280px, 1.6fr) 110px 1.2fr 110px 100px 120px 40px',
          padding:'10px 18px',
          fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase',
          fontFamily:'var(--mono)',
          borderBottom:'1px solid var(--border)'
        }}>
          <div>크롤러</div>
          <div>상태</div>
          <div>최근 값</div>
          <div style={{textAlign:'right'}}>Score</div>
          <div style={{textAlign:'right'}}>7d 추이</div>
          <div>스케줄</div>
          <div/>
        </div>
        {rows.map((c,i) => (
          <div key={c.id} className="row-hover"
            onClick={()=>onOpenCrawler(c)}
            style={{
              display:'grid',
              gridTemplateColumns:'minmax(280px, 1.6fr) 110px 1.2fr 110px 100px 120px 40px',
              padding:'14px 18px', alignItems:'center',
              borderBottom: i === rows.length-1 ? 'none' : '1px solid var(--border)',
              cursor:'default'
            }}>
            <div style={{display:'flex', alignItems:'center', gap:12, minWidth:0}}>
              <div style={{
                width:30, height:30, borderRadius:8, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center',
                background:'var(--bg-3)', color:'var(--text-mute)',
                border:'1px solid var(--border-mid)'
              }}>
                <Icon name={
                  c.type==='commerce'   ? 'cube' :
                  c.type==='labor'      ? 'user' :
                  c.type==='realestate' ? 'layers' :
                  c.type==='regulatory' ? 'sigma' :
                  c.type==='media'      ? 'activity' :
                  c.type==='finance'    ? 'sigma' :
                  'target'
                } className="icon icon-sm"/>
              </div>
              <div style={{minWidth:0, flex:1}}>
                <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', minWidth:0}}>
                  <div style={{fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flexShrink:1, minWidth:0}}>
                    {c.name}
                  </div>
                  {c.altCategory && (
                    <span className="chip" style={{fontSize:10, padding:'1px 6px', flexShrink:0}}>{c.altCategory}</span>
                  )}
                </div>
                <div className="mono dim" style={{fontSize:11, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {c.url}
                </div>
              </div>
            </div>
            <div><StatusChip status={c.status}/></div>
            <div>
              <div className="mono" style={{fontSize:13}}>{c.lastValue}</div>
              <div className="dim" style={{fontSize:11, marginTop:1}}>{c.lastRun}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div className="mono" style={{
                fontSize:14, fontWeight:600,
                color: c.score>=c.threshold ? 'var(--ok)' :
                       c.score>=60 ? 'var(--warn)' :
                       c.score===0 ? 'var(--text-dim)' : 'var(--danger)'
              }}>
                {c.score>0 ? c.score.toFixed(1) : '—'}
              </div>
              <div className="dim mono" style={{fontSize:10.5, marginTop:1}}>≥ {c.threshold}</div>
            </div>
            <div style={{display:'flex', justifyContent:'flex-end'}}>
              {c.spark.length ? (
                <Spark data={c.spark} w={90} h={28}
                  color={c.score>=c.threshold ? 'var(--ok)' : c.score>=60 ? 'var(--warn)' : 'var(--danger)'}/>
              ) : <span className="dim">—</span>}
            </div>
            <div>
              <div className="muted" style={{fontSize:12}}>{c.schedule}</div>
              <div className="dim mono" style={{fontSize:10.5, marginTop:1}}>
                {nextRunLabel(c.scheduleKey || c.schedule)}
              </div>
            </div>
            <button
              className="btn ghost sm"
              style={{padding:4}}
              onClick={e => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ id: c.id, name: c.name, x: r.right, y: r.bottom + 4 });
              }}
            >
              <Icon name="more" className="icon icon-sm"/>
            </button>
          </div>
        ))}
      </div>

      {/* 플로팅 컨텍스트 메뉴 */}
      {menu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position:'fixed', top: menu.y, right: window.innerWidth - menu.x,
            zIndex:200, background:'var(--bg-2)', border:'1px solid var(--border)',
            borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.14)', padding:4, minWidth:140,
          }}
        >
          <button
            className="btn ghost sm"
            style={{width:'100%', justifyContent:'flex-start', color:'var(--danger)', padding:'7px 10px', gap:8}}
            onClick={() => {
              if (onDeleteCrawler && window.confirm(`"${menu.name}" 크롤러를 삭제하시겠습니까?\n\n실행 이력과 자가치유 기록도 함께 삭제됩니다.`)) {
                onDeleteCrawler(menu.id);
              }
              setMenu(null);
            }}
          >
            <Icon name="x" className="icon icon-sm"/>삭제
          </button>
        </div>
      )}

      <div style={{marginTop:12, fontSize:12, color:'var(--text-dim)', display:'flex', justifyContent:'space-between'}}>
        <span>{rows.length}개 · 행을 클릭해 상세를 보세요</span>
        <span className="mono">v1.0.0-beta · region: ap-northeast-2</span>
      </div>
    </div>
  );
}

// ─── Approvals (Self-healing Human-in-the-Loop) ────────────────────────────
function ApprovalsScreen({ onBack, onAction }) {
  const [list, setList]       = React.useState(null); // null = loading
  const [selected, setSelected] = React.useState(null);
  const [acting, setActing]   = React.useState(false);

  const load = () => {
    fetch('/api/approvals')
      .then(r => r.json())
      .then(data => { setList(Array.isArray(data) ? data : []); })
      .catch(() => setList([]));
  };

  React.useEffect(() => { load(); }, []);

  const handleApprove = async (proposal) => {
    setActing(true);
    await fetch(`/api/approvals/${proposal.id}/approve`, { method: 'POST' }).catch(() => {});
    setActing(false);
    setSelected(null);
    load();
    if (onAction) onAction();
  };

  const handleReject = async (proposal) => {
    setActing(true);
    await fetch(`/api/approvals/${proposal.id}/reject`, { method: 'POST' }).catch(() => {});
    setActing(false);
    setSelected(null);
    load();
    if (onAction) onAction();
  };

  // ── 상세 뷰 ─────────────────────────────────────────────────────────────────
  if (selected) {
    const p = selected;
    const scoreVal = Math.round(p.confidence * 1000) / 10;
    return (
      <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:18, fontSize:12, color:'var(--text-mute)'}}>
          <a onClick={onBack} style={{cursor:'default'}} className="muted">Approvals</a>
          <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
          <a onClick={()=>setSelected(null)} style={{cursor:'default'}} className="muted">목록</a>
          <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
          <span>{p.crawler_id} — {p.crawler_name}</span>
          <span className="chip warn" style={{marginLeft:8}}><span className="dot"/>수동 승인 대기</span>
        </div>

        <SectionTitle
          eyebrow="HUMAN-IN-THE-LOOP"
          title="자가치유 결과 검토"
          action={
            <div style={{display:'flex', gap:8}}>
              <button className="btn" onClick={()=>handleReject(p)} disabled={acting}>
                <Icon name="x" className="icon icon-sm"/>거부 · 다시 시도
              </button>
              <button className="btn primary" onClick={()=>handleApprove(p)} disabled={acting}>
                <Icon name="check" className="icon icon-sm"/>승인 후 자동 복구
              </button>
            </div>
          }
        >
          AI가 찾은 후보의 확신도가 임계값에 미달했습니다. <strong style={{color:'var(--text)'}}>{p.crawler_name}</strong> 크롤러를 검토해 주세요.
        </SectionTitle>

        <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16, marginBottom:16}}>
          {/* Selector diff */}
          <div className="card" style={{padding:0, overflow:'hidden'}}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10}}>
              <Icon name="code" className="icon"/>
              <div style={{fontWeight:600}}>Selector 변경</div>
              <span className="dim mono" style={{fontSize:11, marginLeft:'auto'}}>{p.created_at}</span>
            </div>

            <div style={{padding:18, display:'flex', flexDirection:'column', gap:14}}>
              <div>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                  <span className="chip danger"><span className="dot"/>이전 (장애 발생)</span>
                </div>
                <pre className="code" style={{margin:0, wordBreak:'break-all', whiteSpace:'pre-wrap'}}>
                  {p.old_selector}
                </pre>
              </div>

              <div style={{display:'flex', alignItems:'center', gap:8, color:'var(--text-dim)'}}>
                <Icon name="chevron_d" className="icon icon-sm"/>
                <span className="dim mono" style={{fontSize:11}}>AI 제안 셀렉터</span>
                <div style={{flex:1, height:1, background:'var(--border)'}}/>
              </div>

              <div>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                  <span className="chip ok"><span className="dot"/>새 후보</span>
                </div>
                <pre className="code" style={{margin:0, wordBreak:'break-all', whiteSpace:'pre-wrap'}}>
                  {p.proposed_selector || '(제안 없음)'}
                </pre>
              </div>

              {p.extracted_text && (
                <div style={{padding:'10px 14px', background:'var(--bg-2)', borderRadius:8, border:'1px solid var(--border)'}}>
                  <div className="dim mono" style={{fontSize:10.5, marginBottom:4}}>추출된 텍스트</div>
                  <div style={{fontSize:13}}>{p.extracted_text}</div>
                </div>
              )}

              {p.reasoning && (
                <div style={{padding:'10px 14px', background:'var(--bg-2)', borderRadius:8, border:'1px solid var(--border)'}}>
                  <div className="dim mono" style={{fontSize:10.5, marginBottom:4}}>AI 추론 근거</div>
                  <div style={{fontSize:12.5, lineHeight:1.6, color:'var(--text-mute)'}}>{p.reasoning}</div>
                </div>
              )}
            </div>
          </div>

          {/* Score panel */}
          <div className="card" style={{padding:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10}}>
              <Icon name="target" className="icon"/>
              <div style={{fontWeight:600}}>확신도 (Confidence)</div>
            </div>

            <div style={{padding:'32px 18px', display:'flex', alignItems:'center', gap:18, justifyContent:'center', flex:1}}>
              <ScoreRing value={scoreVal} threshold={70} size={120} stroke={10}/>
              <div style={{display:'flex', flexDirection:'column', gap:8, minWidth:160}}>
                <div>
                  <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase'}}>Confidence</div>
                  <div className="mono" style={{fontSize:22, fontWeight:600, color:'var(--warn)'}}>
                    {scoreVal.toFixed(1)} <span className="dim" style={{fontSize:13, fontWeight:400}}>/ 100</span>
                  </div>
                </div>
                <div>
                  <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase'}}>Raw</div>
                  <div className="mono" style={{fontSize:15, color:'var(--text-mute)'}}>
                    {p.confidence.toFixed(4)}
                  </div>
                </div>
                <div className="chip warn" style={{alignSelf:'flex-start', marginTop:4}}>
                  <Icon name="triangle_dn" className="icon icon-sm"/>
                  수동 검토 필요
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 뷰 ──────────────────────────────────────────────────────────────────
  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle
        eyebrow="HUMAN-IN-THE-LOOP"
        title="승인 큐"
      >
        자가치유 신뢰도가 임계값에 미달한 제안을 검토하고 승인하세요.
      </SectionTitle>

      {list === null && (
        <div className="card" style={{padding:'var(--s-11)', textAlign:'center'}}>
          <div className="muted">로딩 중…</div>
        </div>
      )}

      {list !== null && list.length === 0 && (
        <div className="card" style={{padding:'var(--s-11)', textAlign:'center'}}>
          <Icon name="check" className="icon icon-lg" style={{margin:'0 auto var(--s-3)', display:'block', color:'var(--ok)'}}/>
          <div style={{fontWeight:600, marginBottom:6}}>검토 대기 중인 항목이 없습니다</div>
          <div className="muted" style={{fontSize:13}}>자가치유 신뢰도가 임계값을 충족하면 자동으로 복구됩니다.</div>
        </div>
      )}

      {list !== null && list.length > 0 && (
        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <div style={{
            display:'grid', gridTemplateColumns:'1fr 1.2fr 1.2fr 90px 120px 130px',
            padding:'10px 18px', borderBottom:'1px solid var(--border)',
            fontSize:11, fontWeight:600, color:'var(--text-dim)', letterSpacing:'0.04em', textTransform:'uppercase'
          }}>
            <div>크롤러</div><div>이전 셀렉터</div><div>제안 셀렉터</div>
            <div>확신도</div><div>요청 시각</div><div/>
          </div>
          {list.map((p, i) => (
            <div key={p.id} style={{
              display:'grid', gridTemplateColumns:'1fr 1.2fr 1.2fr 90px 120px 130px',
              padding:'14px 18px', alignItems:'center', gap:4,
              borderBottom: i===list.length-1?'none':'1px solid var(--border)',
            }}>
              <div>
                <div style={{fontWeight:600, fontSize:13}}>{p.crawler_name}</div>
                <div className="dim mono" style={{fontSize:11}}>{p.crawler_id}</div>
              </div>
              <div className="mono muted" style={{fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={p.old_selector}>
                {p.old_selector}
              </div>
              <div className="mono" style={{fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--ok)'}} title={p.proposed_selector}>
                {p.proposed_selector || '—'}
              </div>
              <div className="mono" style={{
                fontSize:13, fontWeight:600,
                color: p.confidence>=0.9?'var(--ok)':p.confidence>=0.6?'var(--warn)':'var(--danger)'
              }}>
                {(p.confidence*100).toFixed(1)}%
              </div>
              <div className="dim mono" style={{fontSize:11}}>{p.created_at}</div>
              <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                <button className="btn ghost sm" onClick={()=>setSelected(p)}>검토</button>
                <button className="btn primary sm" onClick={()=>handleApprove(p)} disabled={acting}>승인</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Crawler Detail ────────────────────────────────────────────────────────
function DetailScreen({ crawler, onBack, onCrawlerUpdate, onDelete }) {
  const [c, setC] = React.useState(crawler);
  const tabs = ['Overview', 'Runs', 'Healing log', 'Schema', 'Settings'];
  const [tab, setTab] = React.useState('Overview');
  const [healOpen, setHealOpen] = React.useState(false);
  const [repickOpen, setRepickOpen] = React.useState(false);
  const [runState, setRunState] = React.useState('idle'); // idle | running | done | error
  const [runMsg, setRunMsg]   = React.useState('');
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);

  const scores = c.spark || [];

  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, fontSize:12, color:'var(--text-mute)'}}>
        <a onClick={onBack} className="muted" style={{cursor:'default'}}>Crawlers</a>
        <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
        <span>{c.id}</span>
      </div>

      {/* 헤더: 좌(이름/메타) + 우(버튼) */}
      <div style={{display:'flex', alignItems:'flex-start', gap:16, marginBottom:24}}>
        {/* 좌 */}
        <div style={{display:'flex', alignItems:'center', gap:18, minWidth:0, flex:1}}>
          <ScoreRing value={c.score} threshold={c.threshold} size={72} stroke={7}/>
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:24, fontWeight:600, marginBottom:6}}>{c.name}</h2>
            <div style={{display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-mute)', flexWrap:'wrap'}}>
              <StatusChip status={c.status}/>
              <span className="mono" style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280}}>{c.url}</span>
              <span className="dim">·</span>
              <span>{c.schedule}</span>
              <span className="chip" style={{fontSize:10, padding:'1px 7px'}}>
                <Icon name="history" className="icon icon-sm"/>
                {nextRunLabel(c.scheduleKey || c.schedule)}
              </span>
            </div>
          </div>
        </div>

        {/* 우: 버튼 묶음 */}
        <div style={{display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'flex-end'}}>
          <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end'}}>
            <button className="btn ghost sm"><Icon name="pause" className="icon icon-sm"/>일시중지</button>
            <button
              className="btn ghost sm"
              disabled={runState === 'running'}
              onClick={async () => {
                setRunState('running'); setRunMsg('');
                try {
                  const resp = await fetch(`/api/crawlers/${c.id}/run`, { method: 'POST' });
                  const data = await resp.json();
                  if (!resp.ok) throw new Error(data.error || '실행 실패');
                  setC(data.crawler);
                  if (onCrawlerUpdate) onCrawlerUpdate(data.crawler);
                  const r = data.result;
                  setRunMsg(
                    r.status === 'healthy'           ? `✓ 수집 완료 — "${r.value}"` :
                    r.heal?.status === 'healed'      ? `⚡ 자가치유 성공` :
                    r.heal?.status === 'pending'     ? `⏳ 신뢰도 미달 — 승인 대기` :
                    r.heal?.status === 'skipped'     ? `✗ 셀렉터 불일치 — '셀렉터 재선택'을 사용하세요` :
                    `✗ 셀렉터 불일치 — ${r.heal?.reason || '요소를 찾지 못했습니다'}`
                  );
                  setRunState('done');
                } catch (e) {
                  setRunMsg(`오류: ${e.message}`); setRunState('error');
                }
              }}>
              {runState === 'running'
                ? <><div className="spin" style={{width:11,height:11,borderRadius:999,border:'2px solid var(--border-strong)',borderTopColor:'var(--accent)'}}/> 실행 중…</>
                : <><Icon name="play" className="icon icon-sm"/>지금 실행</>
              }
            </button>
            <button className="btn sm" onClick={() => setRepickOpen(true)}>
              <Icon name="target" className="icon icon-sm"/>셀렉터 재선택
            </button>
            {(c.status === 'failed' || c.status === 'pending') && (
              <button className="btn sm" style={{
                borderColor:'var(--healing-line)', background:'var(--healing-soft)', color:'var(--healing)'
              }} onClick={() => setHealOpen(true)}>
                <Icon name="bolt" className="icon icon-sm"/>자가치유
              </button>
            )}
            <div style={{width:1, height:16, background:'var(--border)'}}/>
            {deleteConfirm ? (
              <>
                <button className="btn sm"
                  style={{borderColor:'var(--danger)', color:'var(--danger)', background:'var(--danger-soft)'}}
                  onClick={() => onDelete && onDelete(c.id)}>확인</button>
                <button className="btn ghost sm" onClick={() => setDeleteConfirm(false)}>취소</button>
              </>
            ) : (
              <button className="btn ghost sm" onClick={() => setDeleteConfirm(true)}>
                <Icon name="x" className="icon icon-sm"/>삭제
              </button>
            )}
          </div>
          {/* 실행 결과 메시지 — 버튼 아래 별도 줄 */}
          {runMsg && (
            <div style={{fontSize:12, color: runState==='done' ? 'var(--ok)' : 'var(--danger)'}}>
              {runMsg}
            </div>
          )}
        </div>
      </div>
      {healOpen && <HealPanel crawler={c} onClose={() => setHealOpen(false)}/>}
      {repickOpen && (
        <SelectorRepickPanel
          crawler={c}
          onClose={() => setRepickOpen(false)}
          onSaved={(updated) => {
            setC(updated);
            if (onCrawlerUpdate) onCrawlerUpdate(updated);
            setRepickOpen(false);
          }}
        />
      )}

      {/* tabs */}
      <div style={{display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:20}}>
        {tabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} className="btn ghost"
            style={{
              borderRadius:0, padding:'9px 14px', fontSize:13,
              color: tab===t ? 'var(--text)' : 'var(--text-mute)',
              borderBottom: tab===t ? '1.5px solid var(--text)' : '1.5px solid transparent',
              marginBottom:-1
            }}>{t}</button>
        ))}
      </div>

      {tab==='Overview' && <DetailOverview crawler={c} scores={scores}/>}
      {tab==='Runs' && <DetailRuns crawlerId={c.id}/>}
      {tab!=='Overview' && tab!=='Runs' && (
        <div className="card" style={{padding:'60px', textAlign:'center', color:'var(--text-mute)'}}>
          <Icon name="cube" className="icon icon-lg" style={{margin:'0 auto 12px', display:'block', color:'var(--text-dim)'}}/>
          <div style={{marginBottom:6, color:'var(--text)'}}>{tab}</div>
          <div className="dim" style={{fontSize:12}}>이 탭은 데모에서 생략되었습니다.</div>
        </div>
      )}
    </div>
  );
}

function DetailOverview({ crawler, scores }) {
  const [results, setResults] = React.useState(null); // null = 로딩 중

  React.useEffect(() => {
    fetch(`/api/crawlers/${crawler.id}/results`)
      .then(r => r.json())
      .then(data => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]));
  }, [crawler.id]);

  // ── 실행 이력 기반 통계 계산 ──────────────────────────────────────────────
  const hasResults = results && results.length > 0;
  const latest     = hasResults ? results[0] : null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs7d = hasResults
    ? results.filter(r => new Date(r.run_at) >= sevenDaysAgo).length
    : null;
  const avgConfidence = hasResults
    ? results[0].score.toFixed(1) + '%'
    : null;
  const avgMs = hasResults
    ? results.reduce((s, r) => s + (r.duration_ms || 0), 0) / results.length
    : null;
  const avgDur = avgMs != null
    ? (avgMs >= 1000 ? (avgMs / 1000).toFixed(2) + 's' : Math.round(avgMs) + 'ms')
    : null;

  // ── Score 차트 ───────────────────────────────────────────────────────────
  const isRealSpark = scores.length > 0;
  const safeScores  = scores.length >= 2 ? scores : [0, 0];
  const w = 760, h = 180, max = 100, min = 0;
  const step       = w / (safeScores.length - 1);
  const pts        = safeScores.map((v, i) => [i * step, h - ((v - min) / (max - min)) * (h - 20) - 10]);
  const line       = pts.map(p => `${p[0]},${p[1]}`).join(' ');
  const area       = `0,${h} ${line} ${w},${h}`;
  const thresholdY = h - ((crawler.threshold - min) / (max - min)) * (h - 20) - 10;
  const lineColor  = crawler.score >= crawler.threshold ? 'var(--ok)' : crawler.score >= 60 ? 'var(--warn)' : 'var(--danger)';

  // ── 최근 수집 결과 JSON ───────────────────────────────────────────────────
  const jsonPayload = latest
    ? JSON.stringify({
        crawler_id:  crawler.id,
        target:      crawler.url,
        collected_at: latest.run_at,
        value:       latest.value || null,
        status:      latest.status,
        score:       latest.score,
        duration_ms: latest.duration_ms,
        self_healing: {
          applied:   latest.note ? latest.note.includes('자가치유') || latest.note.includes('healed') : false,
          score:     latest.score,
          threshold: crawler.threshold,
        },
        note: latest.note,
      }, null, 2)
    : JSON.stringify({
        crawler_id:  crawler.id,
        target:      crawler.url,
        collected_at: null,
        value:       null,
        status:      'no_data',
        note:        '아직 실행 기록이 없습니다. "지금 실행"을 눌러 첫 수집을 시작하세요.',
      }, null, 2);

  return (
    <div style={{display:'grid', gridTemplateColumns:'1.7fr 1fr', gap:16}}>
      <div style={{display:'flex', flexDirection:'column', gap:16, minWidth:0}}>
        {/* score chart */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
            <div>
              <div style={{fontWeight:600, marginBottom:2}}>Score 추이</div>
              <div className="dim" style={{fontSize:11.5}}>
                {isRealSpark
                  ? `최근 ${scores.length}회 실행 기록`
                  : hasResults === null ? '로딩 중…' : '실행 기록 없음'}
              </div>
            </div>
          </div>
          {safeScores[0] === 0 && safeScores[1] === 0 ? (
            <div style={{height:h, display:'flex', alignItems:'center', justifyContent:'center'}}>
              <div className="muted" style={{fontSize:13}}>첫 실행 후 차트가 표시됩니다.</div>
            </div>
          ) : (
            <div style={{position:'relative'}}>
              <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
                {[0,25,50,75,100].map(g => {
                  const y = h - ((g - min) / (max - min)) * (h - 20) - 10;
                  return <line key={g} x1="0" x2={w} y1={y} y2={y} stroke="rgba(255,255,255,0.04)"/>;
                })}
                <line x1="0" x2={w} y1={thresholdY} y2={thresholdY} stroke="var(--warn)" strokeWidth="1" strokeDasharray="4 4" opacity="0.65"/>
                <polygon points={area} fill={lineColor} opacity="0.10"/>
                <polyline points={line} fill="none" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                {pts.map((p, i) => i % 4 === 0 &&
                  <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--bg-1)" stroke={lineColor} strokeWidth="1.2"/>
                )}
              </svg>
              <div className="mono" style={{
                position:'absolute', right:8, top: Math.max(4, thresholdY - 9), fontSize:10,
                color:'var(--warn)', background:'var(--bg-2)', padding:'1px 6px', borderRadius:4, border:'1px solid var(--warn-line)'
              }}>임계값 {crawler.threshold}</div>
            </div>
          )}
          <div className="ticks" style={{marginTop:6}}>
            <span>이전</span><span/><span/><span/><span>최신</span>
          </div>
        </div>

        {hasResults && <ValueTrendCard results={results} crawlerId={crawler.id}/>}

        {/* 최근 수집 결과 JSON */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
            <div style={{fontWeight:600}}>최근 수집 결과 (JSON)</div>
            {latest && (
              <span className="dim mono" style={{fontSize:11}}>{latest.run_at}</span>
            )}
          </div>
          {results === null ? (
            <div className="muted" style={{fontSize:12, padding:'16px 0'}}>로딩 중…</div>
          ) : (
            <pre className="code" style={{margin:0, fontSize:12}}>{jsonPayload}</pre>
          )}
        </div>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:16, minWidth:0}}>
        {/* 현재 셀렉터 */}
        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>현재 셀렉터</div>
          <pre className="code" style={{margin:0, fontSize:11, wordBreak:'break-all', whiteSpace:'pre-wrap'}}>
            {crawler.css_selector || '셀렉터가 등록되지 않았습니다.'}
          </pre>
          <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:14, fontSize:12}}>
            {crawler.user_intent && (
              <div>
                <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)', marginBottom:3}}>수집 의도</div>
                <div style={{color:'var(--text-mute)', lineHeight:1.5}}>{crawler.user_intent}</div>
              </div>
            )}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <div>
                <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>임계값</div>
                <div className="mono" style={{marginTop:3}}>{crawler.threshold} / 100</div>
              </div>
              <div>
                <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>도메인</div>
                <div style={{marginTop:3}}>{crawler.altCategory || crawler.type || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 운영 통계 */}
        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>운영 통계</div>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {[
              ['최근 7일 실행', runs7d != null ? runs7d + '회' : '—', 'spark'],
              ['최근 신뢰도', avgConfidence || '—', 'check'],
              ['자가치유 발동', (crawler.healed || 0) + '회', 'bolt'],
              ['평균 응답', avgDur || '—', 'activity'],
            ].map(([k, v, ic]) => (
              <div key={k} style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, color:'var(--text-mute)', fontSize:12.5}}>
                  <Icon name={ic} className="icon icon-sm" style={{color:'var(--text-dim)'}}/>{k}
                </div>
                <div className="mono" style={{fontSize:13, fontWeight:500}}>{v}</div>
              </div>
            ))}
            {!hasResults && results !== null && (
              <div className="dim" style={{fontSize:11, marginTop:4}}>
                "지금 실행"을 눌러 첫 수집을 시작하면 통계가 집계됩니다.
              </div>
            )}
          </div>
        </div>

        {/* 전송 채널 */}
        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>전송 채널</div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {(crawler.delivery || []).map(d => (
              <div key={d} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px',
                background:'var(--bg-3)', borderRadius:8, border:'1px solid var(--border)'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <Icon name={d==='REST API'?'link': d==='Webhook'?'rocket': d==='Slack'?'slack':'csv'} className="icon"/>
                  <div>
                    <div style={{fontSize:13, fontWeight:500}}>{d}</div>
                    <div className="dim mono" style={{fontSize:11}}>
                      {d==='REST API' ? `GET /api/v1/data/${crawler.id}` :
                       d==='Webhook'  ? `POST https://hooks.mender.io/${crawler.id}` :
                       d==='Slack'    ? '#crawler-alerts' :
                       `${crawler.id}_export.csv`}
                    </div>
                  </div>
                </div>
                <span className="chip ok"><span className="dot"/>활성</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRuns({ crawlerId }) {
  const [runs, setRuns] = React.useState(null);

  React.useEffect(() => {
    if (!crawlerId) { setRuns([]); return; }
    fetch(`/api/crawlers/${crawlerId}/results`)
      .then(r => r.json())
      .then(data => setRuns(Array.isArray(data) ? data : []))
      .catch(() => setRuns(null));
  }, [crawlerId]);

  if (runs === null) {
    return (
      <div className="card" style={{padding:'40px', textAlign:'center', color:'var(--text-dim)'}}>
        <div className="spin" style={{width:18,height:18,borderRadius:999,border:'2px solid var(--border-strong)',borderTopColor:'var(--accent)',margin:'0 auto 10px'}}/>
        <div style={{fontSize:12}}>실행 이력 로드 중…</div>
      </div>
    );
  }

  // runs are DESC (newest first); index i+1 is the chronologically previous run
  const rows = runs.map((r, i) => ({
    ts:           r.run_at || '—',
    status:       r.status,
    value:        r.value || '—',
    valueChanged: i < runs.length - 1 && !!r.value && r.value !== runs[i + 1].value,
    score:        r.score,
    dur:          r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—',
    note:         r.note,
  }));

  return (
    <div style={{display:'flex', flexDirection:'column', gap:10}}>
      <div style={{display:'flex', justifyContent:'flex-end'}}>
        <a
          href={`/api/crawlers/${crawlerId}/results/csv`}
          download
          className="btn ghost sm"
          style={{textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6}}
        >
          <Icon name="download" className="icon icon-sm"/>CSV 내보내기
        </a>
      </div>
      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div style={{
          display:'grid', gridTemplateColumns:'160px 120px minmax(100px,1.4fr) 80px 100px 1fr',
          padding:'10px 18px', borderBottom:'1px solid var(--border)',
          fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'
        }}>
          <div>수집 시각</div><div>상태</div><div>추출값</div><div>신뢰도</div><div>응답시간</div><div>로그</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'160px 120px minmax(100px,1.4fr) 80px 100px 1fr',
            padding:'12px 18px', alignItems:'center',
            borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
          }}>
            <div className="mono" style={{fontSize:11.5}}>{r.ts}</div>
            <div><StatusChip status={r.status === 'healed' ? 'healing' : r.status}/></div>
            <div style={{display:'flex', alignItems:'center', gap:6, minWidth:0}}>
              <div className="mono" style={{fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.value}</div>
              {r.valueChanged && (
                <span style={{
                  flexShrink:0, fontSize:9.5, padding:'1px 6px', borderRadius:4,
                  background:'var(--warn-soft)', color:'var(--warn)',
                  border:'1px solid var(--warn-line)', fontFamily:'var(--mono)', fontWeight:600,
                }}>변경</span>
              )}
            </div>
            <div className="mono" style={{fontSize:12.5}}>{r.score == null ? '—' : Number(r.score).toFixed(1)}</div>
            <div className="mono dim" style={{fontSize:12}}>{r.dur}</div>
            <div className="muted" style={{fontSize:12.5}}>{r.note}</div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{padding:'40px', textAlign:'center', color:'var(--text-dim)', fontSize:12}}>
            아직 실행 이력이 없습니다. "지금 실행"을 눌러 첫 수집을 시작하세요.
          </div>
        )}
      </div>
    </div>
  );
}

function StockChart({ runs, parseNum, chartId }) {
  const [hoverIdx, setHoverIdx] = React.useState(null);
  const svgRef = React.useRef(null);

  const vals  = runs.map(r => parseNum(r.value));
  const times = runs.map(r => r.run_at || '');
  const n = vals.length;
  if (n < 2) return null;

  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const vPad  = (rawMax - rawMin) * 0.14 || rawMax * 0.05 || 1;
  const lo = rawMin - vPad, hi = rawMax + vPad;
  const vRange = hi - lo;

  const W = 700, H = 160, PT = 10;
  const chartH = H - PT;

  const toX = i => (i / (n - 1)) * W;
  const toY = v => PT + chartH - ((v - lo) / vRange) * chartH;

  const pts     = vals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const linePts = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPts = `0,${H} ${linePts} ${W},${H}`;

  const isUp  = vals[n - 1] >= vals[0];
  const color = isUp ? '#00BD83' : '#E04A4A';
  const gradId = `sg_${chartId}`;

  // 4 horizontal grid lines
  const yTicks = [0, 1/3, 2/3, 1].map(t => ({
    val: lo + t * vRange,
    y:   PT + chartH * (1 - t),
  }));

  // X-axis: first · mid · last
  const xIdxs = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  const fmtVal = v => {
    if (Math.abs(v) >= 10000) return Math.round(v).toLocaleString('ko-KR');
    if (Math.abs(v) >= 100)   return v.toFixed(0);
    return v.toFixed(2);
  };

  const handleMouseMove = e => {
    if (!svgRef.current) return;
    const rect  = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  };

  const hov = hoverIdx !== null
    ? { x: pts[hoverIdx].x, y: pts[hoverIdx].y, val: vals[hoverIdx], time: times[hoverIdx] }
    : null;

  return (
    <div style={{ position: 'relative', marginBottom: 8, overflow: 'hidden' }}>
      {/* Y-axis labels (HTML, avoids SVG text distortion) */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 20, width: 56,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        paddingTop: PT, pointerEvents: 'none',
      }}>
        {[...yTicks].reverse().map((t, i) => (
          <div key={i} style={{
            fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--text-dim)',
            textAlign: 'right', paddingRight: 8, transform: 'translateY(50%)',
          }}>
            {fmtVal(t.val)}
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ marginLeft: 56, position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%" height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity="0.28"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {yTicks.map((t, i) => (
            <line key={i} x1={0} x2={W} y1={t.y} y2={t.y}
              stroke="rgba(128,128,128,0.09)" strokeWidth="1"/>
          ))}

          {/* Baseline */}
          <line x1={0} x2={W} y1={H} y2={H} stroke="rgba(128,128,128,0.18)" strokeWidth="1"/>

          {/* Area fill */}
          <polygon points={areaPts} fill={`url(#${gradId})`}/>

          {/* Price line */}
          <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"/>

          {/* Latest-value dot */}
          <circle cx={pts[n-1].x} cy={pts[n-1].y} r="3.5"
            fill="var(--bg-1)" stroke={color} strokeWidth="2"/>

          {/* Hover crosshair */}
          {hov && <>
            <line x1={hov.x} x2={hov.x} y1={PT} y2={H}
              stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.6"/>
            <line x1={0} x2={W} y1={hov.y} y2={hov.y}
              stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.35"/>
            <circle cx={hov.x} cy={hov.y} r="4.5"
              fill="var(--bg-1)" stroke={color} strokeWidth="2"/>
          </>}
        </svg>

        {/* Tooltip — HTML div to avoid SVG text distortion */}
        {hov && (
          <div style={{
            position: 'absolute',
            top: `${(hov.y / H) * 100}%`,
            transform: 'translateY(-50%)',
            ...(hov.x / W > 0.62
              ? { right: `${((W - hov.x) / W) * 100 + 1.2}%` }
              : { left:  `${(hov.x / W) * 100 + 1.2}%` }),
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 11px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5, color,
            }}>
              {fmtVal(hov.val)}
            </div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 2,
            }}>
              {hov.time?.slice(5, 16) || ''}
            </div>
          </div>
        )}

        {/* X-axis time labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
          {xIdxs.map((i, j) => (
            <div key={i} style={{
              fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--text-dim)',
              textAlign: j === 0 ? 'left' : j === xIdxs.length - 1 ? 'right' : 'center',
            }}>
              {times[i]?.slice(5, 16) || ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValueTrendCard({ results, crawlerId }) {
  if (!results || results.length === 0) return null;

  const annotated = results.map((r, i) => ({
    ...r,
    changed: i < results.length - 1 && !!r.value && r.value !== results[i + 1].value,
  }));
  const changeCount = annotated.filter(r => r.changed).length;

  const parseNum = v => parseFloat(String(v || '').replace(/[^0-9.-]/g, ''));
  const numericRuns = [...results].reverse()
    .filter(r => r.value && r.status !== 'failed' && !isNaN(parseNum(r.value)) && parseNum(r.value) !== 0);
  const isNumeric = numericRuns.length >= 3;

  // ±% change from oldest to latest numeric sample
  let pctChange = null;
  if (isNumeric && numericRuns.length >= 2) {
    const first = parseNum(numericRuns[0].value);
    const last  = parseNum(numericRuns[numericRuns.length - 1].value);
    if (first !== 0) pctChange = ((last - first) / Math.abs(first)) * 100;
  }
  const isUp = pctChange !== null && pctChange >= 0;

  return (
    <div className="card" style={{ padding: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <div style={{ fontWeight: 600 }}>값 추이</div>
            {pctChange !== null && (
              <span style={{
                fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700,
                color: isUp ? '#00BD83' : '#E04A4A',
                padding: '1px 7px', borderRadius: 5,
                background: isUp ? 'rgba(0,189,131,0.11)' : 'rgba(224,74,74,0.11)',
              }}>
                {isUp ? '▲' : '▼'} {Math.abs(pctChange).toFixed(2)}%
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            {changeCount > 0 ? `${changeCount}회 값 변경 감지됨` : '수집 간 값 변화 이력'}
          </div>
        </div>
        <a
          href={`/api/crawlers/${crawlerId}/results/csv`}
          download
          className="btn ghost sm"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="download" className="icon icon-sm"/>CSV
        </a>
      </div>

      {/* Stock chart (numeric only) */}
      {isNumeric && <StockChart runs={numericRuns} parseNum={parseNum} chartId={crawlerId}/>}

      {/* Value history list */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: isNumeric ? 12 : 0 }}>
        {annotated.slice(0, 15).map((r, i) => (
          <div key={r.id || i} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto',
            gap: 10, padding: '7px 0', alignItems: 'center',
            borderBottom: i < Math.min(annotated.length, 15) - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 13,
                fontWeight: r.changed ? 600 : 400,
                color: r.changed ? 'var(--text)' : 'var(--text-mute)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.value || '—'}
              </div>
              {r.changed && (
                <span style={{
                  flexShrink: 0, fontSize: 9.5, padding: '1px 6px', borderRadius: 4,
                  background: 'var(--warn-soft)', color: 'var(--warn)',
                  border: '1px solid var(--warn-line)', fontFamily: 'var(--mono)', fontWeight: 600,
                }}>변경</span>
              )}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {r.run_at || '—'}
            </div>
            <StatusChip status={r.status === 'healed' ? 'healing' : r.status}/>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── New Crawler Wizard ────────────────────────────────────────────────────
function NewCrawlerScreen({ onClose, onRegister }) {
  const [step, setStep] = React.useState(0);
  const [url, setUrl] = React.useState('coupang.com/np/categories/178794');
  const [intent, setIntent] = React.useState('쿠팡 노트북 카테고리 베스트 페이지의 실시간 1위 상품명');
  const [domain, setDomain] = React.useState('commerce');
  const [threshold, setThreshold] = React.useState(85);
  const [schedule,   setSchedule]   = React.useState('daily-9');
  const [customCron, setCustomCron] = React.useState('');
  const [channels,   setChannels]   = React.useState(['api']);
  const [selected, setSelected] = React.useState(null);

  const steps = [
    { id:0, label:'대상 페이지',  sub:'URL 입력 및 렌더링' },
    { id:1, label:'추출 의도',    sub:'무엇을 가져올지 자연어로' },
    { id:2, label:'요소 선택',    sub:'클릭으로 수집 대상 지정' },
    { id:3, label:'운영 정책',    sub:'임계값 · 스케줄 · 출력' },
  ];

  const isValidCron = (expr) => /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.test(expr.trim());

  const canNext = () => {
    if (step===0) return url.trim().length > 3;
    if (step===1) return intent.trim().length > 2;
    if (step===2) return !!selected?.selector;
    if (step===3 && schedule === 'custom') return isValidCron(customCron);
    return true;
  };
  const next = () => canNext() && setStep(s => Math.min(s+1, steps.length-1));
  const prev = () => setStep(s => Math.max(s-1, 0));

  const SCHEDULE_LABEL = { 'daily-9':'매일 09:00', 'hourly':'매시간', '15m':'15분마다' };
  const DOMAIN_ALTS = { commerce:'소비 수요', labor:'노동 시장', realestate:'부동산', regulatory:'규제·공시', media:'미디어', finance:'금융' };
  const CHANNEL_LABEL = { api:'REST API', webhook:'Webhook', slack:'Slack', csv:'CSV' };

  const handleCreate = () => {
    const newCrawler = {
      id:           'cr_' + Math.random().toString(36).slice(2, 6),
      name:         intent.slice(0, 40) || url,
      url,
      org:          '',
      domain,
      threshold,
      css_selector: selected?.selector || '',
      user_intent:  intent,
      schedule: schedule === 'custom' ? customCron.trim() : schedule,
      channels:     channels.map(c => CHANNEL_LABEL[c] || c),
      owner:        'me',
    };
    if (onRegister) onRegister(newCrawler);
    else onClose();
  };

  return (
    <div className="fadein" style={{padding:'var(--s-7) var(--s-7) var(--s-11)', maxWidth:1180, margin:'0 auto'}}>
      <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', marginBottom:'var(--s-3)', fontSize:12, color:'var(--text-mute)'}}>
        <a onClick={onClose} className="muted" style={{cursor:'default'}}>크롤러</a>
        <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
        <span>새 크롤러</span>
      </div>

      <SectionTitle eyebrow="NEW CRAWLER" title={steps[step].label}>
        {steps[step].sub}
      </SectionTitle>

      {/* stepper */}
      <div style={{display:'flex', alignItems:'stretch', gap:0, marginBottom:'var(--s-5)'}}>
        {steps.map((s,i)=>(
          <React.Fragment key={s.id}>
            <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', flex:'0 0 auto'}}>
              <div style={{
                width:26, height:26, borderRadius:999, display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily:'var(--mono)', fontSize:12, fontWeight:600,
                background: i<step ? 'var(--ok-soft)' : i===step ? 'var(--accent)' : 'var(--bg-2)',
                color: i<step ? 'var(--ok)' : i===step ? '#fff' : 'var(--text-mute)',
                border: '1px solid '+(i<step ? 'var(--ok-line)' : i===step ? 'var(--accent)' : 'var(--border)')
              }}>
                {i<step ? <Icon name="check" className="icon icon-sm"/> : (i+1)}
              </div>
              <div>
                <div style={{fontSize:13, fontWeight:600, color: i<=step ? 'var(--text)' : 'var(--text-mute)'}}>{s.label}</div>
                <div className="dim" style={{fontSize:11}}>{s.sub}</div>
              </div>
            </div>
            {i<steps.length-1 && <div style={{flex:1, alignSelf:'center', height:1, background:'var(--border)', margin:'0 var(--s-4)'}}/>}
          </React.Fragment>
        ))}
      </div>

      <div className="card" style={{padding:'var(--s-6)', minHeight:440}}>
        {step===0 && <WizardStep1 url={url} setUrl={setUrl}/>}
        {step===1 && <WizardStep2 intent={intent} setIntent={setIntent} domain={domain} setDomain={setDomain}/>}
        {step===2 && <WizardStep3 url={url} intent={intent} domain={domain} selected={selected} setSelected={setSelected}/>}
        {step===3 && <WizardStep4 threshold={threshold} setThreshold={setThreshold} schedule={schedule} setSchedule={setSchedule} customCron={customCron} setCustomCron={setCustomCron} channels={channels} setChannels={setChannels}/>}
      </div>

      <div style={{display:'flex', justifyContent:'space-between', marginTop:'var(--s-4)'}}>
        <button className="btn ghost" onClick={onClose}>취소</button>
        <div style={{display:'flex', gap:'var(--s-2)'}}>
          {step>0 && <button className="btn" onClick={prev}><Icon name="arrow_l" className="icon icon-sm"/>이전</button>}
          {step<steps.length-1 && <button className="btn primary" onClick={next} disabled={!canNext()} style={{opacity: canNext()?1:0.5}}>다음<Icon name="arrow_r" className="icon icon-sm"/></button>}
          {step===steps.length-1 && <button className="btn primary" onClick={handleCreate}><Icon name="check" className="icon icon-sm"/>크롤러 생성</button>}
        </div>
      </div>
    </div>
  );
}

function WizardStep1({url, setUrl}){
  const [previewSrc, setPreviewSrc] = React.useState('');
  const [imgState, setImgState] = React.useState('idle'); // idle | loading | ok | err
  const timer = React.useRef(null);

  React.useEffect(()=>{
    clearTimeout(timer.current);
    if(url.trim().length < 4){ setPreviewSrc(''); setImgState('idle'); return; }
    setImgState('loading');
    timer.current = setTimeout(()=>{
      const full = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://'+url.trim();
      setPreviewSrc(`https://api.microlink.io/?url=${encodeURIComponent(full)}&screenshot=true&meta=false&embed=screenshot.url`);
    }, 800);
    return ()=> clearTimeout(timer.current);
  }, [url]);

  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 1.1fr', gap:'var(--s-6)'}}>
      <div>
        <FieldLabel>대상 URL</FieldLabel>
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)', padding:'10px var(--s-3)',
          background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10
        }}>
          <Icon name="link" className="icon" style={{color:'var(--text-mute)'}}/>
          <input value={url} onChange={e=>setUrl(e.target.value)} style={{
            flex:1, background:'transparent', border:0, color:'var(--text)', outline:'none',
            fontFamily:'var(--mono)', fontSize:13
          }}/>
          <span className="chip ok" style={{fontSize:10.5}}><span className="dot"/>200 OK</span>
        </div>
        <div className="muted" style={{fontSize:12.5, marginTop:'var(--s-3)', lineHeight:1.6}}>
          공개 페이지는 즉시 분석됩니다. 로그인이 필요하면 <a style={{color:'var(--accent)'}}>인증 프로파일</a>을 먼저 등록하세요.
        </div>

        <div style={{
          marginTop:'var(--s-5)', padding:'var(--s-3) var(--s-4)',
          background:'var(--accent-soft)', borderRadius:10, border:'1px solid var(--accent-line)',
          display:'flex', gap:'var(--s-2)', alignItems:'flex-start'
        }}>
          <Icon name="info" className="icon icon-sm" style={{color:'var(--accent)', marginTop:2, flexShrink:0}}/>
          <div style={{fontSize:12.5, lineHeight:1.55}}>
            Mender는 <strong style={{color:'var(--text)'}}>Playwright headless 렌더</strong>로 페이지를 가져온 뒤
            <strong style={{color:'var(--text)'}}> 모든 DOM 노드를 후보 풀</strong>로 사용합니다. JS로 그려지는 콘텐츠도 안전합니다.
          </div>
        </div>

        <div style={{marginTop:'var(--s-5)'}}>
          <FieldLabel small>기술 가용성 자동 체크</FieldLabel>
          <div style={{display:'flex', flexDirection:'column', gap:'var(--s-2)'}}>
            <CapRow ic="check" tone="ok"    title="JS 렌더링 콘텐츠"      sub="동적 DOM도 headless 브라우저로 안전하게 수집"/>
            <CapRow ic="check" tone="ok"    title="DOM 구조 변경"        sub="자가치유로 자동 복구 — 본 서비스의 핵심"/>
            <CapRow ic="info"  tone="warn"  title="로그인이 필요한 페이지" sub="별도 인증 프로파일 등록 후 사용 가능"/>
            <CapRow ic="x"     tone="danger" title="CAPTCHA · Anti-bot"   sub="현재 PoC 범위 밖 — 별도 솔루션 필요"/>
          </div>
        </div>

        <div style={{marginTop:'var(--s-4)'}}>
          <FieldLabel small>최근 사용한 URL</FieldLabel>
          <div style={{display:'flex', flexDirection:'column', gap:2}}>
            {['coupang.com/np/categories/178794', 'dart.fss.or.kr/dsab001', 'jobkorea.co.kr/recruit/joblist', 'land.naver.com/complexes/8928'].map(u=>(
              <button key={u} className="btn ghost" style={{justifyContent:'flex-start', fontFamily:'var(--mono)', fontSize:12, padding:'6px var(--s-3)'}}
                onClick={()=>setUrl(u)}>
                <Icon name="history" className="icon icon-sm"/>{u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 실제 페이지 미리보기 패널 ── */}
      <div style={{
        position:'relative', background:'var(--bg-3)', border:'1px solid var(--border)', borderRadius:12,
        overflow:'hidden', minHeight:380, display:'flex', flexDirection:'column'
      }}>
        {/* 브라우저 크롬 헤더 */}
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)', padding:'8px var(--s-3)',
          background:'var(--bg-2)', borderBottom:'1px solid var(--border)', flexShrink:0
        }}>
          <span style={{width:9, height:9, borderRadius:999, background:'#FF5F57', flexShrink:0}}/>
          <span style={{width:9, height:9, borderRadius:999, background:'#FEBC2E', flexShrink:0}}/>
          <span style={{width:9, height:9, borderRadius:999, background:'#28C840', flexShrink:0}}/>
          <div style={{
            flex:1, marginLeft:'var(--s-2)', background:'var(--bg-3)',
            border:'1px solid var(--border)', borderRadius:6, padding:'3px 8px',
            display:'flex', alignItems:'center', gap:6, minWidth:0
          }}>
            <Icon name="link" className="icon icon-sm" style={{color:'var(--text-dim)', flexShrink:0}}/>
            <span className="mono" style={{
              fontSize:11, color:'var(--text-mute)',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
            }}>{url || '—'}</span>
          </div>
          <span className="chip" style={{fontSize:10, flexShrink:0}}>headless</span>
        </div>

        {/* 콘텐츠 영역 */}
        <div style={{flex:1, position:'relative', overflowY:'auto', minHeight:280}}>

          {/* idle */}
          {imgState === 'idle' && (
            <div style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              height:'100%', gap:10, color:'var(--text-dim)', padding:24, textAlign:'center'
            }}>
              <Icon name="link" className="icon icon-lg" style={{opacity:0.35}}/>
              <div style={{fontSize:12, lineHeight:1.6}}>URL을 입력하면<br/>실제 페이지 미리보기가 표시됩니다</div>
            </div>
          )}

          {/* loading */}
          {imgState === 'loading' && (
            <div style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              height:'100%', gap:12, color:'var(--text-dim)'
            }}>
              <div className="spin" style={{
                width:22, height:22, borderRadius:999,
                border:'2.5px solid var(--border-strong)',
                borderTopColor:'var(--accent)'
              }}/>
              <div style={{fontSize:12}}>페이지 렌더링 중…</div>
            </div>
          )}

          {/* 스크린샷 이미지 */}
          {previewSrc && (
            <img
              key={previewSrc}
              src={previewSrc}
              alt="page preview"
              style={{
                width:'100%', height:'auto',
                display: imgState === 'ok' ? 'block' : 'none'
              }}
              onLoad={()=> setImgState('ok')}
              onError={()=> setImgState('err')}
            />
          )}

          {/* error */}
          {imgState === 'err' && (
            <div style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              height:'100%', gap:10, color:'var(--text-dim)', padding:24, textAlign:'center'
            }}>
              <Icon name="x" className="icon icon-lg" style={{opacity:0.45}}/>
              <div style={{fontSize:12, lineHeight:1.6}}>
                미리보기를 불러올 수 없습니다<br/>
                <span className="mono" style={{fontSize:10.5}}>URL을 다시 확인해 주세요</span>
              </div>
            </div>
          )}
        </div>

        {/* 하단 상태 바 */}
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)',
          padding:'var(--s-2) var(--s-3)', background:'var(--bg-2)',
          borderTop:'1px solid var(--border)', flexShrink:0
        }}>
          {imgState === 'ok'
            ? <><Icon name="check" className="icon icon-sm" style={{color:'var(--ok)'}}/>
               <div className="dim mono" style={{fontSize:11}}>렌더 완료 · 4,872개 DOM 노드 수집</div></>
            : imgState === 'loading'
            ? <div className="dim mono" style={{fontSize:11}}>렌더 중…</div>
            : imgState === 'err'
            ? <><Icon name="x" className="icon icon-sm" style={{color:'var(--danger)'}}/>
               <div className="dim mono" style={{fontSize:11}}>렌더 실패</div></>
            : <div className="dim mono" style={{fontSize:11}}>URL 입력 대기</div>
          }
        </div>
      </div>
    </div>
  );
}

function PreviewMini({label, val, tone}){
  return (
    <div>
      <div className="dim" style={{fontSize:11}}>{label}</div>
      <div className="mono" style={{fontSize:15, fontWeight:600, marginTop:2}}>{val}</div>
      <div style={{fontSize:10.5, color: tone==='ok'?'var(--ok)':'var(--danger)'}}>
        {tone==='ok'?'▲':'▼'} 0.{Math.floor(Math.random()*40)+10}%
      </div>
    </div>
  );
}

function CapRow({ic, tone, title, sub}){
  const color = tone==='ok' ? 'var(--ok)' : tone==='warn' ? 'var(--warn)' : 'var(--danger)';
  const bg    = tone==='ok' ? 'var(--ok-soft)' : tone==='warn' ? 'var(--warn-soft)' : 'var(--danger-soft)';
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:'var(--s-3)',
      padding:'8px var(--s-3)', borderRadius:8,
      background:'var(--bg-2)', border:'1px solid var(--border)'
    }}>
      <div style={{
        width:22, height:22, borderRadius:6, flexShrink:0,
        background:bg, color:color,
        display:'flex', alignItems:'center', justifyContent:'center'
      }}>
        <Icon name={ic} className="icon icon-sm"/>
      </div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:12.5, fontWeight:600}}>{title}</div>
        <div className="dim" style={{fontSize:11, marginTop:1, lineHeight:1.4}}>{sub}</div>
      </div>
    </div>
  );
}

const INTENT_PRESETS = [
  { d:'finance',  text:'USD 매매기준율 (원/달러 환율)' },
  { d:'finance',  text:'KOSPI 지수 종가' },
  { d:'commerce', text:'쿠팡 노트북 카테고리 베스트 1위 상품명' },
  { d:'commerce', text:'특정 상품의 현재 판매가 (원 단위 숫자)' },
  { d:'media',    text:'멜론 차트 실시간 1위 곡 제목' },
  { d:'public',   text:'서울 종로구 오늘 최고 기온 (섭씨)' },
];

const DOMAINS = [
  {id:'commerce',   label:'이커머스',   hint:'가격 · 랭킹 · 재고'},
  {id:'labor',      label:'노동 시장',  hint:'채용공고 · 임금'},
  {id:'regulatory', label:'규제·공시',  hint:'DART · 공정위 · 입찰'},
  {id:'realestate', label:'부동산',     hint:'호가 · 거래량'},
  {id:'media',      label:'미디어',     hint:'차트 · 조회수 · 트렌드'},
  {id:'finance',    label:'금융',       hint:'환율 · 지수 · 금리'},
];

function WizardStep2({intent, setIntent, domain, setDomain}){
  const [tplFilter, setTplFilter] = React.useState('all');
  const cats = ['all', ...Array.from(new Set(TEMPLATES.map(t=>t.cat)))];
  const tpls = tplFilter==='all' ? TEMPLATES : TEMPLATES.filter(t=>t.cat===tplFilter);

  const pickTpl = (t) => {
    setIntent(t.intent);
    // map cat → domain
    const map = {'소비 수요':'commerce', '노동 시장':'labor', '규제·공시':'regulatory', '부동산':'realestate', '미디어':'media'};
    setDomain(map[t.cat] || 'commerce');
  };

  return (
    <div style={{display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:'var(--s-6)'}}>
      <div>
        <FieldLabel>대안 데이터 템플릿</FieldLabel>
        <div className="muted" style={{fontSize:12.5, marginBottom:'var(--s-3)', lineHeight:1.55}}>
          금융·매크로 리서치에서 자주 쓰는 데이터를 골라 시작하세요. 사이트별 하드코딩 없이 일반화된 파이프라인으로 동작합니다.
        </div>

        <div className="seg" style={{marginBottom:'var(--s-3)', flexWrap:'wrap'}}>
          {cats.map(c=>(
            <button key={c} className={tplFilter===c?'active':''} onClick={()=>setTplFilter(c)}>
              {c==='all' ? '전체' : c}
            </button>
          ))}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'var(--s-2)'}}>
          {tpls.map(t=>{
            const on = intent === t.intent;
            return (
              <button key={t.id} onClick={()=>pickTpl(t)} className="btn"
                style={{
                  display:'flex', flexDirection:'column', alignItems:'stretch', textAlign:'left',
                  padding:'var(--s-3)', gap:'var(--s-2)',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--bg-2)',
                  borderRadius:10, minHeight:104,
                }}>
                <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)'}}>
                  <span className="chip" style={{fontSize:10, padding:'1px 7px', background:'var(--bg-3)'}}>{t.cat}</span>
                  <span className="dim mono" style={{fontSize:10.5, marginLeft:'auto'}}>{t.interval} 단위</span>
                </div>
                <div style={{fontSize:13, fontWeight:600, color:'var(--text)', lineHeight:1.35}}>{t.title}</div>
                <div className="dim" style={{fontSize:11.5, lineHeight:1.45, flex:1}}>{t.desc}</div>
                <div className="dim mono" style={{fontSize:10.5}}>{t.users}팀 사용 중</div>
              </button>
            );
          })}
        </div>

        <div style={{
          marginTop:'var(--s-4)', padding:'var(--s-3) var(--s-4)',
          background:'var(--bg-3)', borderRadius:10, border:'1px solid var(--border)',
          display:'flex', gap:'var(--s-2)', alignItems:'center'
        }}>
          <Icon name="info" className="icon icon-sm" style={{color:'var(--text-mute)', flexShrink:0}}/>
          <div className="muted" style={{fontSize:11.5, lineHeight:1.5}}>
            템플릿은 <strong style={{color:'var(--text)'}}>출발점</strong>일 뿐입니다. 새 사이트나 예외 케이스에서도 같은 파이프라인으로 동작 — 사이트별 프롬프트 튜닝은 없습니다.
          </div>
        </div>
      </div>

      <div>
        <FieldLabel>또는, 자연어로 직접 입력</FieldLabel>
        <div className="muted" style={{fontSize:12.5, marginBottom:'var(--s-3)', lineHeight:1.55}}>
          시각적 위치나 모양이 아니라 <strong style={{color:'var(--text)'}}>'역할'</strong>을 적어주세요. 이 문장이 그대로 LLM 추론 기준(<span className="mono dim">user_intent</span>)이 됩니다.
        </div>

        <div style={{position:'relative'}}>
          <textarea
            value={intent}
            onChange={e=>setIntent(e.target.value)}
            placeholder="예) 카테고리 베스트 페이지의 실시간 1위 상품명"
            style={{
              width:'100%', minHeight:110, resize:'vertical',
              padding:'var(--s-3) var(--s-4)',
              background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10,
              color:'var(--text)', fontSize:13.5, lineHeight:1.55, outline:'none',
              fontFamily:'var(--sans)'
            }}
          />
          <div className="mono dim" style={{position:'absolute', bottom:8, right:10, fontSize:10.5}}>{intent.length}자</div>
        </div>

        <FieldLabel small style={{marginTop:'var(--s-4)'}}>도메인</FieldLabel>
        <div className="muted" style={{fontSize:11.5, marginTop:-2, marginBottom:'var(--s-2)'}}>
          도메인 정보는 LLM에 힌트로 전달됩니다. 같은 파이프라인을 사용하므로 사이트별 코드 변경은 없습니다.
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'var(--s-2)'}}>
          {DOMAINS.map(d=>{
            const on = domain===d.id;
            return (
              <button key={d.id} onClick={()=>setDomain(d.id)} className="btn"
                style={{
                  justifyContent:'flex-start', padding:'8px var(--s-3)', alignItems:'center',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--bg-2)',
                  color: on ? 'var(--text)' : 'var(--text-mute)'
                }}>
                <div style={{
                  width:16, height:16, borderRadius:999, flexShrink:0,
                  border:'1.5px solid '+(on?'var(--accent)':'var(--border-strong)'),
                  background: on ? 'var(--accent)' : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center'
                }}>{on && <span style={{width:6, height:6, borderRadius:999, background:'#fff'}}/>}</div>
                <div style={{textAlign:'left'}}>
                  <div style={{fontSize:12.5, fontWeight:600, color:'var(--text)'}}>{d.label}</div>
                  <div className="dim" style={{fontSize:10.5}}>{d.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{
          marginTop:'var(--s-4)', padding:'var(--s-3) var(--s-4)',
          background:'var(--bg-2)', borderRadius:10, border:'1px solid var(--border)'
        }}>
          <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'var(--s-2)'}}>
            LLM에 전달될 프롬프트
          </div>
          <pre className="code" style={{margin:0, fontSize:11, background:'transparent', border:0, padding:0}}>{`domain: ${domain}
user_intent: """${intent || '(여기에 입력하신 문장)'}"""

규칙
- 텍스트 내용이 아니라 '역할'을 찾을 것
- 과거 정답과 다를 가능성을 가정하되,
  실제로 같은 값일 가능성도 배제하지 말 것`}</pre>
        </div>
      </div>
    </div>
  );
}

function WizardStep3({ url, selected, setSelected }) {
  const canvasRef  = React.useRef(null);
  const wsRef      = React.useRef(null);
  const stateRef   = React.useRef('connecting');
  const lastMoveAt = React.useRef(0);

  const [connState, _setConn] = React.useState('connecting');
  const [nodeCount, setNodeCount] = React.useState(null);
  const [removeMode, setRemoveMode] = React.useState(false);

  const setConn = (s) => { stateRef.current = s; _setConn(s); };

  const REMOTE_W = 1280, REMOTE_H = 800;

  React.useEffect(() => {
    let ws;
    try {
      ws = new WebSocket('ws://localhost:3001');
    } catch(e) {
      setConn('error'); return;
    }
    wsRef.current = ws;

    ws.onerror = () => setConn('error');

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === 'frame') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = new Image();
        img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0, REMOTE_W, REMOTE_H);
        img.src = 'data:image/jpeg;base64,' + msg.data;
        return;
      }
      if (msg.type === 'status') {
        setConn(msg.status);
        if (msg.nodeCount) setNodeCount(msg.nodeCount);
        if (msg.status === 'connected') {
          const full = /^https?:\/\//i.test(url) ? url : 'https://' + url;
          ws.send(JSON.stringify({ type: 'navigate', url: full }));
        }
        return;
      }
      if (msg.type === 'selector') {
        setSelected(msg);
        return;
      }
      if (msg.type === 'error') {
        setConn('error');
      }
    };

    return () => ws.close();
  }, []);

  // non-passive wheel listener (React onWheel은 passive라 preventDefault 불가)
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e) => {
      e.preventDefault();
      if (stateRef.current !== 'ready') return;
      wsRef.current?.send(JSON.stringify({ type: 'scroll', dy: e.deltaY }));
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  const coords = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * REMOTE_W / r.width),
      y: Math.round((e.clientY - r.top)  * REMOTE_H / r.height),
    };
  };

  const onMouseMove = (e) => {
    if (stateRef.current !== 'ready') return;
    const now = Date.now();
    if (now - lastMoveAt.current < 32) return;
    lastMoveAt.current = now;
    wsRef.current?.send(JSON.stringify({ type: 'mousemove', ...coords(e) }));
  };

  const onClick = (e) => {
    if (stateRef.current !== 'ready') return;
    const c = coords(e);
    if (removeMode) {
      wsRef.current?.send(JSON.stringify({ type: 'remove_element', ...c }));
    } else {
      wsRef.current?.send(JSON.stringify({ type: 'click', ...c }));
    }
  };

  const sendEsc = () => {
    if (stateRef.current !== 'ready') return;
    wsRef.current?.send(JSON.stringify({ type: 'keypress', key: 'Escape' }));
  };

  const removeOverlays = () => {
    if (stateRef.current !== 'ready') return;
    wsRef.current?.send(JSON.stringify({ type: 'remove_overlays' }));
  };

  const stateLabel = {
    connecting: '서버 연결 중…',
    connected:  '페이지 로딩 중…',
    navigating: '페이지 로딩 중…',
    ready:      nodeCount ? `${nodeCount.toLocaleString()}개 노드 수집됨` : '준비됨',
    error:      '연결 실패',
  }[connState] || connState;

  const isReady = connState === 'ready';

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gap:'var(--s-6)' }}>

      {/* ── 왼쪽: 안내 + 선택 결과 ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:'var(--s-4)' }}>
        <div>
          <FieldLabel>수집 요소 선택</FieldLabel>
          <div className="muted" style={{ fontSize:12.5, lineHeight:1.65 }}>
            오른쪽 브라우저에서 수집할 요소를 <strong style={{ color:'var(--text)' }}>클릭</strong>하세요.
            마우스를 올리면 파란 테두리로 미리 확인할 수 있습니다.
          </div>
        </div>

        {/* 연결 상태 */}
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)',
          padding:'var(--s-3)', background:'var(--bg-3)',
          border:'1px solid var(--border)', borderRadius:10
        }}>
          {isReady
            ? <span className="chip ok"><span className="dot"/>Live</span>
            : connState === 'error'
            ? <span className="chip danger"><span className="dot"/>오류</span>
            : <div className="spin" style={{
                width:14, height:14, borderRadius:999, flexShrink:0,
                border:'2px solid var(--border-strong)', borderTopColor:'var(--accent)'
              }}/>
          }
          <span className="muted" style={{ fontSize:12.5 }}>{stateLabel}</span>
        </div>

        {/* 선택된 요소 */}
        {selected ? (
          <div style={{
            padding:'var(--s-4)', background:'var(--bg-2)',
            border:'1px solid var(--accent-line)', borderRadius:10,
            display:'flex', flexDirection:'column', gap:'var(--s-3)'
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:'var(--s-2)' }}>
              <Icon name="check" className="icon icon-sm" style={{ color:'var(--ok)' }}/>
              <span style={{ fontSize:13, fontWeight:600 }}>요소 선택됨</span>
              <button className="btn ghost sm" style={{ marginLeft:'auto' }}
                onClick={() => setSelected(null)}>
                <Icon name="x" className="icon icon-sm"/>다시 선택
              </button>
            </div>
            <div>
              <div className="dim mono" style={{ fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4 }}>CSS Selector</div>
              <pre className="code" style={{ margin:0, fontSize:11.5, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{selected.selector}</pre>
            </div>
            {selected.text && (
              <div>
                <div className="dim mono" style={{ fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4 }}>현재 값</div>
                <div style={{ fontSize:13, fontWeight:500 }}>{selected.text}</div>
              </div>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:'var(--s-2)' }}>
              <span className="chip" style={{ fontSize:11 }}>&lt;{selected.tag}&gt;</span>
              <span className="chip ok" style={{ fontSize:10.5, marginLeft:'auto' }}>
                <Icon name="check" className="icon icon-sm"/>셀렉터 확정
              </span>
            </div>
          </div>
        ) : (
          <div style={{
            padding:'var(--s-5)', background:'var(--bg-3)',
            border:'1px dashed var(--border-strong)', borderRadius:10,
            display:'flex', flexDirection:'column', alignItems:'center',
            gap:'var(--s-2)', color:'var(--text-dim)', textAlign:'center'
          }}>
            <Icon name="target" className="icon icon-lg" style={{ opacity:0.35 }}/>
            <div style={{ fontSize:12 }}>아직 선택된 요소가 없습니다</div>
          </div>
        )}

        <div style={{
          padding:'var(--s-3) var(--s-4)',
          background:'var(--accent-soft)', borderRadius:10, border:'1px solid var(--accent-line)',
          display:'flex', gap:'var(--s-2)', alignItems:'flex-start'
        }}>
          <Icon name="info" className="icon icon-sm" style={{ color:'var(--accent)', marginTop:2, flexShrink:0 }}/>
          <div style={{ fontSize:12, lineHeight:1.6 }}>
            스크롤로 페이지 아래쪽도 탐색 가능합니다.
            팝업·배너는 실제 DOM 수집에 영향 없습니다.
          </div>
        </div>
      </div>

      {/* ── 오른쪽: 실시간 브라우저 스트림 ── */}
      <div style={{
        border:'1px solid var(--border)', borderRadius:12,
        overflow:'hidden', display:'flex', flexDirection:'column',
        background:'var(--bg-3)'
      }}>
        {/* 브라우저 크롬 */}
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)', padding:'8px var(--s-3)',
          background:'var(--bg-2)', borderBottom:'1px solid var(--border)', flexShrink:0
        }}>
          <span style={{ width:9, height:9, borderRadius:999, background:'#FF5F57', flexShrink:0 }}/>
          <span style={{ width:9, height:9, borderRadius:999, background:'#FEBC2E', flexShrink:0 }}/>
          <span style={{ width:9, height:9, borderRadius:999, background:'#28C840', flexShrink:0 }}/>
          <div style={{
            flex:1, marginLeft:'var(--s-2)', background:'var(--bg-3)',
            border:'1px solid var(--border)', borderRadius:6, padding:'3px 8px',
            display:'flex', alignItems:'center', gap:6, minWidth:0
          }}>
            <Icon name="link" className="icon icon-sm" style={{ color:'var(--text-dim)', flexShrink:0 }}/>
            <span className="mono" style={{
              fontSize:11, color:'var(--text-mute)',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
            }}>{url || '—'}</span>
          </div>
          {isReady
            ? <span className="chip ok" style={{ fontSize:10, flexShrink:0 }}><span className="dot"/>Live</span>
            : connState === 'error'
            ? <span className="chip danger" style={{ fontSize:10, flexShrink:0 }}>오류</span>
            : <span className="chip" style={{ fontSize:10, flexShrink:0 }}>로딩 중</span>
          }
        </div>

        {/* 팝업 제거 툴바 */}
        <div style={{
          display:'flex', alignItems:'center', gap:'var(--s-2)', padding:'6px var(--s-3)',
          background:'var(--bg-3)', borderBottom:'1px solid var(--border)', flexShrink:0,
          fontSize:11.5
        }}>
          <span className="dim" style={{ fontSize:11, marginRight:'var(--s-1)' }}>팝업 제거:</span>
          <button
            className="btn ghost sm"
            title="ESC 키 전송 (팝업 닫기)"
            disabled={!isReady}
            onClick={sendEsc}
            style={{ padding:'3px 8px', fontSize:11.5 }}
          >
            <kbd style={{
              fontFamily:'inherit', fontSize:10.5, padding:'1px 5px',
              background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:4
            }}>ESC</kbd>
          </button>
          <button
            className="btn ghost sm"
            title="페이지 내 팝업·오버레이 자동 제거"
            disabled={!isReady}
            onClick={removeOverlays}
            style={{ padding:'3px 8px', fontSize:11.5 }}
          >
            자동 제거
          </button>
          <button
            className={`btn sm${removeMode ? ' primary' : ' ghost'}`}
            title="클릭한 요소를 DOM에서 제거하는 모드"
            disabled={!isReady}
            onClick={() => setRemoveMode(m => !m)}
            style={{ padding:'3px 8px', fontSize:11.5 }}
          >
            {removeMode ? '요소 지우기 ON' : '요소 지우기'}
          </button>
          {removeMode && (
            <span style={{
              fontSize:11, color:'var(--warn)', marginLeft:'var(--s-1)', fontWeight:500
            }}>
              클릭하면 요소가 삭제됩니다
            </span>
          )}
        </div>

        {/* 캔버스 + 로딩 오버레이 */}
        <div style={{ position:'relative', flex:1 }}>
          {!isReady && (
            <div style={{
              position:'absolute', inset:0, zIndex:1,
              display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center',
              gap:12, background:'var(--bg-3)', color:'var(--text-dim)'
            }}>
              {connState === 'error' ? (
                <>
                  <Icon name="x" className="icon icon-lg" style={{ opacity:0.45 }}/>
                  <div style={{ fontSize:12, textAlign:'center', lineHeight:1.65 }}>
                    서버에 연결할 수 없습니다<br/>
                    <span className="mono dim" style={{ fontSize:10.5 }}>
                      터미널에서 <strong>npm start</strong> 를 먼저 실행해 주세요
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="spin" style={{
                    width:26, height:26, borderRadius:999,
                    border:'3px solid var(--border-strong)',
                    borderTopColor:'var(--accent)'
                  }}/>
                  <div style={{ fontSize:12 }}>{stateLabel}</div>
                </>
              )}
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={REMOTE_W}
            height={REMOTE_H}
            style={{
              width:'100%', display:'block',
              aspectRatio:`${REMOTE_W} / ${REMOTE_H}`,
              cursor: isReady ? (removeMode ? 'not-allowed' : 'crosshair') : 'default',
            }}
            onMouseMove={onMouseMove}
            onClick={onClick}
          />
        </div>
      </div>

    </div>
  );
}

function FunnelStage({n, title, icon, count, sub, width, done, badge, accent}){
  return (
    <div style={{
      position:'relative', padding:'var(--s-3) var(--s-4)',
      background:'var(--bg-2)', border:'1px solid '+(accent?'var(--accent-line)':'var(--border)'),
      borderRadius:12, overflow:'hidden'
    }}>
      {/* progress band */}
      <div style={{
        position:'absolute', left:0, top:0, bottom:0, width:`${width}%`,
        background: accent ? 'var(--accent-soft)' : 'var(--bg-1)',
        pointerEvents:'none'
      }}/>
      <div style={{position:'relative', display:'flex', alignItems:'center', gap:'var(--s-3)'}}>
        <div style={{
          width:30, height:30, borderRadius:8, flexShrink:0,
          background: accent ? 'var(--accent)' : 'var(--bg-3)',
          border:'1px solid '+(accent?'var(--accent)':'var(--border)'),
          color: accent ? '#fff' : 'var(--text-mute)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:'var(--mono)', fontSize:12, fontWeight:600
        }}>{n}</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)'}}>
            <Icon name={icon} className="icon icon-sm" style={{color: accent?'var(--accent)':'var(--text-mute)'}}/>
            <div style={{fontSize:13.5, fontWeight:600}}>{title}</div>
            <div style={{flex:1}}/>
            <div className="mono" style={{fontSize:13, fontWeight:600, color:accent?'var(--accent)':'var(--text)'}}>{count}</div>
          </div>
          <div className="muted" style={{fontSize:11.5, marginTop:2, lineHeight:1.5}}>{sub}</div>
          {badge && <div className="dim mono" style={{fontSize:10.5, marginTop:6}}>{badge}</div>}
        </div>
        {done && <Icon name="check" className="icon icon-sm" style={{color:'var(--ok)', flexShrink:0}}/>}
      </div>
    </div>
  );
}

function MetricMini({label, val, accent}){
  return (
    <div style={{
      padding:'var(--s-3)', background:'var(--bg-2)',
      border:'1px solid var(--border)', borderRadius:10
    }}>
      <div className="dim" style={{fontSize:10.5, letterSpacing:'0.04em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>{label}</div>
      <div className="mono" style={{fontSize:18, fontWeight:600, marginTop:4, color: accent?'var(--accent)':'var(--text)'}}>{val}</div>
    </div>
  );
}

function FieldLabel({children, small, style}){
  return (
    <div style={{
      fontSize: small ? 10.5 : 11, color:'var(--text-dim)',
      letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)',
      marginBottom:'var(--s-2)', fontWeight:600,
      ...style
    }}>{children}</div>
  );
}

function WizardStep4({threshold, setThreshold, schedule, setSchedule, customCron, setCustomCron, channels, setChannels}){
  const isValidCron = (expr) => /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.test(expr.trim());
  const toggleCh = c => setChannels(channels.includes(c) ? channels.filter(x=>x!==c) : [...channels, c]);

  const action = threshold >= 95 ? '금융 등급 — 매우 보수적'
              : threshold >= 85 ? '엄격 — 일반적인 운영 데이터'
              : threshold >= 70 ? '균형 — 빠른 변동에 대응'
              : '관대 — 실험용 / 일반 컨텐츠';

  return (
    <div style={{display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:32}}>
      <div>
        <div style={{fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)', marginBottom:10}}>
          자가치유 임계값
        </div>
        <div className="muted" style={{fontSize:13, marginBottom:20, lineHeight:1.55}}>
          AI가 찾은 후보 셀렉터의 확신도가 이 값 <strong style={{color:'var(--text)'}}>이상</strong>이면 자동 복구하고, 그 미만이면 승인 큐로 보냅니다.
        </div>

        <div style={{
          fontFamily:'var(--mono)', fontSize:48, fontWeight:600, lineHeight:1,
          display:'flex', alignItems:'baseline', gap:8
        }}>
          {threshold}
          <span className="dim" style={{fontSize:18, fontWeight:400}}>/ 100</span>
        </div>
        <div style={{marginTop:6, fontSize:13, color: threshold>=95?'var(--ok)':threshold>=70?'var(--warn)':'var(--danger)'}}>
          {action}
        </div>

        <input type="range" min={40} max={100} value={threshold} onChange={e=>setThreshold(+e.target.value)}
          style={{width:'100%', marginTop:24}}/>
        <div className="ticks">
          <span>40</span><span>60</span><span>70</span><span>85</span><span>95</span><span>100</span>
        </div>

        <div style={{marginTop:28}}>
          <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10}}>
            정책 미리보기
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <PolicyRow color="var(--ok)" lo={threshold} hi={100} label="자동 복구" icon="check"/>
            <PolicyRow color="var(--warn)" lo={40} hi={threshold} label="수동 승인 대기" icon="bell"/>
            <PolicyRow color="var(--danger)" lo={0} hi={40} label="실패 알림 (Slack)" icon="x"/>
          </div>
        </div>
      </div>

      <div>
        <div style={{fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)', marginBottom:10}}>
          수집 주기
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom: schedule==='custom' ? 12 : 24}}>
          {[
            ['daily-9', '매일 09:00'],
            ['hourly', '매시간'],
            ['15m', '15분마다'],
            ['custom', 'Cron 직접 입력'],
          ].map(([id,l])=>(
            <button key={id} onClick={()=>setSchedule(id)} className="btn"
              style={{
                justifyContent:'flex-start', padding:'10px 12px',
                borderColor: schedule===id ? 'var(--accent)' : 'var(--border-strong)',
                background: schedule===id ? 'var(--accent-soft)' : 'var(--bg-3)',
                color: schedule===id ? 'var(--text)' : 'var(--text-mute)',
              }}>{l}</button>
          ))}
        </div>

        {schedule === 'custom' && (
          <div style={{marginBottom:24}}>
            <input
              type="text"
              className="input mono"
              placeholder="0 9 * * 1-5  (분 시 일 월 요일)"
              value={customCron}
              onChange={e => setCustomCron(e.target.value)}
              style={{
                width:'100%', boxSizing:'border-box',
                borderColor: customCron && !isValidCron(customCron) ? 'var(--danger)' : undefined,
              }}
            />
            <div style={{marginTop:8, display:'flex', flexDirection:'column', gap:4}}>
              {customCron && !isValidCron(customCron) && (
                <div style={{fontSize:11, color:'var(--danger)'}}>올바른 cron 표현식을 입력하세요 (5개 필드: 분 시 일 월 요일)</div>
              )}
              <div style={{fontSize:11, color:'var(--text-dim)', lineHeight:1.7}}>
                예시&nbsp;&nbsp;
                {[
                  ['0 9 * * 1-5', '평일 09:00'],
                  ['0 */6 * * *', '6시간마다'],
                  ['30 8 * * 1', '매주 월요일 08:30'],
                ].map(([expr, label]) => (
                  <span
                    key={expr}
                    onClick={() => setCustomCron(expr)}
                    className="mono"
                    style={{
                      marginRight:10, cursor:'default',
                      color:'var(--accent)', textDecoration:'underline', textDecorationStyle:'dotted',
                    }}
                    title={label}
                  >{expr}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)', marginBottom:10}}>
          전송 채널
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {[
            ['api','REST API','link','GET /api/v1/data/{id}'],
            ['webhook','Webhook','rocket','초 단위 실시간 푸시'],
            ['slack','Slack','slack','#crawler-alerts'],
            ['csv','CSV / Excel','csv','대시보드에서 다운로드'],
          ].map(([id,l,ic,sub])=>(
            <label key={id} style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
              background:'var(--bg-3)', border:'1px solid '+(channels.includes(id)?'var(--accent-line)':'var(--border)'),
              borderRadius:10, cursor:'default'
            }}
              onClick={()=>toggleCh(id)}>
              <div style={{
                width:18, height:18, borderRadius:5,
                border:'1.5px solid '+(channels.includes(id)?'var(--accent)':'var(--border-strong)'),
                background:channels.includes(id)?'var(--accent)':'transparent',
                display:'flex', alignItems:'center', justifyContent:'center'
              }}>
                {channels.includes(id) && <Icon name="check" className="icon icon-sm" style={{color:'#fff'}}/>}
              </div>
              <Icon name={ic} className="icon" style={{color:'var(--text-mute)'}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13, fontWeight:500}}>{l}</div>
                <div className="dim mono" style={{fontSize:11}}>{sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function PolicyRow({color, lo, hi, label, icon}){
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
      background:'var(--bg-3)', border:'1px solid var(--border)', borderRadius:10
    }}>
      <div style={{width:8, height:8, borderRadius:999, background:color, flexShrink:0}}/>
      <Icon name={icon} className="icon icon-sm" style={{color}}/>
      <div style={{flex:1, fontSize:13}}>{label}</div>
      <div className="mono" style={{fontSize:12, color:'var(--text-mute)'}}>
        {lo === hi ? `${lo}` : `${lo} ≤ score < ${hi}`}
      </div>
    </div>
  );
}

// ─── Delivery screen ───────────────────────────────────────────────────────
function DeliveryScreen(){
  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle eyebrow="DATA OUT" title="산출물 · 전송">
        수집한 데이터를 외부 시스템으로 내보내는 채널을 관리합니다.
      </SectionTitle>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:20}}>
        {[
          {icon:'link', label:'REST API', n:'42', sub:'엔드포인트', tone:'ok'},
          {icon:'rocket', label:'Webhook', n:'18', sub:'활성', tone:'ok'},
          {icon:'csv', label:'CSV / Excel', n:'7.4k', sub:'다운로드 (30d)', tone:''},
        ].map(c=>(
          <div key={c.label} className="card" style={{padding:18}}>
            <div style={{display:'flex', alignItems:'center', gap:10, color:'var(--text-mute)', fontSize:12.5}}>
              <Icon name={c.icon} className="icon"/>{c.label}
            </div>
            <div className="mono" style={{fontSize:30, fontWeight:600, marginTop:8}}>{c.n}</div>
            <div className="dim" style={{fontSize:12, marginTop:2}}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16}}>
        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center'}}>
            <div style={{fontWeight:600}}>API Endpoint 미리보기</div>
            <span className="chip ok" style={{marginLeft:'auto'}}>v1</span>
          </div>
          <div style={{padding:18}}>
            <pre className="code" style={{margin:0}}>{`# 인증 토큰: env.MENDER_TOKEN
curl https://api.mender.io/v1/data/cr_8x2k \\
  -H "Authorization: Bearer $MENDER_TOKEN"

{
  "crawler_id": "cr_8x2k",
  "value": "1,342.50",
  "collected_at": "2026-05-12T09:14:22+09:00",
  "self_healing": { "applied": false, "score": 98.4 }
}`}</pre>
          </div>
        </div>

        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)'}}>
            <div style={{fontWeight:600}}>Webhook 등록</div>
          </div>
          <div style={{padding:18, display:'flex', flexDirection:'column', gap:10}}>
            {[
              ['#crawler-alerts','Slack','slack','ok'],
              ['hooks.client.io/p/9k2','HTTPS POST','link','ok'],
              ['biz@finch.kr','Email','mail','warn'],
            ].map(([n,kind,ic,t])=>(
              <div key={n} style={{
                display:'flex', alignItems:'center', gap:12, padding:'10px 12px',
                background:'var(--bg-3)', borderRadius:10, border:'1px solid var(--border)'
              }}>
                <Icon name={ic} className="icon" style={{color:'var(--text-mute)'}}/>
                <div style={{flex:1, minWidth:0}}>
                  <div className="mono" style={{fontSize:12.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{n}</div>
                  <div className="dim" style={{fontSize:11}}>{kind}</div>
                </div>
                <span className={`chip ${t}`}><span className="dot"/>{t==='ok'?'활성':'미인증'}</span>
              </div>
            ))}
            <button className="btn ghost" style={{justifyContent:'center', marginTop:6}}>
              <Icon name="plus" className="icon icon-sm"/>새 Webhook 추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Templates gallery ─────────────────────────────────────────────────────
function TemplatesScreen({ onUse }){
  const [tab, setTab] = React.useState('all');
  const cats = ['all', ...Array.from(new Set(TEMPLATES.map(t=>t.cat)))];
  const rows = tab==='all' ? TEMPLATES : TEMPLATES.filter(t=>t.cat===tab);

  return (
    <div className="fadein" style={{padding:'var(--s-7) var(--s-7) var(--s-11)', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle eyebrow="ALT-DATA TEMPLATES" title="대안 데이터 템플릿">
        리서치팀이 자주 쓰는 데이터를 한 번에 시작하세요. 사이트별 코드가 아니라 <strong style={{color:'var(--text)'}}>일반화된 파이프라인</strong>으로 동작합니다.
      </SectionTitle>

      <div className="seg" style={{marginBottom:'var(--s-4)', flexWrap:'wrap'}}>
        {cats.map(c=>(
          <button key={c} className={tab===c?'active':''} onClick={()=>setTab(c)}>
            {c==='all' ? '전체' : c}
          </button>
        ))}
      </div>

      <div className="grid" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
        {rows.map(t=>(
          <div key={t.id} className="card" style={{
            padding:'var(--s-5)', display:'flex', flexDirection:'column', gap:'var(--s-3)', minHeight:200
          }}>
            <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)'}}>
              <span className="chip" style={{fontSize:10.5}}>{t.cat}</span>
              <span className="dim mono" style={{fontSize:10.5, marginLeft:'auto'}}>{t.interval} 단위</span>
            </div>
            <div style={{fontSize:16, fontWeight:600, lineHeight:1.3}}>{t.title}</div>
            <div className="muted" style={{fontSize:12.5, lineHeight:1.55, flex:1}}>{t.desc}</div>
            <div style={{
              padding:'var(--s-2) var(--s-3)', background:'var(--bg-3)', borderRadius:8,
              fontFamily:'var(--mono)', fontSize:11, color:'var(--text-mute)', lineHeight:1.5
            }}>
              <span className="dim">intent: </span>{t.intent}
            </div>
            <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)'}}>
              <span className="dim mono" style={{fontSize:11}}>{t.users}팀 사용 중</span>
              <button className="btn primary sm" style={{marginLeft:'auto'}} onClick={onUse}>
                <Icon name="plus" className="icon icon-sm"/>이 템플릿으로 시작
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SelectorRepickPanel ──────────────────────────────────────────────────
function SelectorRepickPanel({ crawler, onClose, onSaved }) {
  const canvasRef       = React.useRef(null);
  const wsRef           = React.useRef(null);
  const stateRef        = React.useRef('connecting');
  const lastMoveAt      = React.useRef(0);
  const testResolveRef  = React.useRef(null);

  const [connState, _setConn] = React.useState('connecting');
  const [nodeCount, setNodeCount] = React.useState(null);
  const [selected,  setSelected]  = React.useState(null);
  const [saving,    setSaving]    = React.useState(false);
  const [saveErr,   setSaveErr]   = React.useState('');
  const [removeMode, setRemoveMode] = React.useState(false);

  const setConn = (s) => { stateRef.current = s; _setConn(s); };
  const REMOTE_W = 1280, REMOTE_H = 800;
  const isReady = connState === 'ready';

  React.useEffect(() => {
    let ws;
    try { ws = new WebSocket('ws://localhost:3001'); } catch { setConn('error'); return; }
    wsRef.current = ws;
    ws.onerror = () => setConn('error');
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'frame') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = new Image();
        img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0, REMOTE_W, REMOTE_H);
        img.src = 'data:image/jpeg;base64,' + msg.data;
        return;
      }
      if (msg.type === 'status') {
        setConn(msg.status);
        if (msg.nodeCount) setNodeCount(msg.nodeCount);
        if (msg.status === 'connected') {
          const full = /^https?:\/\//i.test(crawler.url) ? crawler.url : 'https://' + crawler.url;
          ws.send(JSON.stringify({ type: 'navigate', url: full }));
        }
        return;
      }
      if (msg.type === 'selector') { setSelected(msg); setSaveErr(''); return; }
      if (msg.type === 'test_result') {
        if (testResolveRef.current) { testResolveRef.current(msg); testResolveRef.current = null; }
        return;
      }
      if (msg.type === 'error')    { setConn('error'); }
    };
    return () => ws.close();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e) => {
      e.preventDefault();
      if (stateRef.current !== 'ready') return;
      wsRef.current?.send(JSON.stringify({ type: 'scroll', dy: e.deltaY }));
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  const coords = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * REMOTE_W / r.width),
      y: Math.round((e.clientY - r.top)  * REMOTE_H / r.height),
    };
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true); setSaveErr('');
    try {
      // 1) 저장 전 라이브 세션에서 셀렉터 검증
      const testResult = await new Promise((resolve) => {
        testResolveRef.current = resolve;
        wsRef.current?.send(JSON.stringify({ type: 'test_selector', selector: selected.selector }));
        setTimeout(() => {
          if (testResolveRef.current) { testResolveRef.current({ found: false, error: '응답 시간 초과' }); testResolveRef.current = null; }
        }, 6000);
      });

      if (!testResult.found) {
        setSaveErr(`셀렉터가 현재 페이지에서 매칭되지 않습니다${testResult.error ? ': ' + testResult.error : ' — 다른 요소를 선택해 주세요'}`);
        setSaving(false);
        return;
      }

      // 2) DB 저장
      const resp = await fetch(`/api/crawlers/${crawler.id}/selector`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ css_selector: selected.selector, user_intent: crawler.user_intent }),
      });
      const updated = await resp.json();
      if (!resp.ok) { setSaveErr(updated.error || '저장 실패'); return; }
      onSaved(updated);
    } catch (e) {
      setSaveErr('저장 중 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const stateLabel = {
    connecting: '서버 연결 중…', connected: '페이지 로딩 중…',
    navigating: '페이지 로딩 중…',
    ready: nodeCount ? `${nodeCount.toLocaleString()}개 노드 수집됨` : '준비됨',
    error: '연결 실패',
  }[connState] || connState;

  return (
    <>
      <div onClick={onClose} style={{
        position:'fixed', inset:0, zIndex:19,
        background:'rgba(0,0,0,0.35)', backdropFilter:'blur(2px)'
      }}/>
      <div style={{
        position:'fixed', right:0, top:0, bottom:0, width:900, zIndex:20,
        background:'var(--bg-2)', borderLeft:'1px solid var(--border)',
        boxShadow:'var(--shadow-lg)', display:'flex', flexDirection:'column',
      }}>
        {/* 헤더 */}
        <div style={{
          padding:'14px 20px', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', gap:10, flexShrink:0,
        }}>
          <div style={{
            width:30, height:30, borderRadius:8,
            background:'var(--accent-soft)', color:'var(--accent)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <Icon name="target" className="icon icon-sm"/>
          </div>
          <div>
            <div style={{fontWeight:600, fontSize:14}}>셀렉터 재선택</div>
            <div className="dim mono" style={{fontSize:11}}>{crawler.url}</div>
          </div>
          <button className="btn ghost sm" style={{marginLeft:'auto', padding:6}} onClick={onClose}>
            <Icon name="x" className="icon icon-sm"/>
          </button>
        </div>

        {/* 본문: 좌(결과) + 우(브라우저) */}
        <div style={{display:'grid', gridTemplateColumns:'260px 1fr', flex:1, overflow:'hidden'}}>

          {/* 좌: 상태 + 선택 결과 + 저장 */}
          <div style={{
            padding:18, borderRight:'1px solid var(--border)',
            display:'flex', flexDirection:'column', gap:14, overflowY:'auto',
          }}>
            <div style={{
              display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
              background:'var(--bg-3)', border:'1px solid var(--border)', borderRadius:8,
            }}>
              {isReady
                ? <span className="chip ok"><span className="dot"/>Live</span>
                : connState === 'error'
                ? <span className="chip danger"><span className="dot"/>오류</span>
                : <div className="spin" style={{width:13, height:13, borderRadius:999, flexShrink:0,
                    border:'2px solid var(--border-strong)', borderTopColor:'var(--accent)'}}/>
              }
              <span className="muted" style={{fontSize:12}}>{stateLabel}</span>
            </div>

            <div style={{fontSize:12, color:'var(--text-mute)', lineHeight:1.6}}>
              오른쪽 브라우저에서 수집할 요소를 <strong style={{color:'var(--text)'}}>클릭</strong>하세요.
            </div>

            {/* 팝업 제거 */}
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              <button className="btn ghost sm" disabled={!isReady} style={{fontSize:11, padding:'4px 8px'}}
                onClick={() => wsRef.current?.send(JSON.stringify({ type: 'keypress', key: 'Escape' }))}>
                ESC
              </button>
              <button className="btn ghost sm" disabled={!isReady} style={{fontSize:11, padding:'4px 8px'}}
                onClick={() => wsRef.current?.send(JSON.stringify({ type: 'remove_overlays' }))}>
                팝업 제거
              </button>
              <button className={`btn sm${removeMode?' primary':' ghost'}`} disabled={!isReady}
                style={{fontSize:11, padding:'4px 8px'}}
                onClick={() => setRemoveMode(m => !m)}>
                요소 지우기
              </button>
            </div>

            {/* 기존 셀렉터 */}
            <div>
              <div className="dim mono" style={{fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4}}>현재 셀렉터</div>
              <pre className="code" style={{margin:0, fontSize:10.5, whiteSpace:'pre-wrap', wordBreak:'break-all', opacity:0.6}}>
                {crawler.css_selector || '(없음)'}
              </pre>
            </div>

            {/* 선택 결과 */}
            {selected ? (
              <div style={{
                padding:12, background:'var(--bg-2)',
                border:'1px solid var(--accent-line)', borderRadius:8,
                display:'flex', flexDirection:'column', gap:10,
              }}>
                <div style={{display:'flex', alignItems:'center', gap:6}}>
                  <Icon name="check" className="icon icon-sm" style={{color:'var(--ok)'}}/>
                  <span style={{fontSize:13, fontWeight:600}}>요소 선택됨</span>
                  <button className="btn ghost sm" style={{marginLeft:'auto', fontSize:11}} onClick={() => setSelected(null)}>다시 선택</button>
                </div>
                <div>
                  <div className="dim mono" style={{fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4}}>새 셀렉터</div>
                  <pre className="code" style={{margin:0, fontSize:10.5, whiteSpace:'pre-wrap', wordBreak:'break-all'}}>{selected.selector}</pre>
                </div>
                {selected.text && (
                  <div>
                    <div className="dim mono" style={{fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4}}>현재 값</div>
                    <div style={{fontSize:13, fontWeight:500}}>{selected.text}</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                padding:20, background:'var(--bg-3)',
                border:'1px dashed var(--border-strong)', borderRadius:8,
                display:'flex', flexDirection:'column', alignItems:'center',
                gap:8, color:'var(--text-dim)', textAlign:'center',
              }}>
                <Icon name="target" className="icon icon-lg" style={{opacity:0.35}}/>
                <div style={{fontSize:12}}>아직 선택된 요소 없음</div>
              </div>
            )}

            <div style={{flex:1}}/>
            {saveErr && (
              <div style={{
                padding:'8px 10px', borderRadius:6,
                background:'var(--danger-soft)', color:'var(--danger)',
                fontSize:11, lineHeight:1.5,
              }}>{saveErr}</div>
            )}
            <button className="btn primary" disabled={!selected || saving} onClick={handleSave}
              style={{justifyContent:'center', padding:10, opacity: selected ? 1 : 0.45}}>
              {saving
                ? <><div className="spin" style={{width:13, height:13, borderRadius:999,
                    border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff'}}/>검증 중…</>
                : <><Icon name="check" className="icon icon-sm"/>셀렉터 저장</>
              }
            </button>
          </div>

          {/* 우: 실시간 브라우저 */}
          <div style={{display:'flex', flexDirection:'column', background:'var(--bg-3)', overflow:'hidden'}}>
            <div style={{position:'relative', flex:1}}>
              {!isReady && (
                <div style={{
                  position:'absolute', inset:0, zIndex:1,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  gap:12, background:'var(--bg-3)', color:'var(--text-dim)',
                }}>
                  {connState === 'error' ? (
                    <>
                      <Icon name="x" className="icon icon-lg" style={{opacity:0.45}}/>
                      <div style={{fontSize:12, textAlign:'center', lineHeight:1.65}}>
                        서버에 연결할 수 없습니다<br/>
                        <span className="mono dim" style={{fontSize:10.5}}>npm start 를 먼저 실행해 주세요</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="spin" style={{width:26, height:26, borderRadius:999,
                        border:'3px solid var(--border-strong)', borderTopColor:'var(--accent)'}}/>
                      <div style={{fontSize:12}}>{stateLabel}</div>
                    </>
                  )}
                </div>
              )}
              <canvas
                ref={canvasRef}
                width={REMOTE_W} height={REMOTE_H}
                style={{
                  width:'100%', display:'block',
                  aspectRatio:`${REMOTE_W} / ${REMOTE_H}`,
                  cursor: isReady ? (removeMode ? 'not-allowed' : 'crosshair') : 'default',
                }}
                onMouseMove={(e) => {
                  if (stateRef.current !== 'ready') return;
                  const now = Date.now();
                  if (now - lastMoveAt.current < 32) return;
                  lastMoveAt.current = now;
                  const r = canvasRef.current.getBoundingClientRect();
                  wsRef.current?.send(JSON.stringify({ type: 'mousemove',
                    x: Math.round((e.clientX - r.left) * REMOTE_W / r.width),
                    y: Math.round((e.clientY - r.top)  * REMOTE_H / r.height),
                  }));
                }}
                onClick={(e) => {
                  if (stateRef.current !== 'ready') return;
                  const r = canvasRef.current.getBoundingClientRect();
                  const c = {
                    x: Math.round((e.clientX - r.left) * REMOTE_W / r.width),
                    y: Math.round((e.clientY - r.top)  * REMOTE_H / r.height),
                  };
                  wsRef.current?.send(JSON.stringify({
                    type: removeMode ? 'remove_element' : 'click', ...c,
                  }));
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── HealPanel ─────────────────────────────────────────────────────────────
function HealPanel({ crawler, onClose }) {
  const [v1Html,   setV1Html]   = React.useState('');
  const [v2Html,   setV2Html]   = React.useState('');
  const [v1State,  setV1State]  = React.useState('loading'); // loading | ok | error
  const [v2State,  setV2State]  = React.useState('loading'); // loading | ok | error
  const [selector, setSelector] = React.useState(crawler.css_selector || '');
  const [intent,   setIntent]   = React.useState(crawler.user_intent  || '');
  const [phase,    setPhase]    = React.useState('idle'); // idle | healing | done | error
  const [result,   setResult]   = React.useState(null);
  const [errMsg,   setErrMsg]   = React.useState('');

  // 마운트 시 V1(스냅샷) + V2(현재 페이지) 자동 수집
  React.useEffect(() => {
    // V1: 서버에 저장된 스냅샷
    fetch(`/api/crawlers/${crawler.id}/snapshot`)
      .then(r => r.json())
      .then(data => {
        if (data.html) { setV1Html(data.html); setV1State('ok'); }
        else throw new Error(data.error || '스냅샷 없음');
      })
      .catch(e => setV1State('error'));

    // V2: Playwright로 현재 페이지 수집
    const fullUrl = /^https?:\/\//i.test(crawler.url) ? crawler.url : 'https://' + crawler.url;
    fetch('/fetch-html', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.html) { setV2Html(data.html); setV2State('ok'); }
        else throw new Error(data.error || '수집 실패');
      })
      .catch(() => setV2State('error'));
  }, []);

  const runHeal = async () => {
    setPhase('healing'); setResult(null); setErrMsg('');
    try {
      const resp = await fetch('/heal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          v1_html: v1Html, v2_html: v2Html,
          css_selector: selector, user_intent: intent,
          target_name: crawler.name,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResult(data); setPhase('done');
    } catch (e) {
      setErrMsg(`치유 실패: ${e.message}`); setPhase('error');
    }
  };

  const dataReady = v1State === 'ok' && v2State === 'ok';
  const canRun    = dataReady && selector && phase === 'idle';

  const HtmlStatus = ({ state, label }) => {
    const icon  = state === 'loading' ? null : state === 'ok' ? 'check' : 'x';
    const color = state === 'ok' ? 'var(--ok)' : state === 'error' ? 'var(--danger)' : 'var(--text-mute)';
    const bg    = state === 'ok' ? 'var(--ok-soft)' : state === 'error' ? 'var(--danger-soft)' : 'var(--bg-3)';
    const border = state === 'ok' ? 'var(--ok-line)' : state === 'error' ? 'var(--danger-line)' : 'var(--border)';
    return (
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'9px 12px',
        background:bg, border:`1px solid ${border}`, borderRadius:8,
      }}>
        {state === 'loading'
          ? <div className="spin" style={{width:13, height:13, borderRadius:999,
              border:'2px solid var(--border-strong)', borderTopColor:'var(--accent)', flexShrink:0}}/>
          : <Icon name={icon} className="icon icon-sm" style={{color, flexShrink:0}}/>
        }
        <span style={{fontSize:12.5, color}}>
          {state === 'loading' ? `${label} 수집 중…` :
           state === 'ok'      ? `${label} 수집 완료` :
                                 `${label} 수집 실패`}
        </span>
      </div>
    );
  };

  return (
    <>
      {/* 딤드 배경 */}
      <div onClick={onClose} style={{
        position:'fixed', inset:0, zIndex:19,
        background:'rgba(0,0,0,0.28)', backdropFilter:'blur(2px)'
      }}/>

      {/* 패널 */}
      <div style={{
        position:'fixed', right:0, top:0, bottom:0, width:460, zIndex:20,
        background:'var(--bg-2)', borderLeft:'1px solid var(--border)',
        boxShadow:'var(--shadow-lg)', display:'flex', flexDirection:'column',
        overflowY:'auto'
      }}>
        {/* 헤더 */}
        <div style={{
          padding:'16px 20px', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', gap:10,
          position:'sticky', top:0, background:'var(--bg-2)', zIndex:1
        }}>
          <div style={{
            width:30, height:30, borderRadius:8,
            background:'var(--healing-soft)', color:'var(--healing)',
            display:'flex', alignItems:'center', justifyContent:'center'
          }}>
            <Icon name="bolt" className="icon icon-sm"/>
          </div>
          <div>
            <div style={{fontWeight:600, fontSize:14}}>자가치유 실행</div>
            <div className="dim" style={{fontSize:11}}>ML + GPT-4o-mini 하이브리드</div>
          </div>
          <button className="btn ghost sm" style={{marginLeft:'auto', padding:6}} onClick={onClose}>
            <Icon name="x" className="icon icon-sm"/>
          </button>
        </div>

        {/* 폼 */}
        <div style={{padding:20, display:'flex', flexDirection:'column', gap:16, flex:1}}>

          {/* HTML 수집 상태 */}
          <div>
            <FieldLabel>HTML 수집 상태</FieldLabel>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              <HtmlStatus state={v1State} label="V1 (첫 실행 스냅샷)"/>
              <HtmlStatus state={v2State} label="V2 (현재 페이지)"/>
            </div>
            {(v1State === 'error' || v2State === 'error') && (
              <div style={{
                marginTop:8, padding:'8px 12px', background:'var(--warn-soft)',
                border:'1px solid var(--warn-line)', borderRadius:8,
                fontSize:12, color:'var(--warn)', lineHeight:1.55,
              }}>
                {v1State === 'error' && <div>V1 스냅샷 없음 — "지금 실행" 버튼으로 크롤러를 한 번 이상 실행해야 생성됩니다.</div>}
                {v2State === 'error' && <div>현재 페이지 수집 실패 — URL을 확인하거나 네트워크 상태를 점검하세요.</div>}
              </div>
            )}
          </div>

          {/* 셀렉터 */}
          <div>
            <FieldLabel>기존 CSS 셀렉터 (깨진 것)</FieldLabel>
            <input value={selector} onChange={e => setSelector(e.target.value)} style={{
              width:'100%', padding:'8px 12px', background:'var(--bg-3)',
              border:'1px solid var(--border)', borderRadius:8,
              color:'var(--text)', fontSize:12, fontFamily:'var(--mono)',
              outline:'none', boxSizing:'border-box'
            }}/>
          </div>

          {/* 의도 */}
          <div>
            <FieldLabel>수집 의도 (User Intent)</FieldLabel>
            <textarea value={intent} onChange={e => setIntent(e.target.value)} rows={2} style={{
              width:'100%', padding:'8px 12px', background:'var(--bg-3)',
              border:'1px solid var(--border)', borderRadius:8,
              color:'var(--text)', fontSize:13, fontFamily:'var(--sans)',
              outline:'none', resize:'vertical', boxSizing:'border-box'
            }}/>
          </div>

          {/* 에러 */}
          {errMsg && (
            <div style={{
              padding:'10px 12px', background:'var(--danger-soft)',
              border:'1px solid var(--danger-line)', borderRadius:8,
              fontSize:12.5, color:'var(--danger)'
            }}>{errMsg}</div>
          )}

          {/* 실행 버튼 */}
          <button className="btn primary" onClick={runHeal} disabled={!canRun}
            style={{justifyContent:'center', padding:11, opacity: canRun ? 1 : 0.5}}>
            {phase === 'healing' ? (
              <>
                <div className="spin" style={{width:14, height:14, borderRadius:999,
                  border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff'}}/>
                ML 필터링 + GPT 추론 중…
              </>
            ) : (
              <><Icon name="bolt" className="icon icon-sm"/>자가치유 실행</>
            )}
          </button>

          {/* 결과 */}
          {result && (
            <div style={{display:'flex', flexDirection:'column', gap:12}}>
              <div style={{height:1, background:'var(--border)'}}/>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <span className={`chip ${
                  result.status === 'healed'           ? 'ok'     :
                  result.status === 'no_change_needed' ? 'accent' : 'danger'
                }`}>
                  <span className="dot"/>
                  {result.status === 'healed'           ? '치유 성공'   :
                   result.status === 'no_change_needed' ? '셀렉터 유효' : '치유 실패'}
                </span>
                {result.confidence > 0 && (
                  <span className="mono dim" style={{fontSize:12, marginLeft:'auto'}}>
                    신뢰도 {Math.round(result.confidence * 100)}%
                  </span>
                )}
              </div>

              {result.extracted_text && (
                <div>
                  <FieldLabel small>복구된 값</FieldLabel>
                  <div style={{
                    padding:'10px 14px', background:'var(--ok-soft)',
                    border:'1px solid var(--ok-line)', borderRadius:8,
                    fontWeight:600, fontSize:15
                  }}>{result.extracted_text}</div>
                </div>
              )}

              {result.robust_selector && (
                <div>
                  <FieldLabel small>새 CSS 셀렉터</FieldLabel>
                  <pre style={{
                    margin:0, padding:'8px 12px', background:'var(--bg-3)',
                    border:'1px solid var(--border)', borderRadius:8,
                    fontSize:11, fontFamily:'var(--mono)',
                    whiteSpace:'pre-wrap', wordBreak:'break-all'
                  }}>{result.robust_selector}</pre>
                </div>
              )}

              {result.reasoning && (
                <div>
                  <FieldLabel small>AI 추론 근거</FieldLabel>
                  <div style={{
                    padding:'10px 12px', background:'var(--bg-3)',
                    border:'1px solid var(--border)', borderRadius:8,
                    fontSize:12.5, lineHeight:1.65, color:'var(--text-mute)'
                  }}>{result.reasoning}</div>
                </div>
              )}

              {result.reason && (
                <div style={{
                  padding:'10px 12px', background:'var(--danger-soft)',
                  border:'1px solid var(--danger-line)', borderRadius:8,
                  fontSize:12.5, color:'var(--danger)'
                }}>{result.reason}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  OverviewScreen, ApprovalsScreen, DetailScreen, NewCrawlerScreen, DeliveryScreen, TemplatesScreen,
});
