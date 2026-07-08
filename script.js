/* ============================================================
   INFL KR — Frontend v3.0
   서버 API 연동 + Mock Data Fallback
   ============================================================ */

const SERVER_URL = 'http://localhost:3001';
let usingServer  = false;   // 서버 연결 여부

// ────────────────────────────────────────────────────────────
// MOCK DATA (서버 미연결 시 기본값)
// ────────────────────────────────────────────────────────────
const MOCK_INFLUENCERS = [
  {id:1,name:"이제이",handle:"@jey_beauty_kr",category:"뷰티",followers:4200000,following:312,posts:1847,engagement:5.2,tier:"메가",location:"서울",bio:"K-뷰티 크리에이터 | 피부 케어, 메이크업 리뷰 전문 💄",tags:["스킨케어","메이크업","K뷰티","뷰티팁"],avatar:"💄",avatarUrl:null,coverColor:"linear-gradient(135deg,#ff6b9d,#c44dff)",coverUrl:null,verified:true,avgLikes:218400,avgComments:3120,profileUrl:"",isLive:false},
  {id:2,name:"김민준",handle:"@minjun.style",category:"패션",followers:2800000,following:455,posts:923,engagement:4.1,tier:"메가",location:"서울",bio:"패션 디렉터 | 스트리트 패션 | 시즌별 스타일링 팁 👗",tags:["OOTD","스트리트패션","남성패션","스타일링"],avatar:"👗",avatarUrl:null,coverColor:"linear-gradient(135deg,#667eea,#764ba2)",coverUrl:null,verified:true,avgLikes:114800,avgComments:2340,profileUrl:"",isLive:false},
  {id:3,name:"박소연",handle:"@soyeon_eats",category:"음식",followers:1560000,following:230,posts:2103,engagement:6.8,tier:"메가",location:"서울/부산",bio:"먹방 & 맛집 탐방 | 서울 숨은 맛집 발굴 전문 🍜",tags:["맛집","먹방","서울맛집","한식"],avatar:"🍜",avatarUrl:null,coverColor:"linear-gradient(135deg,#f093fb,#f5576c)",coverUrl:null,verified:true,avgLikes:106080,avgComments:4200,profileUrl:"",isLive:false},
  {id:4,name:"최하늘",handle:"@haneul_travel",category:"여행",followers:890000,following:621,posts:3412,engagement:4.5,tier:"매크로",location:"전국/해외",bio:"365일 여행하는 여행작가 | 국내외 숨겨진 명소 ✈️",tags:["국내여행","해외여행","감성사진","여행일기"],avatar:"✈️",avatarUrl:null,coverColor:"linear-gradient(135deg,#4facfe,#00f2fe)",coverUrl:null,verified:false,avgLikes:40050,avgComments:1890,profileUrl:"",isLive:false},
  {id:5,name:"정지훈",handle:"@jihoon_fit",category:"피트니스",followers:720000,following:180,posts:1256,engagement:7.2,tier:"매크로",location:"서울",bio:"전 국가대표 | 홈트레이닝 & 식단 관리 💪",tags:["홈트","다이어트","헬스","식단"],avatar:"💪",avatarUrl:null,coverColor:"linear-gradient(135deg,#43e97b,#38f9d7)",coverUrl:null,verified:true,avgLikes:51840,avgComments:3870,profileUrl:"",isLive:false},
  {id:6,name:"윤서아",handle:"@seoa_daily",category:"라이프스타일",followers:430000,following:892,posts:2876,engagement:5.9,tier:"매크로",location:"서울",bio:"30대 싱글의 일상 | 미니멀 라이프 🌿",tags:["미니멀라이프","일상","독서","힐링"],avatar:"🌿",avatarUrl:null,coverColor:"linear-gradient(135deg,#a8edea,#fed6e3)",coverUrl:null,verified:false,avgLikes:25370,avgComments:2140,profileUrl:"",isLive:false},
  {id:7,name:"강태양",handle:"@taeyang_games",category:"게임",followers:1200000,following:340,posts:1567,engagement:3.8,tier:"메가",location:"서울",bio:"프로게이머 출신 스트리머 | LoL, 발로란트 전문 🎮",tags:["게임","리그오브레전드","발로란트","스트리밍"],avatar:"🎮",avatarUrl:null,coverColor:"linear-gradient(135deg,#1a1a2e,#0f3460)",coverUrl:null,verified:true,avgLikes:45600,avgComments:5200,profileUrl:"",isLive:false},
  {id:8,name:"이수민",handle:"@sumin_mom",category:"육아",followers:350000,following:1203,posts:4321,engagement:8.1,tier:"매크로",location:"경기도",bio:"두 아이의 엄마 | 육아 꿀팁, 이유식, 교육 정보 공유 👶",tags:["육아","이유식","워킹맘","교육"],avatar:"👶",avatarUrl:null,coverColor:"linear-gradient(135deg,#ffecd2,#fcb69f)",coverUrl:null,verified:false,avgLikes:28350,avgComments:5670,profileUrl:"",isLive:false},
  {id:9,name:"한채원",handle:"@chaewon_glow",category:"뷰티",followers:680000,following:412,posts:2134,engagement:6.3,tier:"매크로",location:"서울",bio:"글로우 메이크업 전문 | 봄여름 컬러 메이크업 💋",tags:["글로우메이크업","파운데이션","봄메이크업","립"],avatar:"💋",avatarUrl:null,coverColor:"linear-gradient(135deg,#fbc2eb,#a6c1ee)",coverUrl:null,verified:true,avgLikes:42840,avgComments:3890,profileUrl:"",isLive:false},
  {id:10,name:"오준혁",handle:"@junhyuk_chef",category:"음식",followers:290000,following:567,posts:987,engagement:9.2,tier:"매크로",location:"부산",bio:"전직 셰프의 집밥 레시피 | 10분 요리 🍳",tags:["홈쿡","레시피","집밥","쉬운요리"],avatar:"🍳",avatarUrl:null,coverColor:"linear-gradient(135deg,#f7971e,#ffd200)",coverUrl:null,verified:false,avgLikes:26680,avgComments:4010,profileUrl:"",isLive:false},
  {id:11,name:"박나린",handle:"@narin_fashion",category:"패션",followers:185000,following:734,posts:1432,engagement:5.7,tier:"마이크로",location:"서울",bio:"빈티지 & 레트로 패션 🕶️",tags:["빈티지패션","레트로","중고패션","OOTD"],avatar:"🕶️",avatarUrl:null,coverColor:"linear-gradient(135deg,#e0c3fc,#8ec5fc)",coverUrl:null,verified:false,avgLikes:10545,avgComments:1234,profileUrl:"",isLive:false},
  {id:12,name:"류지민",handle:"@jimin_voyage",category:"여행",followers:148000,following:890,posts:1765,engagement:6.1,tier:"마이크로",location:"제주/서울",bio:"제주도 기반 여행 크리에이터 🌊",tags:["제주여행","한달살기","감성카페","제주맛집"],avatar:"🌊",avatarUrl:null,coverColor:"linear-gradient(135deg,#89f7fe,#66a6ff)",coverUrl:null,verified:false,avgLikes:9028,avgComments:2134,profileUrl:"",isLive:false},
  {id:13,name:"신예진",handle:"@yejin_wellness",category:"피트니스",followers:92000,following:1123,posts:876,engagement:10.4,tier:"마이크로",location:"인천",bio:"요가 강사 8년차 | 마음챙김 & 필라테스 🧘",tags:["요가","필라테스","명상","웰니스"],avatar:"🧘",avatarUrl:null,coverColor:"linear-gradient(135deg,#d4fc79,#96e6a1)",coverUrl:null,verified:false,avgLikes:9568,avgComments:4203,profileUrl:"",isLive:false},
  {id:14,name:"홍다은",handle:"@daeun_minimal",category:"라이프스타일",followers:67000,following:432,posts:543,engagement:7.8,tier:"마이크로",location:"서울",bio:"미니멀리스트 | 옷 30벌로 사는 법 🌍",tags:["미니멀리즘","제로웨이스트","친환경","정리정돈"],avatar:"🌍",avatarUrl:null,coverColor:"linear-gradient(135deg,#c1dfc4,#deecdd)",coverUrl:null,verified:false,avgLikes:5226,avgComments:1934,profileUrl:"",isLive:false},
  {id:15,name:"김도현",handle:"@dohyun_foodie",category:"음식",followers:8900,following:654,posts:234,engagement:12.1,tier:"나노",location:"광주",bio:"광주 로컬 맛집 전도사 🥢",tags:["광주맛집","로컬맛집","노포","한식"],avatar:"🥢",avatarUrl:null,coverColor:"linear-gradient(135deg,#fa709a,#fee140)",coverUrl:null,verified:false,avgLikes:1077,avgComments:698,profileUrl:"",isLive:false}
];

