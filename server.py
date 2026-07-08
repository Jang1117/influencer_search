"""
============================================================
INFL KR — 한국 인스타그램 인플루언서 수집 서버 v5.0
============================================================
Node.js 불필요 / 외부 유료 API 없음 / 완전 무료

[수집 소스]
  SOURCE A: HypeAuditor 한국 카테고리별 Top 랭킹
            -> username, 이름, 팔로워, 카테고리 파싱
  SOURCE B: 나무위키 인스타그램 인플루언서 분류
            -> 아이디 보충 수집

[필요 패키지]
  pip install flask flask-cors requests

[실행]
  python server.py
  -> 브라우저에서 index.html 열기
============================================================
"""

import sqlite3, json, re, time, threading, subprocess, sys, os
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import requests as req_lib

# ── Selenium (JS 렌더링 필수) ─────────────────────────────────
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_OK = True
except ImportError:
    SELENIUM_OK = False

app = Flask(__name__, static_folder='.')
CORS(app)

DB_PATH = 'influencers.db'
PORT    = 3001

# HTTP 세션 (나무위키용 일반 requests)
SESSION = req_lib.Session()
SESSION.headers.update({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
})

def http_get(url, extra_headers=None, timeout=15):
    # 일반 HTTP GET (정적 페이지용 - 나무위키 등)
    try:
        r = SESSION.get(url, headers=extra_headers or {}, timeout=timeout, allow_redirects=True)
        return r.status_code, r.text
    except Exception as e:
        raise Exception(f'HTTP 오류: {e}')

# Selenium 브라우저 (JS 렌더링 페이지용 - HypeAuditor)
_driver = None

def get_driver():
    # Chrome WebDriver 싱글톤. 없으면 생성.
    global _driver
    if _driver is not None:
        try:
            _ = _driver.title
            return _driver
        except:
            _driver = None

    if not SELENIUM_OK:
        raise Exception('selenium 미설치: pip install selenium')

    opts = Options()
    opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--window-size=1920,1080')
    opts.add_argument('--lang=ko-KR')
    opts.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
    opts.add_experimental_option('prefs', {'profile.managed_default_content_settings.images': 2})
    opts.add_experimental_option('excludeSwitches', ['enable-logging'])

    try:
        _driver = webdriver.Chrome(options=opts)
        log('  [브라우저] Chrome 헤드리스 시작 완료')
        return _driver
    except Exception as e:
        log(f'  [브라우저] Chrome 시작 실패: {e}')
        raise Exception(f'ChromeDriver 오류: {e}')

def browser_get(url, wait_sec=7):
    # Selenium으로 JS 렌더링된 페이지 텍스트 반환
    driver = get_driver()
    try:
        driver.get(url)
        # 인플루언서 데이터 행이 나타날 때까지 대기
        # HypeAuditor: 팔로워 숫자(M/K 단위)가 포함된 행 대기
        try:
            WebDriverWait(driver, wait_sec).until(
                lambda d: any(x in d.find_element(By.TAG_NAME, 'body').text
                              for x in ['M\n', 'K\n', '.M', '.K'])
            )
        except:
            pass  # 타임아웃이어도 현재 상태 반환
        time.sleep(1.5)
        return driver.find_element(By.TAG_NAME, 'body').text
    except Exception as e:
        try:
            return driver.find_element(By.TAG_NAME, 'body').text
        except:
            raise Exception(f'브라우저 로딩 실패: {e}')

def close_driver():
    global _driver
    if _driver:
        try: _driver.quit()
        except: pass
        _driver = None

