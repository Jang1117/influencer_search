/**
 * infl-kr delete-api
 * ------------------
 * docs/index.html(GitHub Pages 정적 뷰어)는 자체 DB가 없으므로,
 * 카드의 X(삭제) 버튼을 누르면 이 서버에 "삭제된 id" 목록을 Redis Set으로 기록한다.
 * 뷰어는 로드 시 이 목록을 받아와 data.json에서 해당 id를 걸러내고 렌더링한다.
 *
 * 배포: Render Web Service (이 폴더를 루트로) + Render Redis / Upstash Redis
 * 필요 환경변수: REDIS_URL (redis:// 또는 rediss://)
 */
const express = require('express');
const cors = require('cors');
const { createClient } = require('redis');

const PORT = process.env.PORT || 3002;
const DELETED_SET_KEY = 'infl:deleted-ids';

const app = express();
app.use(cors());
app.use(express.json());

// ── Redis 연결 (REDIS_URL 없으면 메모리 Set으로 대체 — 로컬 테스트용) ──
let redisClient = null;
const memoryFallback = new Set();

async function initRedis() {
  if (!process.env.REDIS_URL) {
    console.warn('[delete-api] REDIS_URL 미설정 — 메모리 저장소로 동작 (서버 재시작 시 초기화됨)');
    return;
  }
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('[delete-api] Redis 오류:', err.message));
  await redisClient.connect();
  console.log('[delete-api] Redis 연결 완료');
}

async function addDeletedId(id) {
  if (redisClient) return redisClient.sAdd(DELETED_SET_KEY, String(id));
  memoryFallback.add(String(id));
}

async function removeDeletedId(id) {
  if (redisClient) return redisClient.sRem(DELETED_SET_KEY, String(id));
  memoryFallback.delete(String(id));
}

async function getDeletedIds() {
  if (redisClient) return redisClient.sMembers(DELETED_SET_KEY);
  return [...memoryFallback];
}

// ── 라우트 ──
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/deleted-ids', async (_req, res) => {
  try {
    const ids = await getDeletedIds();
    res.json({ ids });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/deleted-ids', async (req, res) => {
  const { id } = req.body || {};
  if (id === undefined || id === null || id === '') {
    return res.status(400).json({ error: 'id 필요' });
  }
  try {
    await addDeletedId(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 삭제 취소(복구)용
app.delete('/api/deleted-ids/:id', async (req, res) => {
  try {
    await removeDeletedId(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initRedis()
  .catch((e) => console.error('[delete-api] Redis 초기화 실패:', e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`[delete-api] http://localhost:${PORT}`));
  });