// ────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────
let INFLUENCERS = [...MOCK_INFLUENCERS];
let state = { search: '', category: 'all', sort: 'followers_desc', tier: 'all', page: 0, total: 0 };
let crawlPollTimer = null;

// ────────────────────────────────────────────────────────────
// SERVER CHECK & DATA FETCH
// ────────────────────────────────────────────────────────────
async function checkServer() {
  try {
    const res = await fetch(SERVER_URL + '/api/stats', { signal: AbortSignal.timeout(2000) });
    if (res.ok) { usingServer = true; return true; }
  } catch(e) {}
  usingServer = false;
  return false;
}

async function fetchFromServer() {
  const params = new URLSearchParams({
    q:        state.search,
    category: state.category,
    tier:     state.tier,
    sort:     state.sort,
    limit:    200,
    offset:   0
  });
  const res  = await fetch(SERVER_URL + '/api/influencers?' + params);
  const data = await res.json();
  return data;
}

async function loadData() {
  if (usingServer) {
    try {
      const data = await fetchFromServer();
      INFLUENCERS  = data.data;
      state.total  = data.total;
      setDataSource('live');
      document.getElementById('totalCount').textContent = data.total.toLocaleString();
      return;
    } catch(e) {
      console.warn('서버 조회 실패, 목업 사용:', e);
      usingServer = false;
    }
  }
  INFLUENCERS = applyLocalFilters(MOCK_INFLUENCERS);
  state.total = INFLUENCERS.length;
  setDataSource('mock');
  document.getElementById('totalCount').textContent = MOCK_INFLUENCERS.length;
}

