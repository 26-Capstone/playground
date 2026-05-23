// screens.jsx — All the screens for Mender.
// Components are attached to window for cross-script access.

// ─── Overview (Dashboard) ──────────────────────────────────────────────────
function OverviewScreen({ onOpenCrawler, onGoApprovals, onNewCrawler }) {
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  const tabs = [
    { id:'all',      label:'전체',         count: CRAWLERS.length },
    { id:'pending',  label:'승인 대기',     count: CRAWLERS.filter(c=>c.status==='pending').length },
    { id:'healing',  label:'자가치유 중',   count: CRAWLERS.filter(c=>c.status==='healing').length },
    { id:'failed',   label:'실패',         count: CRAWLERS.filter(c=>c.status==='failed').length },
    { id:'paused',   label:'일시중지',     count: CRAWLERS.filter(c=>c.status==='paused').length },
  ];

  const rows = CRAWLERS.filter(c =>
    (filter==='all' || c.status===filter) &&
    (!query || c.name.includes(query) || c.url.includes(query))
  );

  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle
        eyebrow="ALTERNATIVE DATA — REAL-TIME PIPELINES"
        title="대안 데이터 운영 현황"
        action={
          <div style={{display:'flex', gap:8}}>
            <button className="btn"><Icon name="refresh" className="icon icon-sm"/>새로고침</button>
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
        <Stat icon="crawler"  label="ACTIVE FEEDS"      value="42" sub={<><span style={{color:'var(--ok)'}}>+3</span> 이번 주</>} />
        <Stat icon="activity" label="7D 수집 성공률"    value="98.62%" sub={<>SLA 임계값 <span className="mono">95.00%</span> 상회</>} accent="var(--ok)"/>
        <Stat icon="bolt"     label="이번 주 자가치유"  value="27" sub={<>자동 24 · <span style={{color:'var(--warn)'}}>승인 대기 3</span></>} />
        <Stat icon="inbox"    label="평균 응답시간"     value="1.24s" sub="P95 2.81s · P99 4.10s" />
      </div>

      {/* Banner: pending approvals */}
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
          <div style={{fontWeight:600}}>3건의 자가치유 결과가 승인을 기다리고 있습니다</div>
          <div className="muted" style={{fontSize:12, marginTop:2}}>
            AI 확신도가 임계값 미달 — 대시보드에서 확인 후 승인해 주세요.
          </div>
        </div>
        <button className="btn" onClick={onGoApprovals}>승인 큐로 이동<Icon name="arrow_r" className="icon icon-sm"/></button>
      </div>

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
            <div className="muted" style={{fontSize:12}}>{c.schedule}</div>
            <button className="btn ghost sm" style={{padding:4}}><Icon name="more" className="icon icon-sm"/></button>
          </div>
        ))}
      </div>

      <div style={{marginTop:12, fontSize:12, color:'var(--text-dim)', display:'flex', justifyContent:'space-between'}}>
        <span>{rows.length}개 · 행을 클릭해 상세를 보세요</span>
        <span className="mono">v1.0.0-beta · region: ap-northeast-2</span>
      </div>
    </div>
  );
}