# ── DATABASE ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS influencers (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            username     TEXT UNIQUE NOT NULL,
            full_name    TEXT,
            category     TEXT DEFAULT '라이프스타일',
            categories   TEXT DEFAULT '[]',
            followers    INTEGER DEFAULT 0,
            following    INTEGER DEFAULT 0,
            posts        INTEGER DEFAULT 0,
            engagement   REAL DEFAULT 0,
            tier         TEXT DEFAULT '나노',
            location     TEXT DEFAULT '한국',
            bio          TEXT DEFAULT '',
            tags         TEXT DEFAULT '[]',
            avatar_url   TEXT,
            verified     INTEGER DEFAULT 0,
            avg_likes    INTEGER DEFAULT 0,
            avg_comments INTEGER DEFAULT 0,
            profile_url  TEXT,
            source       TEXT,
            scraped_at   TEXT
        );
        -- 기존 DB 호환: categories 컬럼 없으면 추가
        CREATE TABLE IF NOT EXISTS _dummy_migration (x INTEGER);
        CREATE TABLE IF NOT EXISTS wiki_queue (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT,
            wiki_url  TEXT UNIQUE,
            done      INTEGER DEFAULT 0,
            username  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_influencers_followers ON influencers(followers);
        CREATE INDEX IF NOT EXISTS idx_influencers_tier      ON influencers(tier);
        CREATE INDEX IF NOT EXISTS idx_influencers_category  ON influencers(category);
    """)
    conn.commit()
    # 기존 DB에 categories 컬럼 추가 (마이그레이션)
    try:
        conn.execute("ALTER TABLE influencers ADD COLUMN categories TEXT DEFAULT '[]'")
        conn.commit()
    except:
        pass  # 이미 있으면 무시
    # manually_edited=1 이면 재분류 시 건너뜀
    try:
        conn.execute("ALTER TABLE influencers ADD COLUMN manually_edited INTEGER DEFAULT 0")
        conn.commit()
    except:
        pass
    conn.close()

# ── CRAWL STATE ───────────────────────────────────────────────
crawl_state = {
    'running': False, 'phase': None, 'progress': 0,
    'total': 0, 'done': 0, 'collected': 0, 'log': [], 'errors': []
}
state_lock = threading.Lock()

def log(msg):
    ts   = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with state_lock:
        crawl_state['log'].append(line)
        if len(crawl_state['log']) > 500:
            crawl_state['log'] = crawl_state['log'][-500:]

# ── HELPERS ───────────────────────────────────────────────────
def parse_followers_str(s):
    s = str(s).strip().replace(',','').replace(' ','')
    try:
        if s.endswith('M'): return int(float(s[:-1]) * 1_000_000)
        if s.endswith('K'): return int(float(s[:-1]) * 1_000)
        return int(float(s))
    except:
        return 0

def calc_tier(f):
    if f >= 1_000_000: return '메가'
    if f >= 100_000:   return '매크로'
    if f >= 10_000:    return '마이크로'
    return '나노'

def cat_gradient(cat):
    return {
        '뷰티':         'linear-gradient(135deg,#ff6b9d,#c44dff)',
        '패션':         'linear-gradient(135deg,#667eea,#764ba2)',
        '음식':         'linear-gradient(135deg,#f093fb,#f5576c)',
        '여행':         'linear-gradient(135deg,#4facfe,#00f2fe)',
        '피트니스':     'linear-gradient(135deg,#43e97b,#38f9d7)',
        '게임':         'linear-gradient(135deg,#1a1a2e,#0f3460)',
        '육아':         'linear-gradient(135deg,#ffecd2,#fcb69f)',
        '라이프스타일': 'linear-gradient(135deg,#a8edea,#fed6e3)',
        '아트/디자인':  'linear-gradient(135deg,#f7971e,#ffd200)',
        '사진':         'linear-gradient(135deg,#373b44,#4286f4)',
        '유머':         'linear-gradient(135deg,#f7ce68,#fbab7e)',
        '미디어/글쓰기':'linear-gradient(135deg,#b8cbb8,#b8a4a4)',
    }.get(cat, 'linear-gradient(135deg,#667eea,#764ba2)')

HYPE_CAT_MAP = [
    ('beauty',      '뷰티'),
    ('fashion',     '패션'),
    ('clothing',    '패션'),
    ('model',       '패션'),
    ('food',        '음식'),
    ('cooking',     '음식'),
    ('sweets',      '음식'),
    ('bakery',      '음식'),
    ('travel',      '여행'),
    ('nature',      '여행'),
    ('landscape',   '여행'),
    ('fitness',     '피트니스'),
    ('gym',         '피트니스'),
    ('trainer',     '피트니스'),
    ('gaming',      '게임'),
    ('game',        '게임'),
    ('family',      '육아'),
    ('kids',        '육아'),
    ('child',       '육아'),
    ('luxury',      '럭셔리'),
    ('shopping',    '쇼핑'),
    ('retail',      '쇼핑'),
    ('health',      '건강'),
    ('medicine',    '건강'),
    ('education',   '교육'),
    ('science',     '교육'),
    ('business',    '비즈니스'),
    ('career',      '비즈니스'),
    ('marketing',   '비즈니스'),
    ('management',  '비즈니스'),
    ('finance',     '금융'),
    ('economic',    '금융'),
    ('tech',        'IT/테크'),
    ('computer',    'IT/테크'),
    ('gadget',      'IT/테크'),
    ('mobile',      'IT/테크'),
    ('machine',     'IT/테크'),
    ('cinema',      '엔터테인먼트'),
    ('actor',       '엔터테인먼트'),
    ('actress',     '엔터테인먼트'),
    ('music',       '엔터테인먼트'),
    ('show',        '엔터테인먼트'),
    ('car',         '자동차'),
    ('motorbike',   '자동차'),
    ('racing',      '스포츠'),
    ('extreme',     '스포츠'),
    ('water sport', '스포츠'),
    ('winter sport','스포츠'),
    ('ball',        '스포츠'),
    # ('sport', '스포츠'),  # 너무 광범위 - racing/ball/extreme으로 대체
    ('animal',      '동물'),
    ('accessor',    '악세서리/주얼리'),
    ('jewel',       '악세서리/주얼리'),
    # 새 카테고리
    ('photo',       '사진'),
    ('art',         '아트/디자인'),
    ('design',      '아트/디자인'),
    ('architect',   '아트/디자인'),
    ('comic',       '아트/디자인'),
    ('sketch',      '아트/디자인'),
    ('diy',         '아트/디자인'),
    ('humor',       '유머'),
    ('fun',         '유머'),
    ('happin',      '유머'),
    ('literature',  '미디어/글쓰기'),
    ('journal',     '미디어/글쓰기'),
    ('writing',     '미디어/글쓰기'),
    ('blog',        '미디어/글쓰기'),
    ('lifestyle',   '라이프스타일'),
]
def hype_cat_to_kor(cat_str, default='라이프스타일'):
    if not cat_str: return default
    t = cat_str.lower()
    for key, val in HYPE_CAT_MAP:
        if key in t: return val
    return default

def merge_categories(existing_json, new_list):
    """기존 categories JSON 배열과 새 리스트를 합쳐 중복 제거 후 반환"""
    try:
        existing = json.loads(existing_json or '[]')
    except:
        existing = []
    merged = list(dict.fromkeys(existing + new_list))  # 순서 유지 + 중복 제거
    return json.dumps(merged, ensure_ascii=False)

def upsert_influencers(rows):
    if not rows: return
    import unicodedata
    conn = get_db()
    for row in rows:
        # full_name 정규화: NFC + 이모지/PUA 제거
        fn = row.get('full_name')
        if fn:
            row = dict(row); row['full_name'] = strip_name(fn)
        # categories 직렬화
        cats = row.get('categories', [])
        if isinstance(cats, list):
            cats_json = json.dumps(cats, ensure_ascii=False)
        else:
            cats_json = cats or '[]'

        # 주 카테고리 (첫 번째)
        primary_cat = cats[0] if cats else row.get('category', '라이프스타일')

        existing = conn.execute(
            'SELECT id, categories FROM influencers WHERE username=?', (row['username'],)
        ).fetchone()

        if existing:
            # 기존 categories와 병합
            merged_json = merge_categories(existing['categories'], cats)
            merged_cats = json.loads(merged_json)
            new_primary = merged_cats[0] if merged_cats else primary_cat

            conn.execute("""
                UPDATE influencers SET
                    full_name  = CASE WHEN ? IS NOT NULL AND ? != ''
                                      THEN ? ELSE full_name END,
                    avatar_url = CASE WHEN ? IS NOT NULL AND ? != ''
                                      THEN ? ELSE avatar_url END,
                    category   = ?,
                    categories = ?,
                    followers  = CASE WHEN ? > followers THEN ? ELSE followers END,
                    tier       = CASE WHEN ? > followers THEN ? ELSE tier END,
                    scraped_at = ?
                WHERE username = ?
            """, (
                row.get('full_name'), row.get('full_name'), row.get('full_name'),
                row.get('avatar_url'), row.get('avatar_url'), row.get('avatar_url'),
                new_primary, merged_json,
                row['followers'], row['followers'],
                row['followers'], row['tier'],
                row['scraped_at'],
                row['username']
            ))
        else:
            conn.execute("""
                INSERT INTO influencers
                    (username, full_name, category, categories, followers, tier,
                     avatar_url, profile_url, source, scraped_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row['username'], row.get('full_name'), primary_cat, cats_json,
                row['followers'], row['tier'], row.get('avatar_url'),
                row.get('profile_url', f'https://instagram.com/{row["username"]}'),
                row.get('source', 'hypeauditor'), row['scraped_at']
            ))
    conn.commit()
    conn.close()