// ────────────────────────────────────────────────────────────
// LOCAL FILTER (mock 모드)
// ────────────────────────────────────────────────────────────
function applyLocalFilters(data) {
  let d = data.slice();
  const q = state.search.toLowerCase().trim();
  if (q) d = d.filter(inf =>
    inf.name.indexOf(q) !== -1 || inf.handle.toLowerCase().indexOf(q) !== -1 ||
    inf.category.indexOf(q) !== -1 || inf.tags.some(t => t.toLowerCase().indexOf(q) !== -1) ||
    (inf.location||'').indexOf(q) !== -1 || (inf.bio||'').toLowerCase().indexOf(q) !== -1
  );
  if (state.category !== 'all') d = d.filter(i => i.category === state.category);
  if (state.tier !== 'all')     d = d.filter(i => i.tier === state.tier);
  const [field, dir] = state.sort.split('_');
  d.sort((a,b) => {
    if (field === 'name') return dir==='asc' ? a.name.localeCompare(b.name,'ko') : b.name.localeCompare(a.name,'ko');
    const va = field==='followers' ? a.followers : a.engagement;
    const vb = field==='followers' ? b.followers : b.engagement;
    return dir==='asc' ? va-vb : vb-va;
  });
  return d;
}

// ────────────────────────────────────────────────────────────
// RENDER
// ────────────────────────────────────────────────────────────
function formatN(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(0)+'K';
  return (n||0).toString();
}
function tierLabel(t) { return {메가:'🏆 메가',매크로:'⭐ 매크로',마이크로:'✨ 마이크로',나노:'🌱 나노'}[t]||t; }
function engColor(r) { return r>=8?'var(--accent-pink)':r>=5?'var(--accent-cyan)':'var(--accent-violet)'; }
function catEmoji(c) { return {뷰티:'💄',패션:'👗',음식:'🍜',여행:'✈️',피트니스:'💪',라이프스타일:'🌿',게임:'🎮',육아:'👶'}[c]||'✦'; }

