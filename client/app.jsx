// app.jsx — Sidebar, top bar, routing, theme switching, Tweaks panel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "regular",
  "accent": "#3182F6",
  "simState": "live"
}/*EDITMODE-END*/;

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState({ name: 'overview' });
  const [currentOrg, setCurrentOrg] = React.useState('');
  const [scraperList, setScraperList] = React.useState([]);
  const [approvalCount, setApprovalCount] = React.useState(0);
  const [stats, setStats] = React.useState(null);

  // 서버 DB에서 스크래퍼 목록 + 승인 큐 카운트 + 통계 로드, 30초마다 자동 갱신
  const refreshScrapers = React.useCallback(() => {
    fetch('/api/scrapers')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setScraperList(data); })
      .catch(() => {});
  }, []);

  const refreshApprovals = React.useCallback(() => {
    fetch('/api/approvals')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setApprovalCount(data.length); })
      .catch(() => {});
  }, []);

  const refreshStats = React.useCallback(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});
  }, []);

  const handleRefresh = React.useCallback(() => {
    refreshScrapers();
    refreshApprovals();
    refreshStats();
  }, [refreshScrapers, refreshApprovals, refreshStats]);

  React.useEffect(() => {
    handleRefresh();
    const timer = setInterval(handleRefresh, 30000);
    return () => clearInterval(timer);
  }, [handleRefresh]);

  // theme — also persisted in localStorage so refresh keeps state
  React.useEffect(()=>{
    const stored = localStorage.getItem('doma.theme');
    if (stored && stored !== t.theme) setTweak('theme', stored);
  }, []); // eslint-disable-line
  React.useEffect(()=>{
    document.documentElement.dataset.theme = t.theme;
    localStorage.setItem('doma.theme', t.theme);
  }, [t.theme]);

  // density
  React.useEffect(()=>{
    const px = t.density==='compact' ? 12.5 : t.density==='comfy' ? 14 : 13.5;
    document.body.style.fontSize = px+'px';
  }, [t.density]);

  // accent
  React.useEffect(()=>{
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--accent-soft', hexA(t.accent, 0.10));
    document.documentElement.style.setProperty('--accent-line', hexA(t.accent, 0.28));
  }, [t.accent]);

  const go = (name, payload) => setRoute({ name, payload });
  const toggleTheme = () => setTweak('theme', t.theme==='light'?'dark':'light');

  const handleScraperUpdate = (updated) => {
    setScraperList(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  const handleDeleteScraper = async (id) => {
    try { await fetch(`/api/scrapers/${id}`, { method: 'DELETE' }); } catch {}
    setScraperList(prev => prev.filter(c => c.id !== id));
    refreshStats();
    go('overview');
  };

  const handleApprovalAction = () => {
    refreshApprovals();
    refreshScrapers();
    go('approvals');
  };

  const handleRegister = async (newScraper) => {
    setScraperList(prev => [newScraper, ...prev]);
    try {
      const resp = await fetch('/api/scrapers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newScraper),
      });
      if (resp.ok) {
        const saved = await resp.json();
        setScraperList(prev => prev.map(c => c.id === saved.id ? saved : c));
      }
    } catch {
      // optimistic entry stays; will sync on next auto-refresh
    }
  };

  return (
    <>
      <Sidebar route={route} onGo={go} currentOrg={currentOrg} onChangeOrg={setCurrentOrg} approvalCount={approvalCount}/>
      <main style={{flex:1, overflowY:'auto', overflowX:'hidden', background:'var(--bg-1)', position:'relative'}}>
        <TopBar route={route} onGo={go} currentOrg={currentOrg} theme={t.theme} onToggleTheme={toggleTheme}/>
        {route.name==='overview' && <OverviewScreen
          scrapers={scraperList}
          stats={stats}
          approvalCount={approvalCount}
          onOpenScraper={(c)=>go('detail', c)}
          onGoApprovals={()=>go('approvals')}
          onNewScraper={()=>go('new')}
          onRefresh={handleRefresh}
          onDeleteScraper={handleDeleteScraper}
        />}
        {route.name==='approvals' && <ApprovalsScreen
          onBack={()=>go('overview')}
          onAction={handleApprovalAction}
        />}
        {route.name==='detail' && <DetailScreen scraper={route.payload} onBack={()=>go('overview')} onScraperUpdate={handleScraperUpdate} onDelete={handleDeleteScraper}/>}
        {route.name==='new' && <NewScraperScreen onClose={()=>go('overview')} onRegister={handleRegister}/>}
        {route.name==='delivery' && <DeliveryScreen/>}
        {route.name==='settings' && <BlankScreen title="Settings" subtitle="조직 · 멤버 · API 토큰 · 알림"/>}
        {route.name==='activity' && <BlankScreen title="Activity" subtitle="조직 단위 자가치유 이벤트 타임라인"/>}
        {route.name==='templates' && <TemplatesScreen onUse={()=>go('new')}/>}
      </main>

      <TweaksPanel>
        <TweakSection label="외관" />
        <TweakRadio label="테마" value={t.theme}
          options={['light','dark']}
          onChange={(v)=>setTweak('theme', v)}/>
        <TweakRadio label="밀도" value={t.density}
          options={['compact','regular','comfy']}
          onChange={(v)=>setTweak('density', v)}/>
        <TweakColor label="Accent" value={t.accent}
          options={['#3182F6','#7C5BFF','#00BD83','#E08400','#E04A4A']}
          onChange={(v)=>setTweak('accent', v)}/>
        <TweakSection label="시뮬레이션" />
        <TweakSelect label="스크래퍼 상태" value={t.simState}
          options={[
            {value:'live',     label:'실시간 운영'},
            {value:'healing',  label:'자가치유 진행 중'},
            {value:'incident', label:'장애 발생'},
          ]}
          onChange={(v)=>setTweak('simState', v)}/>
      </TweaksPanel>
    </>
  );
}