# ── SOURCE A: HypeAuditor ─────────────────────────────────────
# ─── HypeAuditor 전체 카테고리 (악세서리 ~ 윈터스포츠) ────────
# 각 페이지 50위까지 공개. 404면 자동 skip.
BASE = 'https://hypeauditor.com/top-instagram-'
SK   = '-south-korea/'

HYPE_PAGES = [
    # A  (all 페이지 제거 - 카테고리 정보 없어 라이프스타일로만 몰림)
    (BASE + 'accessories-jewellery'            + SK, '악세서리/주얼리'),
    (BASE + 'alcohol'                          + SK, '라이프스타일'),
    (BASE + 'animals'                          + SK, '동물'),
    (BASE + 'architecture-urban-design'        + SK, '아트/디자인'),
    (BASE + 'art'                              + SK, '아트/디자인'),
    # B
    (BASE + 'beauty'                           + SK, '뷰티'),
    (BASE + 'business-careers'                 + SK, '비즈니스'),
    # C
    (BASE + 'cars-motorbikes'                  + SK, '자동차'),
    (BASE + 'cinema-actors-actresses'          + SK, '엔터테인먼트'),
    (BASE + 'clothing-outfits'                 + SK, '패션'),
    (BASE + 'comics-sketches'                  + SK, '아트/디자인'),
    (BASE + 'computers-gadgets'                + SK, 'IT/테크'),
    # D
    (BASE + 'diy-design'                       + SK, '아트/디자인'),
    # E
    (BASE + 'education'                        + SK, '교육'),
    (BASE + 'extreme-sports-outdoor-activity'  + SK, '스포츠'),
    # F
    (BASE + 'family'                           + SK, '육아'),
    (BASE + 'fashion'                          + SK, '패션'),
    (BASE + 'finance-economics'                + SK, '금융'),
    (BASE + 'fitness-gym'                      + SK, '피트니스'),
    (BASE + 'food-cooking'                     + SK, '음식'),
    # G
    (BASE + 'gaming'                           + SK, '게임'),
    # H
    (BASE + 'health-medicine'                  + SK, '건강'),
    (BASE + 'humor-fun-happiness'              + SK, '유머'),
    # K
    (BASE + 'kids-toys'                        + SK, '육아'),
    # L
    (BASE + 'lifestyle'                        + SK, '라이프스타일'),
    (BASE + 'literature-journalism'            + SK, '미디어/글쓰기'),
    (BASE + 'luxury'                           + SK, '럭셔리'),
    # M
    (BASE + 'machinery-technologies'           + SK, 'IT/테크'),
    (BASE + 'management-marketing'             + SK, '비즈니스'),
    (BASE + 'mobile-related'                   + SK, 'IT/테크'),
    (BASE + 'modeling'                         + SK, '패션'),
    (BASE + 'music'                            + SK, '엔터테인먼트'),
    # N
    (BASE + 'nature-landscapes'                + SK, '여행'),
    # P
    (BASE + 'photography'                      + SK, '사진'),
    # R
    (BASE + 'racing-sports'                    + SK, '스포츠'),
    # S
    (BASE + 'science'                          + SK, '교육'),
    (BASE + 'shopping-retail'                  + SK, '쇼핑'),
    (BASE + 'shows'                            + SK, '엔터테인먼트'),
    (BASE + 'sports-with-a-ball'               + SK, '스포츠'),
    (BASE + 'sweets-bakery'                    + SK, '음식'),
    # T
    (BASE + 'tobacco-smoking'                  + SK, '라이프스타일'),
    (BASE + 'trainers-coaches'                 + SK, '피트니스'),
    (BASE + 'travel'                           + SK, '여행'),
    # W
    (BASE + 'water-sports'                     + SK, '스포츠'),
    (BASE + 'winter-sports'                    + SK, '스포츠'),
]

HYPE_SKIP = {
    'preview','share','rank','influencer','category','followers','engagement',
    'eng','auth','avg','how','all','top','south','korea','countries','calculate',
    'following','music','lifestyle','cinema','sports','modeling','beauty','fashion',
}