function renderCard(inf, delay) {
  const ew = Math.min((inf.engagement/15)*100, 100);
  const coverBg = inf.coverUrl
    ? '<img src="'+inf.coverUrl+'" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\'" /><div style="position:absolute;inset:0;background:'+inf.coverColor+';opacity:0.4;"></div>'
    : '<div style="width:100%;height:100%;background:'+inf.coverColor+';"></div>';
  const avatar = inf.avatarUrl
    ? '<img src="'+inf.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.outerHTML=\''+catEmoji(inf.category)+'\'" />'
    : (inf.avatar || catEmoji(inf.category));
  const liveBadge = inf.isLive
    ? '<span style="position:absolute;top:12px;left:12px;font-size:10px;background:rgba(34,211,238,0.9);color:#000;padding:2px 8px;border-radius:100px;font-weight:700;z-index:2;">LIVE</span>'
    : '';
  return '<div class="card" data-id="'+inf.id+'" style="animation-delay:'+delay+'ms" onclick="openModal(\''+inf.id+'\')">'
    +'<div class="card-cover">'+coverBg+'<div class="card-cover-gradient"></div>'+liveBadge
    +'<div class="card-tier tier-'+inf.tier+'">'+tierLabel(inf.tier)+'</div>'
    +'<div class="card-avatar-wrap"><div class="card-avatar">'+avatar+'</div></div></div>'
    +'<div class="card-body">'
    +'<div class="card-name">'+inf.name+(inf.verified?' <span style="color:var(--accent-cyan);font-size:13px;">✓</span>':'')+'</div>'
    +'<div class="card-handle">'+inf.handle+'</div>'
    +'<div class="card-category">'+catEmoji(inf.category)+' '+inf.category+'</div>'
    +'<div class="card-stats">'
    +'<div class="stat"><span class="stat-value">'+formatN(inf.followers)+'</span><span class="stat-label">팔로워</span></div>'
    +'<div class="stat"><span class="stat-value">'+formatN(inf.posts)+'</span><span class="stat-label">게시물</span></div>'
    +'<div class="stat"><span class="stat-value" style="color:'+engColor(inf.engagement)+'">'+inf.engagement+'%</span><span class="stat-label">참여율</span></div>'
    +'</div></div>'
    +'<div class="engagement-bar-wrap"><div class="engagement-label"><span>참여율</span><strong>'+inf.engagement+'%</strong></div>'
    +'<div class="engagement-bar"><div class="engagement-fill" style="width:'+ew+'%;"></div></div></div>'
    +'<div class="card-footer">'
    +'<div class="card-tags">'+inf.tags.slice(0,2).map(t=>'<span class="tag">#'+t+'</span>').join('')+'</div>'
    +'<button class="card-btn" onclick="event.stopPropagation();openModal(\''+inf.id+'\')">상세보기</button></div></div>';
}

