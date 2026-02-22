const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { openDb, initDb, DB_PATH } = require('./db');
const { hashToken } = require('./auth');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = path.resolve(__dirname, '..');
const LESSON_FORMAT_PATH = path.join(ROOT_DIR, 'LESSON_FORMAT.md');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const db = initDb(openDb());

const upsertAttemptStmt = db.prepare(`
  INSERT INTO user_attempts (
    user_token_hash,
    attempt_id,
    lesson_id,
    timestamp_start,
    timestamp_end,
    duration_sec,
    mode,
    score_percent,
    points_earned,
    points_max,
    data_json,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_token_hash, attempt_id) DO UPDATE SET
    lesson_id = excluded.lesson_id,
    timestamp_start = excluded.timestamp_start,
    timestamp_end = excluded.timestamp_end,
    duration_sec = excluded.duration_sec,
    mode = excluded.mode,
    score_percent = excluded.score_percent,
    points_earned = excluded.points_earned,
    points_max = excluded.points_max,
    data_json = excluded.data_json,
    updated_at = excluded.updated_at
`);

const upsertLessonStmt = db.prepare(`
  INSERT INTO user_lessons (
    user_token_hash,
    lesson_id,
    title,
    language_id,
    level,
    tags_json,
    tasks_count,
    data_json,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_token_hash, lesson_id) DO UPDATE SET
    title = excluded.title,
    language_id = excluded.language_id,
    level = excluded.level,
    tags_json = excluded.tags_json,
    tasks_count = excluded.tasks_count,
    data_json = excluded.data_json,
    updated_at = excluded.updated_at
`);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function resolveAuthToken(req, body) {
  const headerToken = req.headers['x-access-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  if (body && typeof body.token === 'string' && body.token.trim()) {
    return body.token.trim();
  }
  return '';
}

function getActiveTokenMeta(token) {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const row = db
    .prepare('SELECT token_hint, label FROM auth_tokens WHERE token_hash = ? AND is_active = 1')
    .get(tokenHash);

  if (!row) {
    return null;
  }

  return {
    tokenHash,
    tokenHint: row.token_hint || maskToken(token),
    label: row.label || ''
  };
}

function parseAttempt(rawAttempt) {
  if (!rawAttempt || typeof rawAttempt !== 'object') {
    return null;
  }
  if (!rawAttempt.attemptId || typeof rawAttempt.attemptId !== 'string') {
    return null;
  }

  const score = rawAttempt.score || {};
  return {
    attemptId: rawAttempt.attemptId,
    lessonId: rawAttempt.lessonId || null,
    timestampStart: rawAttempt.timestampStart || null,
    timestampEnd: rawAttempt.timestampEnd || null,
    durationSec: typeof rawAttempt.durationSec === 'number' ? rawAttempt.durationSec : null,
    mode: rawAttempt.mode || null,
    scorePercent: typeof score.percent === 'number' ? score.percent : null,
    pointsEarned: typeof score.pointsEarned === 'number' ? score.pointsEarned : null,
    pointsMax: typeof score.pointsMax === 'number' ? score.pointsMax : null,
    dataJson: JSON.stringify(rawAttempt)
  };
}

function parseLesson(rawLesson) {
  if (!rawLesson || typeof rawLesson !== 'object') {
    return null;
  }
  if (!rawLesson.lessonId || typeof rawLesson.lessonId !== 'string') {
    return null;
  }
  const tags = Array.isArray(rawLesson.tags) ? rawLesson.tags : [];
  const tasksCount = Array.isArray(rawLesson.tasks) ? rawLesson.tasks.length : 0;
  return {
    lessonId: rawLesson.lessonId,
    title: rawLesson.title || null,
    languageId: rawLesson.languageId || null,
    level: rawLesson.level || null,
    tagsJson: JSON.stringify(tags),
    tasksCount,
    dataJson: JSON.stringify(rawLesson)
  };
}

function upsertAttempt(tokenHash, attempt, timestamp) {
  upsertAttemptStmt.run(
    tokenHash,
    attempt.attemptId,
    attempt.lessonId,
    attempt.timestampStart,
    attempt.timestampEnd,
    attempt.durationSec,
    attempt.mode,
    attempt.scorePercent,
    attempt.pointsEarned,
    attempt.pointsMax,
    attempt.dataJson,
    timestamp,
    timestamp
  );
}