def parse_hype_page(text, default_category):
    """
    Selenium body.text 형식 파싱.
    실제 HypeAuditor 렌더링 텍스트 구조:
      Rank  변동  username  이름  카테고리[·카테고리2]  팔로워M  engAuth  engAvg  Preview
    줄바꿈 기준으로 나뉘어져 있음.

    관찰된 실제 패턴 예시:
      1
      4
      dlwlrma        ← IG username (영문만)
      이지금 IU      ← 이름 (한글+영문 혼합)
      Art/Artists    ← 카테고리
      33.3M          ← 팔로워
      2.1M           ← eng auth
      1.9M           ← eng avg
      Preview
    """
    results = []
    now = datetime.now().isoformat()

    def parse_f(s):
        s = str(s).strip().replace(',', '').replace(' ', '')
        try:
            if s.endswith('M'): return int(float(s[:-1]) * 1_000_000)
            if s.endswith('K'): return int(float(s[:-1]) * 1_000)
            return int(float(s))
        except:
            return 0

    ig_re    = re.compile(r'^[a-zA-Z][a-zA-Z0-9_.]{2,29}$')
    fol_re   = re.compile(r'^\d+\.?\d*[MK]$')
    num_re   = re.compile(r'^\d+$')
    # Title Case 단일 단어 = HypeAuditor 카테고리 탭 헤더
    # 예: Beauty, Lifestyle, Travel, Family, Shows ...
    # 실제 IG username은 절대 이 패턴(첫 글자만 대문자인 순수 영어 단어)이 아님
    title_re = re.compile(r'^[A-Z][a-z]+$')

    # HypeAuditor 카테고리 단어 목록 (이름/username 필터에 공용)
    _CAT_WORDS = {
        'lifestyle','beauty','fashion','fitness','gaming','travel','food','cooking',
        'music','modeling','luxury','education','science','shopping','retail','shows',
        'family','humor','alcohol','tobacco','smoking','photography','nature',
        'landscapes','literature','journalism','architecture','urban','design',
        'accessories','jewellery','animals','racing','sports','outdoor','activity',
        'machinery','technologies','management','marketing','mobile','related',
        'cinema','actors','actresses','comics','sketches','computers','gadgets',
        'business','careers','motorbikes','medicine','happiness','toys','bakery',
        'coaches','trainers','water','winter','economics','finance','extreme',
        'nft','crypto','art','gym','kids','sweets',
    }
    SKIP = _CAT_WORDS | {
        'preview','share','rank','influencer','category','followers',
        'eng','auth','avg','how','all','top','south','korea',
        'countries','calculate','following','engagement','get started',
        'sign in','sign up','pricing','discover','instagram','tiktok',
        'youtube','hypeauditor','loading','error','filter','search',
        'logout','login','signup','report','reports','platform',
        'audience','quality','score','growth','rate','likes','comments',
        'reposts','views','stories','reels','sponsored','credibility',
    }

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    seen  = set()

    i = 0
    while i < len(lines):
        line = lines[i]

        # ── username 후보 4단계 필터 ──────────────────────────────
        # 1) IG username 패턴 불일치
        if not ig_re.match(line):
            i += 1; continue
        # 2) SKIP 단어 (카테고리 단어 + UI 텍스트, 소문자 비교)
        if line.lower() in SKIP:
            i += 1; continue
        # 3) Title Case 단일 단어 → 카테고리 탭 헤더
        #    (Beauty, Lifestyle, Travel, Family, Shows, Jaehyun ...)
        if title_re.match(line):
            i += 1; continue
        # 4) 바로 다음 줄이 @로 시작 → 섹션 헤더 뒤 서브텍스트
        if i + 1 < len(lines) and lines[i + 1].startswith('@'):
            i += 1; continue

        username = line
        name     = ''
        category = default_category
        followers = 0

        # username 이후 최대 8줄을 탐색
        # 팔로워(숫자M/K)가 나오면 그 앞이 이름+카테고리
        found_at = -1
        for j in range(i + 1, min(i + 9, len(lines))):
            tok = lines[j].replace(' ', '')
            if fol_re.match(tok):
                found_at  = j
                followers = parse_f(lines[j])
                break

        if found_at == -1 or followers < 500:
            i += 1
            continue

        # username ~ 팔로워 사이 줄들 분석
        between = [lines[k] for k in range(i + 1, found_at)]

        # 랭크 변동 숫자(한두 자리 숫자)는 건너뜀
        between = [b for b in between if not num_re.match(b)]

        # 첫 번째 줄 = 이름
        # - 한글, 영문 혼합 가능
        # - 카테고리는 / 또는 & 포함하거나 영어 단어들
        name_candidates = []
        cat_candidates  = []

        cat_keywords = {
            'art','artists','beauty','business','careers','cars','motorbikes',
            'cinema','actors','actresses','clothing','outfits','comics','sketches',
            'computers','gadgets','design','education','extreme','sports','outdoor',
            'family','fashion','finance','economics','fitness','gym','food','cooking',
            'gaming','health','medicine','humor','fun','happiness','kids','toys',
            'lifestyle','literature','journalism','luxury','machinery','technologies',
            'management','marketing','mobile','modeling','music','nature','landscapes',
            'photography','racing','science','shopping','retail','shows','ball',
            'sweets','bakery','tobacco','smoking','trainers','coaches','travel',
            'water','winter','accessories','jewellery','alcohol','animals',
            'architecture','urban','nft','crypto',
        }

        for b in between:
            b_lower = b.lower()
            # 카테고리 판별: /나 &가 들어있거나, 알려진 카테고리 단어 포함
            words = re.split(r'[/&\s]+', b_lower)
            is_cat = any(w in cat_keywords for w in words)
            if is_cat:
                cat_candidates.append(b)
            else:
                name_candidates.append(b)

        # 이름: name_candidates를 모두 이어붙임
        # (예: 'J', 'ennie' 처럼 줄 분리된 경우 → 'J ennie')
        if name_candidates:
            joined = ' '.join(name_candidates).strip()
            joined = re.sub(r'\s+', ' ', joined)
            if joined.lower() in _CAT_WORDS:          # 카테고리 단어 → None
                name = None
            elif len(joined) == 1 and not ('\uAC00' <= joined[0] <= '\uD7A3'):
                name = None                            # 1글자 영문 단독 → None
            else:
                name = joined
        elif between:
            first = between[0]
            name = None if first.lower() in _CAT_WORDS else first

        # 카테고리: 전부 수집 → 한국어 변환 → 중복 제거
        kor_cats = []
        seen_kor = set()
        for c in cat_candidates:
            k = hype_cat_to_kor(c, None)
            if k and k not in seen_kor:
                seen_kor.add(k)
                kor_cats.append(k)
        # 카테고리가 하나도 없으면 default_category 사용
        if not kor_cats:
            kor_cats = [default_category]

        if username not in seen:
            seen.add(username)
            results.append({
                'username':    username,
                'full_name':   strip_name(name) if name else None,
                'category':    kor_cats[0],       # 주 카테고리 (첫 번째)
                'categories':  kor_cats,           # 전체 카테고리 목록
                'followers':   followers,
                'tier':        calc_tier(followers),
                'profile_url': f'https://instagram.com/{username}',
                'source':      'hypeauditor',
                'scraped_at':  now,
            })

        i = found_at + 3  # 팔로워 이후 eng_auth, eng_avg, Preview 건너뜀

    return results


def extract_avatars(driver):
    """
    HypeAuditor 랭킹 페이지 DOM에서 username → 아바타 썸네일 URL 맵 추출.
    각 순위 행(div.row-cell.contributor)의 아바타 <img> src와
    contributor__content-username 텍스트를 매칭.
    (팔로워/카테고리 텍스트 파싱 로직과는 독립적으로 동작 - 실패해도 기존 수집엔 영향 없음)
    """
    avatars = {}
    try:
        rows = driver.find_elements(By.CSS_SELECTOR, 'div.row-cell.contributor')
        for row in rows:
            try:
                uname = row.find_element(By.CSS_SELECTOR, '.contributor__content-username').text.strip()
                img   = row.find_element(By.CSS_SELECTOR, 'img.avatar__img')
                src   = img.get_attribute('src')
                if uname and src:
                    avatars[uname] = src
            except Exception:
                continue
    except Exception as e:
        log(f'    ⚠️ 아바타 추출 실패: {e}')
    return avatars

