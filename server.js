/**
 * ============================================================
 * INFL KR — 무료 웹 스크래핑 파이프라인 v4.0
 * ============================================================
 * 비용: 완전 무료 (외부 유료 API 없음)
 *
 * [수집 소스]
 *
 *  SOURCE A — 나무위키 인스타그램 인플루언서 분류
 *  ┌──────────────────────────────────────────────────────┐
 *  │  분류 페이지 파싱 → 인물 이름 목록 (~1,600명)          │
 *  │       ↓                                              │
 *  │  각 인물 문서 파싱 → Instagram 아이디/링크 추출        │
 *  └──────────────────────────────────────────────────────┘
 *
 *  SOURCE B — HypeAuditor 한국 Instagram 카테고리별 랭킹
 *  ┌──────────────────────────────────────────────────────┐
 *  │  /top-instagram-{category}-south-korea/ 페이지        │
 *  │  HTML 파싱 → username, 팔로워, 참여율, 카테고리 추출   │
 *  └──────────────────────────────────────────────────────┘
 *
 *  두 소스 결과를 SQLite DB에 병합 → REST API 제공
 *  프론트엔드(index.html)에서 실시간 조회
 *
 * 실행: node server.js
 * ============================================================
 */

const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const { URL }  = require('url');

const app  = express();
const PORT = 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────────────────────
const db = new Database('influencers.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS influencers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    full_name    TEXT,
    category     TEXT DEFAULT '라이프스타일',
    followers    INTEGER DEFAULT 0,
    following    INTEGER DEFAULT 0,
    posts        INTEGER DEFAULT 0,
    engagement   REAL DEFAULT 0,
    tier         TEXT DEFAULT '나노',
    location     TEXT DEFAULT '한국',
    bio          TEXT DEFAULT '',
    tags         TEXT DEFAULT '[]',
    avatar_url   TEXT,
    cover_url    TEXT,
    verified     INTEGER DEFAULT 0,
    avg_likes    INTEGER DEFAULT 0,
    avg_comments INTEGER DEFAULT 0,
    profile_url  TEXT,
    source       TEXT,
    scraped_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS wiki_queue (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT,
    wiki_url  TEXT UNIQUE,
    done      INTEGER DEFAULT 0,
    username  TEXT
  );
`);

// ─────────────────────────────────────────────────────────────
// CRAWL STATE
// ─────────────────────────────────────────────────────────────
let crawlState = {
  running: false, phase: null, progress: 0,
  total: 0, done: 0, collected: 0, log: [], errors: []
};

function log(msg) {
  const ts   = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  crawlState.log.push(line);
  if (crawlState.log.length > 400) crawlState.log.shift();
}

// ─────────────────────────────────────────────────────────────
// HTTP FETCH (Node 내장, node-fetch 불필요)
// ─────────────────────────────────────────────────────────────
function httpGet(urlStr, extraHeaders = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'GET',
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        ...extraHeaders
      }
    };
    const req = lib.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, extraHeaders, timeoutMs).then(resolve).catch(reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function calcTier(f) {
  if (f >= 1_000_000) return '메가';
  if (f >= 100_000)   return '매크로';
  if (f >= 10_000)    return '마이크로';
  return '나노';
}

function inferCategory(text = '') {
  const t = text.toLowerCase();
  const rules = [
    ['뷰티',         ['뷰티','beauty','makeup','메이크업','스킨케어','skincare','화장','cosmetic','glow','glam']],
    ['패션',         ['패션','fashion','ootd','옷','스타일','style','outfit','코디','closet']],
    ['음식',         ['맛집','먹방','food','recipe','레시피','요리','음식','chef','eat','cook','baking','cafe','카페','mukbang']],
    ['여행',         ['여행','travel','trip','backpack','vacation','tour','세계일주']],
    ['피트니스',     ['헬스','fitness','운동','workout','diet','다이어트','요가','yoga','pilates','필라테스','gym','pt']],
    ['게임',         ['게임','game','gaming','gamer','streamer','스트리머','fps','lol','롤','twitch']],
    ['육아',         ['육아','baby','아기','엄마','mom','parenting','아이','kid','child','출산']],
  ];
  for (const [cat, kws] of rules)
    if (kws.some(kw => t.includes(kw))) return cat;
  return '라이프스타일';
}

function catGradient(cat) {
  return ({
    뷰티:"linear-gradient(135deg,#ff6b9d,#c44dff)",
    패션:"linear-gradient(135deg,#667eea,#764ba2)",
    음식:"linear-gradient(135deg,#f093fb,#f5576c)",
    여행:"linear-gradient(135deg,#4facfe,#00f2fe)",
    피트니스:"linear-gradient(135deg,#43e97b,#38f9d7)",
    게임:"linear-gradient(135deg,#1a1a2e,#0f3460)",
    육아:"linear-gradient(135deg,#ffecd2,#fcb69f)",
    라이프스타일:"linear-gradient(135deg,#a8edea,#fed6e3)"
  })[cat] || "linear-gradient(135deg,#667eea,#764ba2)";
}

const upsertRow = db.prepare(`
  INSERT INTO influencers
    (username,full_name,category,followers,engagement,tier,profile_url,source,scraped_at)
  VALUES
    (@username,@full_name,@category,@followers,@engagement,@tier,@profile_url,@source,@scraped_at)
  ON CONFLICT(username) DO UPDATE SET
    full_name  = COALESCE(excluded.full_name,  influencers.full_name),
    category   = CASE WHEN excluded.category != '라이프스타일' THEN excluded.category ELSE influencers.category END,
    followers  = CASE WHEN excluded.followers  > 0 THEN excluded.followers  ELSE influencers.followers  END,
    engagement = CASE WHEN excluded.engagement > 0 THEN excluded.engagement ELSE influencers.engagement END,
    tier       = CASE WHEN excluded.followers  > 0 THEN excluded.tier       ELSE influencers.tier       END,
    source     = excluded.source,
    scraped_at = excluded.scraped_at
`);

function upsertMany(rows) {
  db.transaction(rows => { for (const r of rows) upsertRow.run(r); })(rows);
}

// ─────────────────────────────────────────────────────────────
// SOURCE A: 나무위키
// ─────────────────────────────────────────────────────────────

// 나무위키 분류 페이지 URL
const NAMU_CATEGORIES = [
  // 여성 인스타그램 인플루언서 (~1,173명)
  'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EC%97%AC%EC%84%B1%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
  // 남성 인스타그램 인플루언서 (~395명)
  'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EB%82%A8%EC%84%B1%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
  // 커플
  'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EC%BB%A4%ED%94%8C%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
];

// 나무위키 분류 페이지에서 인물 링크 추출
async function fetchNamuCategory(url) {
  const res = await httpGet(url, { Referer: 'https://namu.wiki/' });
  if (res.status !== 200) throw new Error(`나무위키 ${res.status}`);

  const links = [];
  // 분류 페이지 링크 패턴: href="/w/이름"
  const re = /href="\/w\/([^"#?]+)"[^>]*>([^<]{2,30})<\/a>/g;
  let m;
  const skip = new Set(['분류', '나무위키', '이전', '다음', '인플루언서', '인스타그램', '커플', '여성', '남성', '대한민국']);
  while ((m = re.exec(res.body)) !== null) {
    const encoded     = m[1];
    const displayName = m[2].trim();
    if (skip.has(displayName)) continue;
    if (encoded.startsWith('%EB%B6%84%EB%A5%98')) continue;  // 분류: prefix
    if (encoded.includes(':')) continue;
    if (/^\d+$/.test(displayName)) continue;
    links.push({ name: displayName, wikiUrl: `https://namu.wiki/w/${encoded}` });
  }
  return links;
}