async function renderGrid() {
  await loadData();
  const data  = usingServer ? INFLUENCERS : applyLocalFilters(MOCK_INFLUENCERS);
  const grid  = document.getElementById('influencerGrid');
  const empty = document.getElementById('emptyState');
  document.getElementById('resultsCount').textContent = usingServer ? state.total : data.length;
  if (data.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = data.map((inf, i) => renderCard(inf, i * 30)).join('');
}

// ────────────────────────────────────────────────────────────
// MODAL
// ────────────────────────────────────────────────────────────
function openModal(id) {
  // id가 숫자(mock)일 수도 있고 서버 id일 수도 있음
  const inf = INFLUENCERS.find(i => String(i.id) === String(id));
  if (!inf) return;
  const ew  = Math.min((inf.engagement/15)*100, 100);
  const coverBg = inf.coverUrl
    ? '<img src="'+inf.coverUrl+'" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\'" /><div style="position:absolute;inset:0;background:'+inf.coverColor+';opacity:0.4;"></div>'
    : '<div style="width:100%;height:100%;background:'+inf.coverColor+';"></div>';
  const avt = inf.avatarUrl
    ? '<img src="'+inf.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'" />'
    : (inf.avatar || catEmoji(inf.category));
  const igLink = inf.profileUrl
    ? '<a href="'+inf.profileUrl+'" target="_blank" class="btn-secondary" style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;">📸 인스타 보기</a>'
    : '';
  const tagsHtml = inf.tags && inf.tags.length > 0
    ? '<div class="modal-tags-section"><div class="modal-section-title">주요 해시태그</div><div class="modal-tags">'+inf.tags.map(t=>'<span class="modal-tag">#'+t+'</span>').join('')+'</div></div>'
    : '';
  document.getElementById('modalContent').innerHTML =
    '<div class="modal-header">'+coverBg+'<div class="modal-cover-gradient"></div>'
    +(inf.isLive?'<span style="position:absolute;top:16px;left:16px;font-size:11px;background:rgba(34,211,238,0.9);color:#000;padding:3px 10px;border-radius:100px;font-weight:700;">LIVE DATA</span>':'')
    +'<div class="modal-avatar-wrap"><div class="modal-avatar">'+avt+'</div></div></div>'
    +'<div class="modal-body">'
    +'<div class="modal-name">'+inf.name+(inf.verified?' <span style="color:var(--accent-cyan);font-size:18px;">✓</span>':'')+'</div>'
    +'<div class="modal-handle">'+inf.handle+' · '+(inf.location||'한국')+'</div>'
    +'<p class="modal-bio">'+(inf.bio||'')+'</p>'
    +'<div class="modal-stats">'
    +'<div class="modal-stat"><span class="modal-stat-value">'+formatN(inf.followers)+'</span><span class="modal-stat-label">팔로워</span></div>'
    +'<div class="modal-stat"><span class="modal-stat-value">'+formatN(inf.following)+'</span><span class="modal-stat-label">팔로잉</span></div>'
    +'<div class="modal-stat"><span class="modal-stat-value">'+formatN(inf.posts)+'</span><span class="modal-stat-label">게시물</span></div>'
    +'<div class="modal-stat"><span class="modal-stat-value" style="color:'+engColor(inf.engagement)+'">'+inf.engagement+'%</span><span class="modal-stat-label">참여율</span></div>'
    +'<div class="modal-stat"><span class="modal-stat-value">'+formatN(inf.avgLikes)+'</span><span class="modal-stat-label">평균 좋아요</span></div>'
    +'<div class="modal-stat"><span class="modal-stat-value">'+formatN(inf.avgComments)+'</span><span class="modal-stat-label">평균 댓글</span></div>'
    +'</div>'
    +'<div class="engagement-bar-wrap" style="padding:0;margin-bottom:24px;">'
    +'<div class="engagement-label"><span>참여율</span><strong>'+inf.engagement+'%</strong></div>'
    +'<div class="engagement-bar" style="height:4px;"><div class="engagement-fill" style="width:'+ew+'%;"></div></div></div>'
    +tagsHtml
    +'<div class="modal-cta"><button class="btn-primary" onclick="alert(\'실제 서비스에서는 협업 문의 기능이 제공됩니다.\')">📩 협업 문의</button>'+igLink+'</div>'
    +'</div>';
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); document.body.style.overflow = ''; }

// ────────────────────────────────────────────────────────────
// API PANEL & CRAWL CONTROL
// ────────────────────────────────────────────────────────────
function openApiPanel() { document.getElementById('apiPanel').classList.add('open'); }
function closeApiPanel() { document.getElementById('apiPanel').classList.remove('open'); }