def step_a_hypeauditor():
    log('[SOURCE A] HypeAuditor 한국 랭킹 수집 시작')
    crawl_state['phase'] = 'hypeauditor'
    total = 0

    # Chrome 브라우저 초기화 (JS 렌더링 필수)
    try:
        get_driver()
    except Exception as e:
        log(f'[오류] Chrome 브라우저를 시작할 수 없습니다: {e}')
        log('  → Chrome 설치 확인: https://www.google.com/chrome/')
        log('  → pip install selenium 확인')
        return 0

    for i, (url, default_cat) in enumerate(HYPE_PAGES):
        if not crawl_state['running']: break

        slug = url.split('top-instagram-')[1].rstrip('/')
        log(f'  [{i+1}/{len(HYPE_PAGES)}] {default_cat} ({slug})')
        try:
            body = browser_get(url, wait_sec=8)

            if not body or len(body) < 100:
                log(f'    ⚠️ 빈 응답')
                continue

            parsed = parse_hype_page(body, default_cat)
            if parsed:
                avatar_map = extract_avatars(get_driver())
                for r in parsed:
                    if r['username'] in avatar_map:
                        r['avatar_url'] = avatar_map[r['username']]
                upsert_influencers(parsed)
                total += len(parsed)
                log(f'    ✓ {len(parsed)}개 수집 (누적 {total}개)')
                for r in parsed[:3]:
                    log(f'      · @{r["username"]} | {r["full_name"]} | {r["followers"]:,}명')
            else:
                # 디버그: 실제 텍스트 샘플 출력 (M/K 단위 검색)
                sample = body[500:1000] if len(body) > 500 else body
                log(f'    ⚠️ 파싱 0개. 텍스트 샘플:')
                log(f'    {repr(sample[:300])}')

        except Exception as e:
            log(f'    ⚠️ 오류: {e}')

        crawl_state['progress'] = 5 + int((i+1) / len(HYPE_PAGES) * 55)
        time.sleep(2.0)  # 브라우저 부하 방지

    close_driver()

    log(f'[SOURCE A 완료] 총 {total}개')
    return total

# ── SOURCE B: 나무위키 ────────────────────────────────────────
NAMU_CATS = [
    'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EC%97%AC%EC%84%B1%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
    'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EB%82%A8%EC%84%B1%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
    'https://namu.wiki/w/%EB%B6%84%EB%A5%98:%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD%EC%9D%98%20%EC%BB%A4%ED%94%8C%20%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B7%B8%EB%9E%A8%20%EC%9D%B8%ED%94%8C%EB%A3%A8%EC%96%B8%EC%84%9C',
]
SKIP_NAMES = {'분류','나무위키','이전','다음','인플루언서','인스타그램','커플','여성','남성','대한민국'}
RESERVED   = {'p','reel','reels','explore','stories','accounts','help','about','www','tv','direct','legal','privacy'}

def step_b_namu(max_pages=600):
    log('[SOURCE B] 나무위키 수집 시작')
    conn = get_db()
    for url in NAMU_CATS:
        if not crawl_state['running']: break
        try:
            status, body = http_get(url, {'Referer': 'https://namu.wiki/'})
            if status != 200: continue
            links = []
            for m in re.finditer(r'href="/w/([^"#?]+)"[^>]*>([^<]{2,30})</a>', body):
                enc, disp = m.group(1), m.group(2).strip()
                if disp in SKIP_NAMES or enc.startswith('%EB%B6%84%EB%A5%98') or ':' in enc: continue
                links.append((disp, f'https://namu.wiki/w/{enc}'))
            conn.executemany('INSERT OR IGNORE INTO wiki_queue (name, wiki_url) VALUES (?,?)', links)
            conn.commit()
            log(f'  분류 완료: {len(links)}명 추가')
        except Exception as e:
            log(f'  ⚠️ {e}')
        time.sleep(2.5)
    conn.close()

    conn  = get_db()
    rows  = conn.execute('SELECT id, name, wiki_url FROM wiki_queue WHERE done=0 LIMIT ?', (max_pages,)).fetchall()
    conn.close()
    if not rows: return 0

    log(f'[SOURCE B] {len(rows)}개 문서 처리 시작')
    crawl_state['phase'] = 'wiki_pages'
    crawl_state['total'] = len(rows)
    crawl_state['done']  = 0
    found = 0

    for row in rows:
        if not crawl_state['running']: break
        try:
            status, body = http_get(row['wiki_url'], {'Referer': 'https://namu.wiki/'})
            username = None
            if status == 200:
                candidates = set()
                for p in [
                    re.compile(r'instagram\.com/([a-zA-Z0-9_.]{3,30})(?:["\'/?\s]|$)'),
                    re.compile(r'인스타(?:그램)?[^:：]*[:：]\s*@?([a-zA-Z0-9_.]{3,30})'),
                ]:
                    for m in p.finditer(body):
                        u = m.group(1).lower().rstrip('"\'). ,')
                        if len(u) >= 3 and u not in RESERVED and not u.isdigit():
                            candidates.add(u)
                if candidates:
                    username = sorted(candidates, key=lambda u: (
                        2 if row['name'].lower()[:3] in u else 0
                    ), reverse=True)[0]

            conn2 = get_db()
            if username:
                conn2.execute(
                    'INSERT OR IGNORE INTO influencers (username, full_name, profile_url, source, scraped_at) VALUES (?,?,?,?,?)',
                    (username, row['name'], f'https://instagram.com/{username}', 'namu_wiki', datetime.now().isoformat())
                )
                conn2.execute('UPDATE wiki_queue SET done=1, username=? WHERE id=?', (username, row['id']))
                found += 1
                log(f'  ✓ @{username} ← {row["name"]}')
            else:
                conn2.execute('UPDATE wiki_queue SET done=1 WHERE id=?', (row['id'],))
            conn2.commit()
            conn2.close()
        except Exception as e:
            log(f'  ⚠️ {row["name"]}: {e}')

        crawl_state['done'] += 1
        crawl_state['progress'] = 60 + int(crawl_state['done'] / crawl_state['total'] * 35)
        time.sleep(1.0)

    log(f'[SOURCE B 완료] {found}개 추가')
    return found