function hexA(hex, a){
  const h = hex.replace('#','');
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function BlankScreen({title, subtitle}){
  return (
    <div className="fadein" style={{padding:'var(--s-7) var(--s-7) var(--s-11)', maxWidth:1480, margin:'0 auto'}}>
      <SectionTitle title={title}>{subtitle}</SectionTitle>
      <div className="card" style={{padding:'var(--s-11)', textAlign:'center'}}>
        <Icon name="cube" className="icon icon-lg" style={{margin:'0 auto var(--s-3)', display:'block', color:'var(--text-dim)'}}/>
        <div className="muted">이 화면은 데모에서 생략되었습니다.</div>
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar({route, onGo, currentOrg, approvalCount}){
  const sections = [
    { hdr:'워크스페이스', items:[
      {id:'overview',  label:'스크래퍼',     icon:'scraper'},
      {id:'approvals', label:'승인 큐',    icon:'inbox',   count:approvalCount||null, accent:'warn'},
      {id:'templates', label:'템플릿',     icon:'sparkles'},
      {id:'activity',  label:'활동',       icon:'history'},
    ]},
    { hdr:'데이터 출력', items:[
      {id:'delivery',  label:'전송 채널',  icon:'rocket'},
    ]},
    { hdr:'관리', items:[
      {id:'settings',  label:'설정',       icon:'settings'},
    ]},
  ];

  return (
    <aside style={{
      width:'var(--sidebar-w)', flexShrink:0, height:'100vh',
      background:'var(--sidebar-bg)', borderRight:'1px solid var(--border)',
      display:'flex', flexDirection:'column'
    }}>
      <div style={{padding:'var(--s-4)', borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', marginBottom:'var(--s-3)'}}>
          <Logo/>
          <div style={{fontSize:15, fontWeight:600, letterSpacing:'-0.015em'}}>DOMA</div>
          <span className="chip" style={{fontSize:10, padding:'1px 7px', marginLeft:'auto'}}>BETA</span>
        </div>
        <button className="btn" style={{
          width:'100%', justifyContent:'flex-start', padding:'7px var(--s-2)',
          background:'var(--bg-2)', borderColor:'var(--border)', borderRadius:10
        }}>
          <div style={{
            width:20, height:20, borderRadius:6,
            background:'linear-gradient(135deg, #3182F6, #7C5BFF)', flexShrink:0
          }}/>
          <span style={{flex:1, textAlign:'left', fontSize:13, fontWeight:500}}>{currentOrg}</span>
          <Icon name="chevron_d" className="icon icon-sm" style={{color:'var(--text-mute)'}}/>
        </button>
      </div>

      <div style={{flex:1, overflowY:'auto', padding:'var(--s-3) var(--s-2)'}}>
        {sections.map((s,si)=>(
          <div key={si} style={{marginTop: si===0 ? 0 : 'var(--s-4)'}}>
            <div className="dim" style={{
              fontSize:11, fontWeight:600, letterSpacing:'0.02em',
              padding:'var(--s-1) var(--s-3)', marginBottom:'var(--s-1)'
            }}>{s.hdr}</div>
            {s.items.map(it=>{
              const active = route.name === it.id;
              return (
                <button key={it.id} onClick={()=>onGo(it.id)}
                  className="btn ghost"
                  style={{
                    width:'100%', justifyContent:'flex-start', padding:'7px var(--s-3)',
                    gap:10, marginBottom:1, borderRadius:8,
                    background: active ? 'var(--bg-2)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-mute)',
                    fontWeight: active ? 600 : 500,
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <Icon name={it.icon} className="icon icon-sm" style={{color: active?'var(--accent)':'var(--text-mute)'}}/>
                  <span style={{flex:1, textAlign:'left', fontSize:13}}>{it.label}</span>
                  {it.count!=null && (
                    <span className={`chip ${it.accent || ''}`}
                      style={{fontSize:10.5, padding:'1px 7px'}}>{it.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{padding:'var(--s-3)', borderTop:'1px solid var(--border)'}}>
        <div className="card" style={{padding:'var(--s-3)'}}>
          <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', marginBottom:'var(--s-2)'}}>
            <span className="live-dot"/>
            <span style={{fontSize:12, fontWeight:500}}>전체 정상 운영 중</span>
          </div>
          <div className="dim mono" style={{fontSize:11, lineHeight:1.6}}>
            uptime 99.98% · 168h<br/>
            agents 12/12 healthy
          </div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', marginTop:'var(--s-3)', padding:'2px 4px'}}>
          <div style={{
            width:26, height:26, borderRadius:999,
            background:'linear-gradient(135deg, #FF8A6B, #7C5BFF)', flexShrink:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:11, fontWeight:600, color:'#fff'
          }}>MK</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:12.5, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>김민지</div>
            <div className="dim" style={{fontSize:11}}>admin · 핀치 리서치</div>
          </div>
          <button className="btn ghost xs" style={{padding:5}}>
            <Icon name="settings" className="icon icon-sm"/>
          </button>
        </div>
      </div>
    </aside>
  );
}

function Logo(){
  return (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="var(--accent)" stroke="none"/>
      <path d="M6 16 L6 8 L9 12 L12 9 L14 12 L17 8 L17 16" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="17" cy="16" r="1.6" fill="#fff"/>
    </svg>
  );
}

// ─── Top bar ───────────────────────────────────────────────────────────────
function TopBar({route, onGo, currentOrg, theme, onToggleTheme}){
  const titleMap = {
    overview:'스크래퍼', approvals:'승인 큐', detail:'스크래퍼 상세', new:'새 스크래퍼',
    delivery:'전송 채널', settings:'설정', activity:'활동', templates:'템플릿'
  };
  return (
    <div style={{
      position:'sticky', top:0, zIndex:5,
      display:'flex', alignItems:'center', gap:'var(--s-3)', padding:'0 var(--s-7)',
      borderBottom:'1px solid var(--border)',
      background:theme==='light' ? 'rgba(252,251,248,0.78)' : 'rgba(15,16,20,0.78)',
      backdropFilter:'blur(16px) saturate(160%)',
      WebkitBackdropFilter:'blur(16px) saturate(160%)',
      height:'var(--topbar-h)', minHeight:'var(--topbar-h)'
    }}>
      <div style={{display:'flex', alignItems:'center', gap:'var(--s-2)', fontSize:13, color:'var(--text-mute)'}}>
        <span>{currentOrg}</span>
        <Icon name="chevron_r" className="icon icon-sm" style={{color:'var(--text-dim)'}}/>
        <span style={{color:'var(--text)', fontWeight:600}}>{titleMap[route.name] || route.name}</span>
      </div>
      <div style={{flex:1}}/>
      <button className="btn ghost sm" style={{padding:'5px 10px'}}>
        <Icon name="search" className="icon icon-sm"/>
        <span style={{fontSize:12}}>빠른 이동…</span>
        <span className="kbd" style={{fontSize:10}}>⌘K</span>
      </button>
      <button className="btn ghost sm" onClick={onToggleTheme} title="테마 전환">
        <Icon name={theme==='light' ? 'moon' : 'sun'} className="icon icon-sm"/>
      </button>
      <button className="btn ghost sm" style={{padding:6, position:'relative'}}>
        <Icon name="bell" className="icon icon-sm"/>
        <span style={{
          position:'absolute', top:3, right:4, width:6, height:6, borderRadius:999,
          background:'var(--warn)'
        }}/>
      </button>
      <div style={{width:1, height:18, background:'var(--border)'}}/>
      <button className="btn primary sm" onClick={()=>onGo('new')}>
        <Icon name="plus" className="icon icon-sm"/>새 스크래퍼
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App/>);