function setDataSource(mode) {
  const badge = document.getElementById('dataSourceBadge');
  if (!badge) return;
  const dot  = badge.querySelector('.ds-dot');
  const text = badge.querySelector('.ds-text');
  if (mode === 'live')    { dot.className='ds-dot live';    text.textContent='실시간 DB'; }
  else if (mode==='loading'){ dot.className='ds-dot loading'; text.textContent='수집 중...'; }
  else if (mode==='crawling'){ dot.className='ds-dot loading'; text.textContent='크롤링 중...'; }
  else                    { dot.className='ds-dot mock';    text.textContent='목업 데이터'; }
}

function showApiResult(type, msg) {
  const el = document.getElementById('apiResultInfo');
  if (!el) return;
  el.className = 'api-result-info ' + (type||'');
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = msg;
}

// 크롤링 시작 (무료 버전 — 토큰 불필요)
async function startCrawl() {
  const useNamu   = document.getElementById('useNamuCheck')?.checked !== false;
  const useHype   = document.getElementById('useHypeCheck')?.checked !== false;
  const useGoogle = document.getElementById('useGoogleCheck')?.checked === true;
  const maxWiki   = parseInt(document.getElementById('maxWikiPagesInput')?.value) || 600;

  if (!useNamu && !useHype) {
    showApiResult('err', '⚠️ 최소 1개 소스를 선택하세요.');
    return;
  }

  // 서버 연결 확인
  try {
    await fetch(SERVER_URL + '/api/stats', { signal: AbortSignal.timeout(2000) });
  } catch(e) {
    showApiResult('err', '❌ 서버에 연결할 수 없습니다.\n\n실행 방법:\n  npm install\n  node server.js');
    return;
  }

  // 파이프라인 시작
  try {
    const res = await fetch(SERVER_URL + '/api/crawl/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useNamu, useHype, useGoogle, maxWikiPages: maxWiki })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }

    setDataSource('crawling');
    let msg = '✅ 무료 수집 파이프라인 시작!\n\n';
    if (useHype) msg += '📊 SOURCE B: HypeAuditor 한국 랭킹 파싱 중...\n';
    if (useNamu) msg += '📖 SOURCE A: 나무위키 분류 → 인물 문서 파싱 중...\n';
    if (useGoogle) msg += '🔎 SOURCE C: 구글 검색 보완 활성화\n';
    msg += '\n아래 실시간 로그를 확인하세요.';
    showApiResult('ok', msg);
    document.getElementById('crawlStartBtn').disabled = true;
    document.getElementById('crawlStopBtn').disabled  = false;
    startCrawlPolling();
  } catch(e) {
    showApiResult('err', '❌ 시작 실패: ' + e.message);
  }
}

// 크롤링 중단
async function stopCrawl() {
  try {
    await fetch(SERVER_URL + '/api/crawl/stop', { method: 'POST' });
    showApiResult('ok', '⏹ 크롤링 중단 요청을 보냈습니다.');
    stopCrawlPolling();
    document.getElementById('crawlStartBtn').disabled = false;
    document.getElementById('crawlStopBtn').disabled  = true;
  } catch(e) {}
}

// 크롤링 상태 폴링
function startCrawlPolling() {
  stopCrawlPolling();
  crawlPollTimer = setInterval(pollCrawlStatus, 3000);
  pollCrawlStatus();
}
function stopCrawlPolling() {
  if (crawlPollTimer) { clearInterval(crawlPollTimer); crawlPollTimer = null; }
}

async function pollCrawlStatus() {
  try {
    const res  = await fetch(SERVER_URL + '/api/crawl/status');
    const data = await res.json();
    updateCrawlUI(data);
    if (!data.running && data.phase === 'done') {
      stopCrawlPolling();
      document.getElementById('crawlStartBtn').disabled = false;
      document.getElementById('crawlStopBtn').disabled  = true;
      setDataSource('live');
      usingServer = true;
      renderGrid();
      showApiResult('ok', '🎉 크롤링 완료!\n총 '+data.dbCount.toLocaleString()+'개 인플루언서가 DB에 저장되었습니다.\n검색창에서 바로 조회할 수 있습니다.');
    }
  } catch(e) {}
}

function updateCrawlUI(data) {
  const bar = document.getElementById('progressBarFill');
  const log = document.getElementById('progressLog');
  const logBox = document.getElementById('crawlLogBox');
  const stat   = document.getElementById('crawlStatLine');

  if (bar) bar.style.width = (data.progress||0) + '%';
  if (log) log.textContent = phaseLabel(data.phase) + (data.progress ? ' ' + data.progress + '%' : '');
  if (stat) stat.textContent = 'DB: ' + (data.dbCount||0).toLocaleString() + '개 | 대기열: ' + (data.queueCount||0).toLocaleString() + '개 | 수집: ' + (data.collected||0).toLocaleString() + '개';
  if (logBox && data.log) logBox.textContent = data.log.join('\n');
}

function phaseLabel(phase) {
  return { starting:'시작 중', hashtags:'Phase 1 — 해시태그 수집', profiles:'Phase 2 — 프로필 수집', network:'Phase 3 — 네트워크 확장', done:'완료', error:'오류' }[phase] || (phase||'');
}

// 서버 DB 조회 (수동)
async function loadFromServer() {
  const ok = await checkServer();
  if (!ok) { showApiResult('err', '❌ 서버에 연결할 수 없습니다.\n\nnpm install 후 node server.js 를 실행하세요.'); return; }
  usingServer = true;
  await renderGrid();
  showApiResult('ok', '✅ 서버 DB에서 ' + state.total.toLocaleString() + '개 인플루언서를 불러왔습니다.');
}

// 목업으로 복원
function resetToMock() {
  usingServer = false; setDataSource('mock');
  document.getElementById('totalCount').textContent = MOCK_INFLUENCERS.length;
  state.search=''; state.category='all'; state.tier='all'; state.sort='followers_desc';
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('.filter-tab[data-category="all"]').classList.add('active');
  renderGrid();
  showApiResult('ok', '✅ 목업 데이터로 초기화했습니다.');
}

// ────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  // 서버 연결 시도
  const serverUp = await checkServer();
  if (serverUp) { usingServer = true; }

  document.getElementById('totalCount').textContent = MOCK_INFLUENCERS.length;
  renderGrid();

  // Search
  let searchTimer = null;
  document.getElementById('searchInput').addEventListener('input', function(e) {
    state.search = e.target.value;
    document.getElementById('searchClear').classList.toggle('visible', state.search.length>0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, usingServer ? 400 : 0);
  });
  document.getElementById('searchClear').addEventListener('click', function() {
    document.getElementById('searchInput').value = ''; state.search = '';
    document.getElementById('searchClear').classList.remove('visible');
    document.getElementById('searchInput').focus(); renderGrid();
  });

  // Category tabs
  document.getElementById('categoryTabs').addEventListener('click', function(e) {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active'); state.category = tab.dataset.category; renderGrid();
  });

  document.getElementById('sortSelect').addEventListener('change', function(e){ state.sort=e.target.value; renderGrid(); });
  document.getElementById('tierSelect').addEventListener('change', function(e){ state.tier=e.target.value; renderGrid(); });

  // Modal
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e){
    if (e.target===document.getElementById('modalOverlay')) closeModal();
  });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape'){closeModal();closeApiPanel();} });

  // API Panel
  document.getElementById('apiSettingsBtn').addEventListener('click', openApiPanel);
  document.getElementById('apiPanelClose').addEventListener('click', closeApiPanel);

  // Crawl buttons
  document.getElementById('crawlStartBtn').addEventListener('click', startCrawl);
  document.getElementById('crawlStopBtn').addEventListener('click', stopCrawl);
  document.getElementById('loadServerBtn').addEventListener('click', loadFromServer);
  document.getElementById('apiMockBtn').addEventListener('click', resetToMock);
});