# ── EXPORT: DB → docs/data.json (GitHub Pages 정적 사이트용) ────
def export_data_json():
    try:
        os.makedirs('docs', exist_ok=True)
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM influencers WHERE followers > 0 ORDER BY followers DESC"
        ).fetchall()
        conn.close()

        data = [format_row(r) for r in rows]
        out  = {
            'generated': datetime.now().isoformat(),
            'total': len(data),
            'data': data,
        }
        path = os.path.join('docs', 'data.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        log(f'[EXPORT] docs/data.json 저장 완료 — {len(data)}명')
        return len(data)
    except Exception as e:
        log(f'[EXPORT] 오류: {e}')
        raise

@app.route('/api/export', methods=['POST'])
def api_export():
    try:
        n = export_data_json()
        return jsonify({'success': True, 'path': 'docs/data.json', 'count': n})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ── MASTER PIPELINE ───────────────────────────────────────────
def run_pipeline(options):
    use_hype = options.get('useHype', True)
    use_namu = options.get('useNamu', True)
    max_wiki = options.get('maxWikiPages', 600)

    with state_lock:
        crawl_state.update({
            'running': True, 'phase': 'starting', 'progress': 0,
            'total': 0, 'done': 0, 'collected': 0, 'log': [], 'errors': []
        })
    log('=== 수집 파이프라인 시작 ===')
    try:
        if use_hype: step_a_hypeauditor()
        if use_namu: step_b_namu(max_wiki)

        crawl_state.update({'phase': 'done', 'progress': 100, 'running': False})
        conn  = get_db()
        total = conn.execute('SELECT COUNT(*) FROM influencers').fetchone()[0]
        wf    = conn.execute('SELECT COUNT(*) FROM influencers WHERE followers > 0').fetchone()[0]
        conn.close()
        log(f'=== 완료! 총 {total}명 / 팔로워 있음: {wf}명 ===')
        export_data_json()
    except Exception as e:
        crawl_state.update({'running': False, 'phase': 'error'})
        log(f'[오류] {e}')
        import traceback; log(traceback.format_exc())

# ── 카테고리 재분류 ────────────────────────────────────────────
KPOP_NAMES = {
    'rm','jin','suga','jhope','j-hope','jimin','jungkook','bts','방탄',
    'lisa','jennie','rose','jisoo','blackpink','블랙핑크',
    'baekhyun','chanyeol','kai','sehun','suho','xiumin','chen','lay','exo','엑소',
    'nayeon','jeongyeon','momo','sana','jihyo','mina','dahyun','chaeyoung','tzuyu','twice','트와이스',
    'karina','winter','ningning','giselle','aespa','에스파',
    'wonyoung','yujin','gaeul','leeseo','rei','liz','ive','아이브',
    'coups','jeonghan','hoshi','wonwoo','woozi','mingyu','seungkwan','vernon','dino','seventeen','세븐틴',
    'bangchan','changbin','hyunjin','felix','seungmin','straykids','stray kids',
    'taeyong','mark','johnny','yuta','jaehyun','haechan','jeno','jaemin','nct','엔시티',
    'enhypen','엔하이픈','yeonjun','soobin','beomgyu','txt','투모로우바이투게더',
    'hongjoong','seonghwa','yunho','yeosang','san','mingi','wooyoung','jongho','ateez','에이티즈',
    'lesserafim','le sserafim','kazuha','eunchae','chaewon','sakura','yunjin',
    'newjeans','new jeans','minji','hanni','danielle','haerin','hyein',
    'babymonster','baby monster',
    'taeyeon','tiffany','hyoyeon','yuri','sooyoung','seohyun','yoona','sunny','snsd','소녀시대',
    'iu','아이유','hyuna','현아','hoyeon',
    'got7','갓세븐','shinee','샤이니','bigbang','빅뱅','2pm','monsta x','몬스타엑스','ikon','winner','위너',
    'itzy','있지','gidle','여자아이들','mamamoo','마마무','red velvet','레드벨벳','super junior','슈퍼주니어',
    'g-dragon','gdragon','taeyang','t.o.p','riize',
    'miyeon','minnie','yuqi','shuhua','yeji','ryujin','chaeryeong','yuna',
    'in (stray kids)',
    '한소희','안효섭','변우석','공유','황민현','정해인','김민규','추성훈',
    'choiwooshik','gongyoo','siwonchoi','joowon','eugene',
    'clean_0828','joy','jihyo',
}

KPOP_USERNAME_RE = re.compile(
    r'(bts|blackpink|exo_|twice|got7|nct|shinee|bigbang|enhypen|txt|'
    r'straykids|seventeen|svt|ateez|itzy|gidle|aespa|'
    r'lesserafim|babymonster|newjeans|ivestarship|mamamoo|redvelvet|'
    r'monsta_?x|ikon|winner|super_?junior|riize_official|'
    r'bighitofficial|smtown|jypentertainment|ygentertainment|realstraykids|'
    r'itzy\.all|twicetagram|realstraykids|realstraykids)'
)

def reclassify_db():
    """DB 전체 인플루언서 카테고리를 규칙 기반으로 재분류
    manually_edited=1 계정은 사용자가 직접 수정한 것이므로 건너뜀"""
    conn = get_db()
    rows = conn.execute('SELECT id, username, full_name, category, categories, followers FROM influencers').fetchall()
    # 수동 편집된 ID 미리 수집 (루프 안에서 매번 쿼리 안 치도록)
    edited_ids = {row[0] for row in conn.execute('SELECT id FROM influencers WHERE manually_edited=1').fetchall()}
    changed = 0

    for r in rows:
        if r['id'] in edited_ids:
            continue  # 사용자 수동 편집 계정 → 재분류 대상 제외
        u = (r['username'] or '').lower()
        n = (r['full_name'] or '').lower()
        text = u + ' ' + n
        try: old_cats = json.loads(r['categories'] or '[]')
        except: old_cats = [r['category']] if r['category'] else ['라이프스타일']

        # 기존 카테고리 중 확실한 것만 유지
        KEEP = {'뷰티','패션','음식','여행','게임','동물','럭셔리','자동차','금융','쇼핑','악세서리/주얼리','엔터테인먼트','건강','사진','아트/디자인','유머','미디어/글쓰기','피트니스','스포츠','라이프스타일','IT/테크','교육','육아','비즈니스'}
        # RECHECK 불필요 - KEEP이 전체 카테고리 커버
        # 기존 카테고리 중 알려진 카테고리만 유지 (unknown 카테고리 제거)
        new_cats = [c for c in old_cats if c in KEEP]
        seen = set(new_cats)
        def add(c):
            if c not in seen: new_cats.append(c); seen.add(c)
        def prepend(c):
            if c in new_cats: new_cats.remove(c)
            new_cats.insert(0, c); seen.add(c)

        # K팝/연예인
        is_kpop = any(kw in text for kw in KPOP_NAMES) or bool(KPOP_USERNAME_RE.search(u))
        if not is_kpop and r['followers'] and r['followers'] > 500_000:
            if re.search(r'official', u) and not re.search(r'(football|soccer|fc|club|team|bank|card|mart)', u):
                is_kpop = True
        if is_kpop: prepend('엔터테인먼트')

        # 스포츠 (진짜 선수/팀)
        if re.search(r'(heung.?min|hm_son7|pablogavi|harrykane|spursofficial|thekfa|olympic|'
                     r'축구|야구|농구|배구|수영|올림픽|국가대표|k.?league|sexyama|akiyama|'
                     r'격투|mma|ufc|athlete|footballer|soccer|football)', text):
            prepend('스포츠')

        # 피트니스 (헬스/운동)
        if re.search(r'(gym|workout|yoga|pilates|crossfit|헬스|홈트|요가|필라테스|운동|'
                     r'다이어트|트레이너|퍼스널트레이너|pt\.| pt |물리치료|재활)', text):
            add('피트니스')

        # 육아
        if re.search(r'(mom|dad|baby|child|toddler|임신|육아|아기|엄마|아빠|유아|출산|kids.?toys)', text):
            add('육아')

        # 비즈니스
        if re.search(r'(비즈니스|business|startup|스타트업|ceo|창업|법무|변호사|컨설팅|로펌)', text):
            add('비즈니스')

        # 교육
        if re.search(r'(교육|learn|study|english|korean|수학|과학|강의|강사|학원|tutor|professor|교수|선생)', text):
            add('교육')

        # IT/테크
        if re.search(r'(\bit\b|tech|코딩|프로그래밍|개발자|developer|engineer|software|ai\b|인공지능|앱개발)', text):
            add('IT/테크')

        # 동물
        if re.search(r'(펫|강아지|고양이|pet|dog|cat|포메라니안|시바|말티즈|고양|댕댕)', text):
            add('동물')

        # 사진
        if re.search(r'(photo|사진|photographer|스튜디오|studio|촬영|포토)', text):
            add('사진')

        # 아트/디자인
        if re.search(r'(artist|designer|design|illustrat|그림|일러스트|만화|웹툰|미술|예술|건축|architect)', text):
            add('아트/디자인')

        # 유머
        if re.search(r'(humor|comedy|코미디|개그|웃긴|funny|meme|밈)', text):
            add('유머')

        # 미디어/글쓰기
        if re.search(r'(writer|journalist|기자|작가|미디어|블로거|blogger|editor|편집)', text):
            add('미디어/글쓰기')

        if not new_cats:
            new_cats = ['라이프스타일']

        new_primary = new_cats[0]
        new_cats_json = json.dumps(new_cats, ensure_ascii=False)
        if new_primary != r['category'] or new_cats != old_cats:
            conn.execute('UPDATE influencers SET category=?, categories=? WHERE id=?',
                         (new_primary, new_cats_json, r['id']))
            changed += 1

    conn.commit()
    conn.close()
    log(f'[재분류] {changed}명 카테고리 업데이트 완료 (총 {len(rows)}명 중)')
    return changed

# ── FORMAT ROW ────────────────────────────────────────────────
# ── STRIP NAME ───────────────────────────────────────────────
import unicodedata as _ud, re as _re

_EMOJI_RE = _re.compile(
    u'[🌀-🿿'
    u'☀-➿'
    u'︀-️'
    u'𠀀-𯨟'
    u'-'
    u'‍'
    u'﻿]+',
    flags=_re.UNICODE
)
def strip_name(s):
    """이름에서 이모지·PUA 제거 + NFC 정규화. 결과가 비면 None 반환."""
    if not s: return None
    s = _ud.normalize('NFC', s)
    s = _EMOJI_RE.sub('', s)
    s = _re.sub(r'\s+', ' ', s).strip()
    return s or None

def format_row(r):
    try: tags = json.loads(r['tags'] or '[]')
    except: tags = []
    try: cats = json.loads(r['categories'] or '[]')
    except: cats = []
    u = r['username'] or ''
    f = r['followers'] or 0
    cat = (cats[0] if cats else None) or r['category'] or '라이프스타일'
    if not cats and cat:
        cats = [cat]
    return {
        'id': r['id'], 'name': strip_name(r['full_name']) or u, 'handle': f'@{u}',
        'category': cat,
        'categories': cats,
        'followers': f, 'following': r['following'] or 0,
        'posts': r['posts'] or 0, 'engagement': r['engagement'] or 0,
        'tier': r['tier'] or calc_tier(f), 'location': r['location'] or '한국',
        'bio': r['bio'] or '', 'tags': tags, 'avatarUrl': r['avatar_url'],
        'coverColor': cat_gradient(cat), 'verified': bool(r['verified']),
        'avgLikes': r['avg_likes'] or 0, 'avgComments': r['avg_comments'] or 0,
        'profileUrl': r['profile_url'] or f'https://instagram.com/{u}',
        'source': r['source'], 'isLive': True,
    }

# ── REST API ──────────────────────────────────────────────────
@app.route('/')
def index(): return send_from_directory('.', 'index.html')

@app.route('/api/influencers')
def api_influencers():
    q = request.args.get('q','')
    category = request.args.get('category','all')
    tier     = request.args.get('tier','all')
    sort     = request.args.get('sort','followers_desc')
    limit    = int(request.args.get('limit',200))
    offset   = int(request.args.get('offset',0))
    min_f    = int(request.args.get('min_followers',0))

    where, params = ['followers >= ?'], [min_f]
    q_norm = ''
    if q:
        # NFC 정규화 후 대소문자 무관 검색. 공백으로 나뉜 각 단어는 AND 조건
        # (예: "뷰티 김"은 "김OO 뷰티" 처럼 순서가 달라도 매칭됨)
        import unicodedata
        q_norm = unicodedata.normalize('NFC', q).lower()
        terms = [t for t in q_norm.split() if t]
        for t in terms:
            where.append('''(LOWER(username) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(bio) LIKE ?
                              OR LOWER(category) LIKE ? OR LOWER(categories) LIKE ? OR LOWER(tags) LIKE ?)''')
            params += [f'%{t}%']*6
    if category != 'all':
        # categories JSON 배열에 포함되거나 category 컬럼이 일치하는 경우
        where.append('(category = ? OR categories LIKE ?)')
        params += [category, f'%"{category}"%']
    if tier != 'all': where.append('tier = ?'); params.append(tier)

    order = {'followers_desc':'followers DESC','followers_asc':'followers ASC',
             'engagement_desc':'engagement DESC','name_asc':'full_name ASC'}.get(sort,'followers DESC')

    # 검색어가 있으면 관련도(아이디/이름 일치도)를 우선 정렬 기준으로 사용하고,
    # 선택된 정렬은 동점 시 보조 기준으로 사용
    order_params = []
    if q_norm:
        order = f'''CASE
            WHEN LOWER(username) = ? OR LOWER(full_name) = ? THEN 0
            WHEN LOWER(username) LIKE ? OR LOWER(full_name) LIKE ? THEN 1
            WHEN LOWER(username) LIKE ? OR LOWER(full_name) LIKE ? THEN 2
            ELSE 3
        END, {order}'''
        order_params = [q_norm, q_norm, f'{q_norm}%', f'{q_norm}%', f'%{q_norm}%', f'%{q_norm}%']

    w = 'WHERE ' + ' AND '.join(where)
    conn  = get_db()
    total = conn.execute(f'SELECT COUNT(*) FROM influencers {w}', params).fetchone()[0]
    rows  = conn.execute(f'SELECT * FROM influencers {w} ORDER BY {order} LIMIT ? OFFSET ?',
                         params+order_params+[limit,offset]).fetchall()
    conn.close()
    return jsonify({'total': total, 'data': [format_row(r) for r in rows]})

@app.route('/api/stats')
def api_stats():
    conn = get_db()
    total  = conn.execute('SELECT COUNT(*) FROM influencers').fetchone()[0]
    btier  = conn.execute('SELECT tier, COUNT(*) c FROM influencers GROUP BY tier').fetchall()
    bcat   = conn.execute('SELECT category, COUNT(*) c FROM influencers GROUP BY category ORDER BY c DESC').fetchall()
    queue  = conn.execute('SELECT COUNT(*) FROM wiki_queue WHERE done=0').fetchone()[0]
    conn.close()
    return jsonify({'total': total,
                    'byTier':     [{'tier':r['tier'],'c':r['c']} for r in btier],
                    'byCategory': [{'category':r['category'],'c':r['c']} for r in bcat],
                    'queuePending': queue})

@app.route('/api/reclassify', methods=['POST'])
def api_reclassify():
    changed = reclassify_db()
    return jsonify({'success': True, 'changed': changed})

@app.route('/api/influencers/update_name', methods=['POST'])
def api_update_name():
    import unicodedata
    data = request.json or {}
    rid  = data.get('id')
    name = data.get('name', '').strip()
    if not rid or not name:
        return jsonify({'error': 'id/name 필요'}), 400
    name = unicodedata.normalize('NFC', name)
    conn = get_db()
    conn.execute('UPDATE influencers SET full_name=? WHERE id=?', (name, rid))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/influencers/update_cats', methods=['POST'])
def api_update_cats():
    items = (request.json or {}).get('items', [])
    if not items:
        return jsonify({'error': 'items 필요'}), 400
    conn = get_db()
    for item in items:
        rid  = item.get('id')
        cats = item.get('categories', [])
        if not rid: continue
        cat = cats[0] if cats else '라이프스타일'
        conn.execute(
            # manually_edited=1 → 이후 재분류에서 이 계정은 건너뜀
            'UPDATE influencers SET category=?, categories=?, manually_edited=1 WHERE id=?',
            (cat, json.dumps(cats, ensure_ascii=False), rid)
        )
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'updated': len(items)})