function upsertLesson(tokenHash, lesson, timestamp) {
  upsertLessonStmt.run(
    tokenHash,
    lesson.lessonId,
    lesson.title,
    lesson.languageId,
    lesson.level,
    lesson.tagsJson,
    lesson.tasksCount,
    lesson.dataJson,
    timestamp,
    timestamp
  );
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, dbPath: DB_PATH });
  }

  if (req.method === 'GET' && url.pathname === '/api/lesson-format') {
    if (!fs.existsSync(LESSON_FORMAT_PATH)) {
      return sendJson(res, 404, { ok: false, error: 'LESSON_FORMAT.md not found' });
    }
    const text = fs.readFileSync(LESSON_FORMAT_PATH, 'utf8');
    return sendJson(res, 200, { ok: true, text });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/validate') {
    const body = await readJson(req);
    const token = resolveAuthToken(req, body);
    const meta = getActiveTokenMeta(token);

    if (!meta) {
      return sendJson(res, 401, { ok: false, error: 'Invalid token' });
    }

    return sendJson(res, 200, {
      ok: true,
      tokenHint: meta.tokenHint,
      label: meta.label
    });
  }

  const token = resolveAuthToken(req);
  const meta = getActiveTokenMeta(token);

  if (!meta) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    return sendJson(res, 200, { ok: true, tokenHint: meta.tokenHint, label: meta.label });
  }

  if (req.method === 'GET' && url.pathname === '/api/lessons') {
    const rows = db
      .prepare(
        `SELECT data_json
         FROM user_lessons
         WHERE user_token_hash = ?
         ORDER BY updated_at DESC`
      )
      .all(meta.tokenHash);

    const lessons = rows
      .map((row) => {
        try {
          return JSON.parse(row.data_json);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);

    return sendJson(res, 200, { ok: true, lessons });
  }

  if (req.method === 'POST' && url.pathname === '/api/lessons') {
    const body = await readJson(req);
    const parsedLesson = parseLesson(body.lesson);
    if (!parsedLesson) {
      return sendJson(res, 400, { ok: false, error: 'Invalid lesson payload' });
    }

    const now = new Date().toISOString();
    upsertLesson(meta.tokenHash, parsedLesson, now);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/lessons/bulk') {
    const body = await readJson(req);
    const rawLessons = Array.isArray(body.lessons) ? body.lessons : [];
    const parsed = rawLessons.map(parseLesson).filter(Boolean);

    const now = new Date().toISOString();
    try {
      db.exec('BEGIN');
      parsed.forEach((lesson) => upsertLesson(meta.tokenHash, lesson, now));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return sendJson(res, 200, { ok: true, saved: parsed.length });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/lessons') {
    const result = db
      .prepare('DELETE FROM user_lessons WHERE user_token_hash = ?')
      .run(meta.tokenHash);
    return sendJson(res, 200, { ok: true, deleted: result.changes });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/lessons/')) {
    const lessonId = decodeURIComponent(url.pathname.slice('/api/lessons/'.length));
    if (!lessonId) {
      return sendJson(res, 400, { ok: false, error: 'lessonId is required' });
    }
    const result = db
      .prepare('DELETE FROM user_lessons WHERE user_token_hash = ? AND lesson_id = ?')
      .run(meta.tokenHash, lessonId);
    return sendJson(res, 200, { ok: true, deleted: result.changes });
  }

  if (req.method === 'GET' && url.pathname === '/api/attempts') {
    const rows = db
      .prepare(
        `SELECT data_json
         FROM user_attempts
         WHERE user_token_hash = ?
         ORDER BY COALESCE(timestamp_start, updated_at) DESC`
      )
      .all(meta.tokenHash);

    const attempts = rows
      .map((row) => {
        try {
          return JSON.parse(row.data_json);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);

    return sendJson(res, 200, { ok: true, attempts });
  }

  if (req.method === 'POST' && url.pathname === '/api/attempts') {
    const body = await readJson(req);
    const parsedAttempt = parseAttempt(body.attempt);
    if (!parsedAttempt) {
      return sendJson(res, 400, { ok: false, error: 'Invalid attempt payload' });
    }

    const now = new Date().toISOString();
    upsertAttempt(meta.tokenHash, parsedAttempt, now);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/attempts/bulk') {
    const body = await readJson(req);
    const rawAttempts = Array.isArray(body.attempts) ? body.attempts : [];
    const parsed = rawAttempts.map(parseAttempt).filter(Boolean);

    const now = new Date().toISOString();
    try {
      db.exec('BEGIN');
      parsed.forEach((attempt) => upsertAttempt(meta.tokenHash, attempt, now));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return sendJson(res, 200, { ok: true, saved: parsed.length });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/attempts') {
    const result = db
      .prepare('DELETE FROM user_attempts WHERE user_token_hash = ?')
      .run(meta.tokenHash);
    return sendJson(res, 200, { ok: true, deleted: result.changes });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

function normalizePath(urlPathname) {
  if (!urlPathname || urlPathname === '/') {
    return '/index.html';
  }
  return urlPathname;
}

function shouldBlockStatic(normalizedPath) {
  const blockedPrefixes = ['/server/', '/.git/', '/.idea/', '/node_modules/'];
  return blockedPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

function serveStatic(req, res, url) {
  const normalized = normalizePath(url.pathname);
  if (shouldBlockStatic(normalized)) {
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  const relativePath = normalized.replace(/^[/\\]+/, '');
  const safePath = path.normalize(relativePath);
  if (safePath.startsWith('..')) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }
  const fullPath = path.join(ROOT_DIR, safePath || 'index.html');

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(fullPath).pipe(res);
  return undefined;
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Flomik Labs server started on http://${HOST}:${PORT}`);
  console.log(`SQLite: ${DB_PATH}`);
});