// ─── Approvals (Self-healing Human-in-the-Loop) ────────────────────────────
function ApprovalsScreen({ onBack, onApprove, onReject }) {
  const p = PENDING_APPROVAL;
  const passes = p.finalScore >= p.threshold;

  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:18, fontSize:12, color:'var(--text-mute)'}}>
        <a onClick={onBack} style={{cursor:'default'}} className="muted">Approvals</a>
        <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
        <span>cr_4n1p — 쿠팡 PS5 슬림 가격</span>
        <span className="chip warn" style={{marginLeft:8}}><span className="dot"/>수동 승인 대기</span>
      </div>

      <SectionTitle
        eyebrow="HUMAN-IN-THE-LOOP"
        title="자가치유 결과 검토"
        action={
          <div style={{display:'flex', gap:8}}>
            <button className="btn" onClick={onReject}><Icon name="x" className="icon icon-sm"/>거부 · 다시 시도</button>
            <button className="btn primary" onClick={onApprove} disabled={false}>
              <Icon name="check" className="icon icon-sm"/>승인 후 자동 복구
            </button>
          </div>
        }
      >
        AI가 찾은 후보의 확신도가 임계값에 미달했습니다. <strong style={{color:'var(--text)'}}>{p.crawler}</strong> 크롤러를 검토해 주세요.
      </SectionTitle>

      <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16, marginBottom:16}}>
        {/* Selector diff */}
        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10}}>
            <Icon name="code" className="icon"/>
            <div style={{fontWeight:600}}>Selector 변경</div>
            <span className="dim mono" style={{fontSize:11, marginLeft:'auto'}}>{p.detectedAt}</span>
          </div>

          <div style={{padding:18, display:'flex', flexDirection:'column', gap:14}}>
            <div>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                <span className="chip danger"><span className="dot"/>이전 (장애 발생)</span>
                <span className="dim mono" style={{fontSize:11}}>span.price_old · 매칭 0건</span>
              </div>
              <pre className="code" style={{margin:0}}>
{`<span class="`}<span className="removed">price_old</span>{`" font-weight="bold" color="red">529,000원</span>`}
              </pre>
            </div>

            <div style={{display:'flex', alignItems:'center', gap:8, color:'var(--text-dim)'}}>
              <Icon name="chevron_d" className="icon icon-sm"/>
              <span className="dim mono" style={{fontSize:11}}>자동 탐색 결과</span>
              <div style={{flex:1, height:1, background:'var(--border)'}}/>
            </div>

            <div>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                <span className="chip ok"><span className="dot"/>새 후보 #1</span>
                <span className="dim mono" style={{fontSize:11}}>div.val_new.bold-num · 매칭 1건</span>
              </div>
              <pre className="code" style={{margin:0}}>
{`<div class="`}<span className="added">val_new bold-num</span>{`" font-weight="bold" color="black">529,000원</div>`}
              </pre>
            </div>

            {/* Element comparison table */}
            <div style={{
              border:'1px solid var(--border)', borderRadius:10, overflow:'hidden',
              fontFamily:'var(--mono)', fontSize:12
            }}>
              {[
                ['Tag', p.oldElement.tag, p.newElement.tag, p.oldElement.tag !== p.newElement.tag],
                ['Weight', p.oldElement.attrs['font-weight'], p.newElement.attrs['font-weight'], false],
                ['Color', p.oldElement.attrs.color, p.newElement.attrs.color, true],
                ['텍스트', p.oldElement.text, p.newElement.text, false],
              ].map(([k,a,b,diff], i, arr)=> (
                <div key={k} style={{
                  display:'grid', gridTemplateColumns:'90px 1fr 1fr 28px',
                  padding:'8px 12px', alignItems:'center',
                  background: i%2 ? 'var(--bg-2)' : 'transparent',
                  borderBottom: i===arr.length-1 ? 'none' : '1px solid var(--border)'
                }}>
                  <div className="dim" style={{fontSize:11}}>{k}</div>
                  <div className="muted">{a}</div>
                  <div style={{color:'var(--text)'}}>{b}</div>
                  <div style={{display:'flex', justifyContent:'flex-end'}}>
                    {diff ? <span className="chip danger" style={{fontSize:10, padding:'1px 6px'}}>변경</span>
                          : <span className="chip ok" style={{fontSize:10, padding:'1px 6px'}}>일치</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Score panel */}
        <div className="card" style={{padding:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10}}>
            <Icon name="target" className="icon"/>
            <div style={{fontWeight:600}}>확신도 (Confidence)</div>
            <span className="chip" style={{marginLeft:'auto', fontSize:10}}>Logistic + AHP</span>
          </div>

          <div style={{padding:'24px 18px 12px', display:'flex', alignItems:'center', gap:18, justifyContent:'center'}}>
            <ScoreRing value={p.finalScore} threshold={p.threshold} size={120} stroke={10}/>
            <div style={{display:'flex', flexDirection:'column', gap:8, minWidth:160}}>
              <div>
                <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase'}}>Final Score</div>
                <div className="mono" style={{fontSize:22, fontWeight:600, color: passes ? 'var(--ok)':'var(--warn)'}}>
                  {p.finalScore.toFixed(1)} <span className="dim" style={{fontSize:13, fontWeight:400}}>/ 100</span>
                </div>
              </div>
              <div>
                <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase'}}>Threshold</div>
                <div className="mono" style={{fontSize:15, color:'var(--text-mute)'}}>
                  ≥ {p.threshold}.0
                </div>
              </div>
              <div className="chip warn" style={{alignSelf:'flex-start', marginTop:4}}>
                <Icon name="triangle_dn" className="icon icon-sm"/>
                임계값 미달 {(p.threshold - p.finalScore).toFixed(1)}p
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div style={{padding:'12px 18px 4px'}}>
            <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:10}}>
              Score Breakdown
            </div>
            {p.signals.map((s,i) => {
              const contrib = s.weight * s.raw;
              return (
                <div key={s.key} style={{padding:'8px 0', borderBottom: i===p.signals.length-1?'none':'1px solid var(--border)'}}>
                  <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:5, gap:8}}>
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <span style={{fontSize:13}}>{s.label}</span>
                      <span className="chip" style={{fontSize:10, padding:'0px 6px'}}>w={s.weight.toFixed(2)}</span>
                    </div>
                    <div className="mono" style={{fontSize:12.5}}>
                      <span style={{color: s.raw>=0.9?'var(--ok)':s.raw>=0.5?'var(--warn)':'var(--danger)'}}>{(s.raw*100).toFixed(0)}</span>
                      <span className="dim"> × {s.weight.toFixed(2)} = </span>
                      <span>{contrib.toFixed(3)}</span>
                    </div>
                  </div>
                  <div className="pbar thin">
                    <i style={{
                      width:`${s.raw*100}%`,
                      background: s.raw>=0.9?'var(--ok)':s.raw>=0.5?'var(--warn)':'var(--danger)'
                    }}/>
                  </div>
                  <div className="dim" style={{fontSize:11, marginTop:5}}>{s.why}</div>
                </div>
              );
            })}
          </div>

          <div style={{padding:'14px 18px', background:'var(--bg-3)', borderTop:'1px solid var(--border)', marginTop:6}}>
            <div className="dim mono" style={{fontSize:10.5, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6}}>
              Logistic σ(β·X)
            </div>
            <pre className="code" style={{margin:0, fontSize:11, padding:'8px 10px'}}>
{`P = 1 / (1 + e^-(β₀ + Σ βᵢXᵢ))
  = 1 / (1 + e^-(2.41 · 0.832 + 0.18))
  = `}<span className="hl">0.8634</span>{`  →  86.3%`}
            </pre>
          </div>
        </div>
      </div>

      {/* Other candidates */}
      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10}}>
          <Icon name="layers" className="icon"/>
          <div style={{fontWeight:600}}>다른 후보 셀렉터</div>
          <span className="muted" style={{fontSize:12}}>· 페이지에서 탐지된 상위 3개</span>
        </div>
        {p.candidates.map((c,i) => (
          <div key={c.rank} style={{
            display:'grid', gridTemplateColumns:'40px 1fr 200px 100px 130px',
            padding:'14px 18px', alignItems:'center',
            borderBottom: i===p.candidates.length-1?'none':'1px solid var(--border)'
          }}>
            <div className="mono dim" style={{fontSize:12}}>#{c.rank}</div>
            <div className="mono" style={{fontSize:12.5, color: i===0 ? 'var(--text)' : 'var(--text-mute)'}}>{c.selector}</div>
            <div className="mono" style={{fontSize:12.5}}>{c.preview}</div>
            <div className="mono" style={{
              fontSize:13, fontWeight:600,
              color: c.score>=90?'var(--ok)':c.score>=60?'var(--warn)':'var(--danger)'
            }}>{c.score.toFixed(1)}</div>
            <div style={{display:'flex', justifyContent:'flex-end', gap:6}}>
              <button className="btn ghost sm"><Icon name="eye" className="icon icon-sm"/>미리보기</button>
              {i===0 && <button className="btn sm">선택</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Crawler Detail ────────────────────────────────────────────────────────
function DetailScreen({ crawler, onBack }) {
  const c = crawler || CRAWLERS[0];
  const tabs = ['Overview', 'Runs', 'Healing log', 'Schema', 'Settings'];
  const [tab, setTab] = React.useState('Overview');

  // synthetic 30-day score chart
  const scores = c.spark.length ? c.spark : seedSpark30();

  return (
    <div className="fadein" style={{padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, fontSize:12, color:'var(--text-mute)'}}>
        <a onClick={onBack} className="muted" style={{cursor:'default'}}>Crawlers</a>
        <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
        <span>{c.id}</span>
      </div>

      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:24}}>
        <div style={{display:'flex', alignItems:'center', gap:18}}>
          <ScoreRing value={c.score} threshold={c.threshold} size={72} stroke={7}/>
          <div>
            <h2 style={{fontSize:24, fontWeight:600, marginBottom:6}}>{c.name}</h2>
            <div style={{display:'flex', alignItems:'center', gap:10, fontSize:12, color:'var(--text-mute)'}}>
              <StatusChip status={c.status}/>
              <span className="mono">{c.url}</span>
              <span className="dim">·</span>
              <span>{c.schedule}</span>
              <span className="dim">·</span>
              <span>owner: <span className="mono" style={{color:'var(--text)'}}>{c.owner}</span></span>
            </div>
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn ghost"><Icon name="pause" className="icon icon-sm"/>일시중지</button>
          <button className="btn ghost"><Icon name="play" className="icon icon-sm"/>지금 실행</button>
          <button className="btn"><Icon name="settings" className="icon icon-sm"/>설정</button>
        </div>
      </div>

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
      {tab==='Runs' && <DetailRuns/>}
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

function seedSpark30(){
  const out=[]; let v=95;
  for (let i=0;i<30;i++){v += (Math.random()-0.5)*4; out.push(Math.max(50, Math.min(100, v)));}
  return out;
}

function DetailOverview({ crawler, scores }) {
  const w = 760, h = 180;
  const max = 100, min = 50;
  const step = w/(scores.length-1);
  const pts = scores.map((v,i)=>[i*step, h - ((v-min)/(max-min))*(h-20) - 10]);
  const line = pts.map(p=>`${p[0]},${p[1]}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const thresholdY = h - ((crawler.threshold-min)/(max-min))*(h-20) - 10;

  return (
    <div style={{display:'grid', gridTemplateColumns:'1.7fr 1fr', gap:16}}>
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        {/* score chart */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
            <div>
              <div style={{fontWeight:600, marginBottom:2}}>Score 추이</div>
              <div className="dim" style={{fontSize:11.5}}>지난 30일</div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <button className="btn ghost sm">7d</button>
              <button className="btn sm">30d</button>
              <button className="btn ghost sm">90d</button>
            </div>
          </div>
          <div style={{position:'relative'}}>
            <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
              {[60,70,80,90,100].map(g=>{
                const y = h - ((g-min)/(max-min))*(h-20) - 10;
                return <line key={g} x1="0" x2={w} y1={y} y2={y} stroke="rgba(255,255,255,0.04)"/>;
              })}
              <line x1="0" x2={w} y1={thresholdY} y2={thresholdY} stroke="var(--warn)" strokeWidth="1" strokeDasharray="4 4" opacity="0.65"/>
              <polygon points={area} fill="var(--ok)" opacity="0.10"/>
              <polyline points={line} fill="none" stroke="var(--ok)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              {pts.map((p,i)=>i%4===0 && <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--bg-1)" stroke="var(--ok)" strokeWidth="1.2"/>)}
            </svg>
            <div className="mono" style={{
              position:'absolute', right:8, top:thresholdY-9, fontSize:10,
              color:'var(--warn)', background:'var(--bg-2)', padding:'1px 6px', borderRadius:4, border:'1px solid var(--warn-line)'
            }}>임계값 {crawler.threshold}</div>
          </div>
          <div className="ticks">
            <span>30d 전</span><span>21d</span><span>14d</span><span>7d</span><span>오늘</span>
          </div>
        </div>

        {/* sample payload */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
            <div style={{fontWeight:600}}>최근 수집 결과 (JSON)</div>
            <button className="btn ghost sm"><Icon name="download" className="icon icon-sm"/>다운로드</button>
          </div>
          <pre className="code" style={{margin:0}}>{`{
  "crawler_id": "${crawler.id}",
  "target": "${crawler.url}",
  "collected_at": "2026-05-12T09:14:22+09:00",
  "value": "${crawler.lastValue}",
  "schema": { "type": "number", "decimals": 2, "currency": "KRW" },
  "context_label": "매매기준율",
  "self_healing": {
    "applied": false,
    "score": ${crawler.score.toFixed(2)},
    "threshold": ${crawler.threshold}
  }
}`}</pre>
        </div>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>현재 셀렉터</div>
          <pre className="code" style={{margin:0, fontSize:11}}>
{`div.val_new.bold-num`}
          </pre>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:14, fontSize:12}}>
            <div>
              <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>데이터 타입</div>
              <div style={{marginTop:3}}>숫자 · 소수점 2자리</div>
            </div>
            <div>
              <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>주변 라벨</div>
              <div style={{marginTop:3}}>"매매기준율"</div>
            </div>
            <div>
              <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>DOM 깊이</div>
              <div className="mono" style={{marginTop:3}}>7 → 9</div>
            </div>
            <div>
              <div className="dim" style={{fontSize:10.5, letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'}}>임계값</div>
              <div className="mono" style={{marginTop:3}}>{crawler.threshold} / 100</div>
            </div>
          </div>
        </div>

        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>운영 통계</div>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {[
              ['7일 실행', crawler.runs7d.toString(), 'spark'],
              ['성공률', '98.81%', 'check'],
              ['자가치유 발동', crawler.healed + '회', 'bolt'],
              ['평균 응답', '1.12s', 'activity'],
            ].map(([k,v,ic])=>(
              <div key={k} style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, color:'var(--text-mute)', fontSize:12.5}}>
                  <Icon name={ic} className="icon icon-sm" style={{color:'var(--text-dim)'}}/>{k}
                </div>
                <div className="mono" style={{fontSize:13, fontWeight:500}}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{padding:18}}>
          <div style={{fontWeight:600, marginBottom:12}}>전송 채널</div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {crawler.delivery.map(d => (
              <div key={d} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px',
                background:'var(--bg-3)', borderRadius:8, border:'1px solid var(--border)'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <Icon name={d==='REST API'?'link': d==='Webhook'?'rocket': d==='Slack'?'slack':'csv'} className="icon"/>
                  <div>
                    <div style={{fontSize:13, fontWeight:500}}>{d}</div>
                    <div className="dim mono" style={{fontSize:11}}>
                      {d==='REST API' ? `GET /api/v1/data/${crawler.id}` :
                       d==='Webhook' ? 'POST https://hooks.…/cr_4n1p' :
                       d==='Slack' ? '#crawler-alerts' :
                       'daily_export.csv'}
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

function DetailRuns(){
  return (
    <div className="card" style={{padding:0, overflow:'hidden'}}>
      <div style={{
        display:'grid', gridTemplateColumns:'120px 130px 80px 110px 1fr',
        padding:'10px 18px', borderBottom:'1px solid var(--border)',
        fontSize:11, color:'var(--text-dim)', letterSpacing:'0.06em', textTransform:'uppercase', fontFamily:'var(--mono)'
      }}>
        <div>시간</div><div>상태</div><div>Score</div><div>응답시간</div><div>로그</div>
      </div>
      {RUN_HISTORY.map((r,i)=>(
        <div key={i} style={{
          display:'grid', gridTemplateColumns:'120px 130px 80px 110px 1fr',
          padding:'12px 18px', alignItems:'center',
          borderBottom: i===RUN_HISTORY.length-1?'none':'1px solid var(--border)'
        }}>
          <div className="mono" style={{fontSize:12}}>{r.ts}</div>
          <div><StatusChip status={r.status==='healed'?'healing':r.status}/></div>
          <div className="mono" style={{fontSize:12.5}}>{r.score===null ? '—' : r.score.toFixed(1)}</div>
          <div className="mono dim" style={{fontSize:12}}>{r.dur}</div>
          <div className="muted" style={{fontSize:12.5}}>{r.note}</div>
        </div>
      ))}
    </div>
  );
}

// ─── New Crawler Wizard ────────────────────────────────────────────────────
function NewCrawlerScreen({ onClose }) {
  const [step, setStep] = React.useState(0);
  const [url, setUrl] = React.useState('coupang.com/np/categories/178794');
  const [intent, setIntent] = React.useState('쿠팡 노트북 카테고리 베스트 페이지의 실시간 1위 상품명');
  const [domain, setDomain] = React.useState('commerce');
  const [threshold, setThreshold] = React.useState(85);
  const [schedule, setSchedule] = React.useState('daily-9');
  const [channels, setChannels] = React.useState(['api']);

  const steps = [
    { id:0, label:'대상 페이지',  sub:'URL 입력 및 렌더링' },
    { id:1, label:'추출 의도',    sub:'무엇을 가져올지 자연어로' },
    { id:2, label:'요소 선택',    sub:'클릭으로 수집 대상 지정' },
    { id:3, label:'운영 정책',    sub:'임계값 · 스케줄 · 출력' },
  ];

  const canNext = () => {
    if (step===0) return url.trim().length > 3;
    if (step===1) return intent.trim().length > 2;
    return true;
  };
  const next = () => canNext() && setStep(s => Math.min(s+1, steps.length-1));
  const prev = () => setStep(s => Math.max(s-1, 0));

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
        {step===2 && <WizardStep3 url={url} intent={intent} domain={domain}/>}
        {step===3 && <WizardStep4 threshold={threshold} setThreshold={setThreshold} schedule={schedule} setSchedule={setSchedule} channels={channels} setChannels={setChannels}/>}
      </div>

      <div style={{display:'flex', justifyContent:'space-between', marginTop:'var(--s-4)'}}>
        <button className="btn ghost" onClick={onClose}>취소</button>
        <div style={{display:'flex', gap:'var(--s-2)'}}>
          {step>0 && <button className="btn" onClick={prev}><Icon name="arrow_l" className="icon icon-sm"/>이전</button>}
          {step<steps.length-1 && <button className="btn primary" onClick={next} disabled={!canNext()} style={{opacity: canNext()?1:0.5}}>다음<Icon name="arrow_r" className="icon icon-sm"/></button>}
          {step===steps.length-1 && <button className="btn primary" onClick={onClose}><Icon name="check" className="icon icon-sm"/>크롤러 생성</button>}
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

function WizardStep3({ url }) {
  const canvasRef  = React.useRef(null);
  const wsRef      = React.useRef(null);
  const stateRef   = React.useRef('connecting');
  const lastMoveAt = React.useRef(0);

  const [connState, _setConn] = React.useState('connecting');
  const [nodeCount, setNodeCount] = React.useState(null);
  const [selected,  setSelected]  = React.useState(null);

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
    wsRef.current?.send(JSON.stringify({ type: 'click', ...coords(e) }));
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
              cursor: isReady ? 'crosshair' : 'default',
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

function WizardStep4({threshold, setThreshold, schedule, setSchedule, channels, setChannels}){
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
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:24}}>
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

Object.assign(window, {
  OverviewScreen, ApprovalsScreen, DetailScreen, NewCrawlerScreen, DeliveryScreen, TemplatesScreen,
});