@app.route('/api/influencers/delete', methods=['POST'])
def api_delete_influencers():
    data = request.json or {}
    ids  = data.get('ids', [])
    if not ids:
        return jsonify({'error': 'ids 필요'}), 400
    conn = get_db()
    conn.execute(f'DELETE FROM influencers WHERE id IN ({",".join("?"*len(ids))})', ids)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'deleted': len(ids)})

@app.route('/api/crawl/start', methods=['POST'])
def api_crawl_start():
    if crawl_state['running']: return jsonify({'error':'이미 실행 중'}), 409
    threading.Thread(target=run_pipeline, args=(request.json or {},), daemon=True).start()
    return jsonify({'success': True})

@app.route('/api/crawl/stop', methods=['POST'])
def api_crawl_stop():
    crawl_state['running'] = False
    return jsonify({'success': True})

@app.route('/api/crawl/status')
def api_crawl_status():
    conn = get_db()
    dbc  = conn.execute('SELECT COUNT(*) FROM influencers').fetchone()[0]
    qc   = conn.execute('SELECT COUNT(*) FROM wiki_queue WHERE done=0').fetchone()[0]
    conn.close()
    with state_lock:
        snap = dict(crawl_state); snap['log'] = list(snap['log'][-60:])
    snap.update({'dbCount': dbc, 'queueCount': qc})
    return jsonify(snap)