// 나무위키 인물 문서에서 Instagram 아이디 추출
async function extractIGFromWiki(wikiUrl, personName) {
  const res = await httpGet(wikiUrl, { Referer: 'https://namu.wiki/' });
  if (res.status !== 200) return null;

  const patterns = [
    /instagram\.com\/([a-zA-Z0-9_.]{3,30})(?:["'\/?\s]|$)/gi,
    /인스타(?:그램)?[^:：]*[:：]\s*@?([a-zA-Z0-9_.]{3,30})/gi,
    /ig\s*[:：]\s*@?([a-zA-Z0-9_.]{3,30})/gi,
  ];

  const RESERVED = new Set(['p','reel','reels','explore','stories','accounts','help','about','legal','privacy','www','tv','direct','ar','pk']);
  const found = new Set();

  for (const p of patterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(res.body)) !== null) {
      const u = m[1].toLowerCase().replace(/['")\s.,]+$/, '');
      if (u.length >= 3 && !RESERVED.has(u) && !/^\d+$/.test(u)) found.add(u);
    }
  }

  if (found.size === 0) return null;

  // 이름과 가장 유사한 아이디 선택
  const nameSimple = personName.toLowerCase().replace(/[^a-z가-힣0-9]/g, '');
  const scored = [...found].map(u => {
    let score = 0;
    const uc = u.replace(/[_\.]/g, '');
    if (uc.includes(nameSimple.slice(0, 3))) score += 2;
    if (uc === nameSimple) score += 10;
    if (u.includes('_') || u.includes('.')) score += 1; // 흔한 패턴
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].u;
}

// Step A1: 분류 페이지 파싱
async function stepA_collectNames() {
  log('[SOURCE A] 나무위키 분류 페이지 수집 시작');
  crawlState.phase = 'namu_categories';

  const insert = db.prepare('INSERT OR IGNORE INTO wiki_queue (name, wiki_url) VALUES (?, ?)');
  let total = 0;

  for (const url of NAMU_CATEGORIES) {
    if (!crawlState.running) break;
    try {
      const links = await fetchNamuCategory(url);
      db.transaction(() => { for (const { name, wikiUrl } of links) insert.run(name, wikiUrl); })();
      total += links.length;
      log(`  분류 완료: ${links.length}명 추가`);
    } catch (e) {
      log(`  ⚠️  분류 페이지 오류: ${e.message}`);
    }
    await sleep(2500);
  }

  const queued = db.prepare('SELECT COUNT(*) as c FROM wiki_queue').get().c;
  log(`[SOURCE A-1 완료] 총 ${queued}명이 대기열에 추가됨`);
  return queued;
}

// Step A2: 인물 문서 → Instagram 아이디 추출
async function stepA_extractIDs(maxPages = 600) {
  const rows = db.prepare('SELECT id, name, wiki_url FROM wiki_queue WHERE done=0 LIMIT ?').all(maxPages);
  if (!rows.length) { log('[SOURCE A-2] 대기열 없음'); return 0; }

  log(`[SOURCE A-2] ${rows.length}개 문서에서 Instagram 아이디 추출 시작`);
  crawlState.phase = 'wiki_pages';
  crawlState.total = rows.length;
  crawlState.done  = 0;

  const markDone = db.prepare('UPDATE wiki_queue SET done=1, username=? WHERE id=?');
  const addIG    = db.prepare(`
    INSERT OR IGNORE INTO influencers (username, full_name, profile_url, source, scraped_at)
    VALUES (?, ?, ?, 'namu_wiki', ?)
  `);

  let found = 0;
  for (const row of rows) {
    if (!crawlState.running) break;
    try {
      const username = await extractIGFromWiki(row.wiki_url, row.name);
      if (username) {
        addIG.run(username, row.name, `https://instagram.com/${username}`, new Date().toISOString());
        markDone.run(username, row.id);
        found++;
        log(`  ✓ @${username}  ←  ${row.name}`);
      } else {
        markDone.run(null, row.id);
        log(`  - ${row.name}: Instagram 아이디 없음`);
      }
    } catch (e) {
      markDone.run(null, row.id);
    }
    crawlState.done++;
    crawlState.progress = 10 + Math.round((crawlState.done / crawlState.total) * 35);
    await sleep(900 + Math.random() * 600);
  }

  log(`[SOURCE A-2 완료] ${found}개 Instagram 아이디 발굴`);
  return found;
}

// ─────────────────────────────────────────────────────────────
// SOURCE B: HypeAuditor 카테고리별 한국 Top 랭킹 파싱
// ─────────────────────────────────────────────────────────────

// HypeAuditor 한국 인스타 카테고리별 랭킹 페이지
// (로그인 없이 HTML로 제공되며 username, 팔로워, 참여율 등이 포함됨)
const HYPE_CATEGORY_URLS = [
  { url: 'https://hypeauditor.com/top-instagram-all-south-korea/',             category: '라이프스타일' },
  { url: 'https://hypeauditor.com/top-instagram-beauty-south-korea/',          category: '뷰티' },
  { url: 'https://hypeauditor.com/top-instagram-fashion-south-korea/',         category: '패션' },
  { url: 'https://hypeauditor.com/top-instagram-food-south-korea/',            category: '음식' },
  { url: 'https://hypeauditor.com/top-instagram-travel-south-korea/',          category: '여행' },
  { url: 'https://hypeauditor.com/top-instagram-sports-south-korea/',          category: '피트니스' },
  { url: 'https://hypeauditor.com/top-instagram-games-south-korea/',           category: '게임' },
  { url: 'https://hypeauditor.com/top-instagram-family-south-korea/',          category: '육아' },
  { url: 'https://hypeauditor.com/top-instagram-modeling-south-korea/',        category: '패션' },
  { url: 'https://hypeauditor.com/top-instagram-fitness-south-korea/',         category: '피트니스' },
];

function parseHypeAuditorPage(html, defaultCategory) {
  const results = [];

  // HypeAuditor는 SSR 페이지에 JSON 데이터를 __NUXT__ 또는 window.__INITIAL_STATE__ 등에 포함
  // username 패턴: "username":"someuser" 또는 href="/top-instagram/someuser"
  // 방법 1: JSON 내 username 필드
  const jsonPattern = /"username"\s*:\s*"([a-zA-Z0-9_.]{3,30})"/g;
  const followerPattern = /"subscribers_count"\s*:\s*(\d+)/g;
  const erPattern = /"er"\s*:\s*([\d.]+)/g;

  const usernames  = [];
  const followers  = [];
  const ers        = [];

  let m;
  while ((m = jsonPattern.exec(html))   !== null) usernames.push(m[1]);
  while ((m = followerPattern.exec(html)) !== null) followers.push(parseInt(m[1]));
  while ((m = erPattern.exec(html))     !== null) ers.push(parseFloat(m[1]));

  // 방법 2: href 패턴 (백업)
  if (usernames.length === 0) {
    const hrefPat = /href="\/[^"]*\/([a-zA-Z0-9_.]{3,30})\/?"/g;
    const RESERVED = new Set(['top-instagram','top-tiktok','top-youtube','login','signup','pricing','blog','free-tools','discovery','reports','recruitment']);
    while ((m = hrefPat.exec(html)) !== null) {
      const u = m[1];
      if (!RESERVED.has(u) && !/^\d+$/.test(u)) usernames.push(u);
    }
  }

  // 중복 제거 후 매핑
  const seen = new Set();
  for (let i = 0; i < usernames.length; i++) {
    const u = usernames[i];
    if (seen.has(u)) continue;
    seen.add(u);

    const followerCount = followers[i] || 0;
    const er            = ers[i] || 0;

    results.push({
      username:    u,
      full_name:   null,
      category:    defaultCategory,
      followers:   followerCount,
      engagement:  er,
      tier:        calcTier(followerCount),
      profile_url: `https://instagram.com/${u}`,
      source:      'hypeauditor',
      scraped_at:  new Date().toISOString()
    });
  }

  return results;
}

async function stepB_hypeAuditor() {
  log('[SOURCE B] HypeAuditor 한국 Instagram 랭킹 수집 시작');
  crawlState.phase = 'hypeauditor';

  let totalAdded = 0;

  for (const { url, category } of HYPE_CATEGORY_URLS) {
    if (!crawlState.running) break;
    log(`  페이지 요청: ${category} — ${url}`);

    try {
      const res = await httpGet(url, {
        Referer:        'https://hypeauditor.com/',
        'Cache-Control': 'no-cache',
      });

      if (res.status !== 200) {
        log(`  ⚠️  ${category}: HTTP ${res.status} — 건너뜀`);
        await sleep(2000);
        continue;
      }

      const parsed = parseHypeAuditorPage(res.body, category);

      if (parsed.length === 0) {
        log(`  ⚠️  ${category}: username 파싱 실패 (JS 렌더링 필요할 수 있음)`);
      } else {
        upsertMany(parsed);
        totalAdded += parsed.length;
        log(`  ✓ ${category}: ${parsed.length}개 추가 (누적: ${totalAdded})`);
      }
    } catch (e) {
      log(`  ⚠️  ${category} 오류: ${e.message}`);
    }

    await sleep(3000 + Math.random() * 2000);
  }

  log(`[SOURCE B 완료] HypeAuditor에서 ${totalAdded}개 수집`);
  return totalAdded;
}

// ─────────────────────────────────────────────────────────────
// SOURCE C: 구글 검색으로 아이디 보완
// (나무위키에서 아이디를 못 찾은 인물들을 구글 검색으로 보완)
// ─────────────────────────────────────────────────────────────
async function stepC_googleSearch(maxItems = 50) {
  // Instagram 아이디를 못 찾은 인물들
  const pending = db.prepare(`
    SELECT name FROM wiki_queue
    WHERE done=1 AND username IS NULL
    LIMIT ?
  `).all(maxItems);

  if (!pending.length) { log('[SOURCE C] 보완할 항목 없음'); return 0; }

  log(`[SOURCE C] 구글 검색으로 ${pending.length}명 Instagram 아이디 보완 시도`);
  crawlState.phase = 'google_search';

  const addIG = db.prepare(`
    INSERT OR IGNORE INTO influencers (username, full_name, profile_url, source, scraped_at)
    VALUES (?, ?, ?, 'google_search', ?)
  `);
  const markUsername = db.prepare(`UPDATE wiki_queue SET username=? WHERE name=?`);

  let found = 0;
  for (const { name } of pending) {
    if (!crawlState.running) break;
    try {
      // 구글 검색: "{이름} 인스타그램" 검색 결과 HTML에서 instagram.com/{id} 추출
      const query = encodeURIComponent(`${name} 인스타그램 instagram.com`);
      const searchUrl = `https://www.google.com/search?q=${query}&num=5`;
      const res = await httpGet(searchUrl, {
        Referer: 'https://www.google.com/',
        Accept:  'text/html'
      });

      if (res.status !== 200) continue;

      // 구글 결과에서 instagram.com/{username} 추출
      const re = /instagram\.com\/([a-zA-Z0-9_.]{3,30})(?:[\/?"']|$)/gi;
      const SKIP = new Set(['p','reel','reels','explore','stories','accounts','help','www','tv']);
      const candidates = new Set();
      let m;
      while ((m = re.exec(res.body)) !== null) {
        const u = m[1];
        if (!SKIP.has(u) && !/^\d+$/.test(u)) candidates.add(u);
      }

      if (candidates.size > 0) {
        const u = [...candidates][0]; // 첫 번째 결과 사용
        addIG.run(u, name, `https://instagram.com/${u}`, new Date().toISOString());
        markUsername.run(u, name);
        found++;
        log(`  ✓ 구글 검색: ${name} → @${u}`);
      }
    } catch (e) {}
    await sleep(1500 + Math.random() * 1000); // 구글 봇 감지 방지
  }

  log(`[SOURCE C 완료] ${found}명 추가 발굴`);
  return found;
}

// ─────────────────────────────────────────────────────────────
// MASTER PIPELINE
// ─────────────────────────────────────────────────────────────
async function startPipeline(options = {}) {
  if (crawlState.running) throw new Error('이미 실행 중');

  const {
    useNamu      = true,
    useHype      = true,
    useGoogle    = false,   // 구글 검색은 기본 OFF (요청 제한 있음)
    maxWikiPages = 600,     // 나무위키 문서 최대 처리 수
  } = options;

  crawlState = { running:true, phase:'starting', progress:0, total:0, done:0, collected:0, log:[], errors:[] };
  log('=== INFL KR 무료 수집 파이프라인 시작 ===');

  try {
    // SOURCE B: HypeAuditor (빠름, 먼저 실행)
    if (useHype) {
      await stepB_hypeAuditor();
      crawlState.progress = 20;
    }

    // SOURCE A: 나무위키 (느리지만 더 포괄적)
    if (useNamu) {
      await stepA_collectNames();
      crawlState.progress = 35;

      await stepA_extractIDs(maxWikiPages);
      crawlState.progress = 80;
    }

    // SOURCE C: 구글 보완 (선택적)
    if (useGoogle) {
      await stepC_googleSearch(50);
    }

    crawlState.phase    = 'done';
    crawlState.progress = 100;
    crawlState.running  = false;

    const total = db.prepare('SELECT COUNT(*) as c FROM influencers').get().c;
    log(`\n=== 완료 === 총 ${total}명 수집`);
  } catch (err) {
    crawlState.running = false;
    crawlState.phase   = 'error';
    log(`[오류] ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT ROW
// ─────────────────────────────────────────────────────────────
function formatRow(r) {
  let tags = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch (e) {}
  return {
    id:          r.id,
    name:        r.full_name || r.username,
    handle:      `@${r.username}`,
    category:    r.category || '라이프스타일',
    followers:   r.followers || 0,
    following:   r.following || 0,
    posts:       r.posts     || 0,
    engagement:  r.engagement || 0,
    tier:        r.tier || calcTier(r.followers || 0),
    location:    r.location   || '한국',
    bio:         r.bio        || '',
    tags,
    avatar:      null,
    avatarUrl:   r.avatar_url || null,
    coverColor:  catGradient(r.category),
    coverUrl:    r.cover_url  || null,
    verified:    !!r.verified,
    avgLikes:    r.avg_likes  || 0,
    avgComments: r.avg_comments || 0,
    profileUrl:  r.profile_url || `https://instagram.com/${r.username}`,
    source:      r.source,
    isLive:      true
  };
}

// ─────────────────────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────────────────────
app.get('/api/influencers', (req, res) => {
  const { q='', category='all', tier='all', sort='followers_desc', limit=200, offset=0, min_followers=0 } = req.query;

  let where  = ['followers >= ?'];
  let params = [parseInt(min_followers)];
  if (q) {
    where.push('(username LIKE ? OR full_name LIKE ? OR bio LIKE ? OR category LIKE ?)');
    const l = `%${q}%`;
    params.push(l, l, l, l);
  }
  if (category !== 'all') { where.push('category=?');  params.push(category); }
  if (tier     !== 'all') { where.push('tier=?');       params.push(tier); }

  const order = { followers_desc:'followers DESC', followers_asc:'followers ASC', engagement_desc:'engagement DESC', name_asc:'full_name ASC' }[sort] || 'followers DESC';
  const w     = 'WHERE ' + where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as c FROM influencers ${w}`).get(...params).c;
  const rows  = db.prepare(`SELECT * FROM influencers ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset));

  res.json({ total, data: rows.map(formatRow) });
});

app.get('/api/stats', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) as c FROM influencers').get().c;
  const byTier  = db.prepare('SELECT tier, COUNT(*) as c FROM influencers WHERE tier IS NOT NULL GROUP BY tier').all();
  const byCat   = db.prepare('SELECT category, COUNT(*) as c FROM influencers GROUP BY category ORDER BY c DESC').all();
  const queue   = db.prepare('SELECT COUNT(*) as c FROM wiki_queue WHERE done=0').get().c;
  res.json({ total, byTier, byCategory: byCat, queuePending: queue });
});

app.post('/api/crawl/start', (req, res) => {
  if (crawlState.running) return res.status(409).json({ error: '이미 실행 중' });
  const opts = {
    useNamu:      req.body.useNamu      !== false,
    useHype:      req.body.useHype      !== false,
    useGoogle:    req.body.useGoogle    === true,
    maxWikiPages: req.body.maxWikiPages || 600,
  };
  startPipeline(opts).catch(console.error);
  res.json({ success: true, options: opts });
});

app.post('/api/crawl/stop', (_req, res) => {
  crawlState.running = false;
  res.json({ success: true });
});

app.get('/api/crawl/status', (_req, res) => {
  const dbCount    = db.prepare('SELECT COUNT(*) as c FROM influencers').get().c;
  const queueCount = db.prepare('SELECT COUNT(*) as c FROM wiki_queue WHERE done=0').get().c;
  res.json({ ...crawlState, dbCount, queueCount, log: crawlState.log.slice(-60) });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  INFL KR 무료 스크래핑 서버 — http://localhost:${PORT}  ║
╠══════════════════════════════════════════════════╣
║  SOURCE A: 나무위키 (이름→Instagram 아이디 추출)   ║
║  SOURCE B: HypeAuditor 한국 랭킹 파싱             ║
║  SOURCE C: 구글 검색 보완 (선택적)                ║
║  비용: 완전 무료 ✅                               ║
╚══════════════════════════════════════════════════╝
`);
});