# ── MAIN ──────────────────────────────────────────────────────

@app.route('/api/db/reset', methods=['POST'])
def api_db_reset():
    """DB 초기화 (전체 삭제 후 재수집 준비)"""
    if crawl_state.get('running'):
        return jsonify({'error': '수집 중에는 초기화할 수 없습니다'}), 409
    conn = get_db()
    conn.execute('DELETE FROM influencers')
    conn.execute('DELETE FROM wiki_queue')
    try: conn.execute("DELETE FROM sqlite_sequence WHERE name='influencers'")
    except: pass
    conn.commit()
    conn.close()
    log('[DB 초기화] 전체 데이터 삭제 완료')
    return jsonify({'success': True})

@app.route('/api/db/clean-names', methods=['POST'])
def api_clean_names():
    """기존 DB의 이름에서 이모지/PUA 문자 일괄 제거"""
    conn = get_db()
    rows = conn.execute('SELECT id, full_name FROM influencers WHERE full_name IS NOT NULL').fetchall()
    updated = 0
    for r in rows:
        clean = strip_name(r['full_name'])
        if clean != r['full_name']:
            conn.execute('UPDATE influencers SET full_name=? WHERE id=?', (clean, r['id']))
            updated += 1
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'updated': updated})

@app.route('/api/categories/delete', methods=['POST'])
def api_delete_category():
    cat = (request.json or {}).get('category', '').strip()
    if not cat:
        return jsonify({'error': 'category 필요'}), 400
    conn = get_db()
    cur = conn.execute(
        'DELETE FROM influencers WHERE category=? OR categories LIKE ?',
        (cat, f'%"{cat}"%')
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'deleted': deleted, 'category': cat})

if __name__ == '__main__':
    init_db()
    print("""
+----------------------------------------------------+
|  INFL KR v5.0  http://localhost:3001               |
|  SOURCE A: HypeAuditor (username + 이름 + 팔로워)  |
|  SOURCE B: 나무위키 (아이디 보충)                  |
|  pip install flask flask-cors requests             |
+----------------------------------------------------+
    """, flush=True)
    app.run(port=PORT, debug=False, threaded=True)
