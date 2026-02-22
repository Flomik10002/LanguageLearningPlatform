const fs = require('fs');
const path = require('path');
const { openDb, initDb } = require('./db');
const { hashToken } = require('./auth');

function usage() {
  console.error('Usage: node server/import-token-attempts.js <token> <backup.json>');
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeExport(parsed) {
  if (Array.isArray(parsed)) {
    const lessons = parsed.filter((item) => isObject(item) && typeof item.lessonId === 'string');
    const attempts = parsed.filter((item) => isObject(item) && typeof item.attemptId === 'string');
    return { lessons, attempts };
  }

  if (!isObject(parsed)) {
    return { lessons: [], attempts: [] };
  }

  const lessons = Array.isArray(parsed.lessons)
    ? parsed.lessons.filter((item) => isObject(item) && typeof item.lessonId === 'string')
    : [];
  const attempts = Array.isArray(parsed.attempts)
    ? parsed.attempts.filter((item) => isObject(item) && typeof item.attemptId === 'string')
    : [];

  return { lessons, attempts };
}

function parseLesson(rawLesson) {
  if (!rawLesson || typeof rawLesson !== 'object' || typeof rawLesson.lessonId !== 'string') {
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

function parseAttempt(rawAttempt) {
  if (!rawAttempt || typeof rawAttempt !== 'object' || typeof rawAttempt.attemptId !== 'string') {
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

function main() {
  const token = process.argv[2];
  const filePath = process.argv[3];
  if (!token || !filePath) {
    usage();
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = normalizeExport(parsed);
  const lessons = normalized.lessons.map(parseLesson).filter(Boolean);
  const attempts = normalized.attempts.map(parseAttempt).filter(Boolean);

  if (!lessons.length && !attempts.length) {
    console.error('No lessons or attempts found in file.');
    process.exit(1);
  }

  const db = initDb(openDb());
  const tokenHash = hashToken(token);
  const tokenRow = db
    .prepare('SELECT token_hint, is_active FROM auth_tokens WHERE token_hash = ?')
    .get(tokenHash);

  if (!tokenRow) {
    console.error('Token not found. Add it first with: npm run token:add -- <token> [label]');
    process.exit(1);
  }

  if (!tokenRow.is_active) {
    console.error('Token is revoked. Activate first with: npm run token:activate -- <token>');
    process.exit(1);
  }

  const upsertLesson = db.prepare(`
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

  const upsertAttempt = db.prepare(`
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

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN');
    lessons.forEach((lesson) => {
      upsertLesson.run(
        tokenHash,
        lesson.lessonId,
        lesson.title,
        lesson.languageId,
        lesson.level,
        lesson.tagsJson,
        lesson.tasksCount,
        lesson.dataJson,
        now,
        now
      );
    });

    attempts.forEach((attempt) => {
      upsertAttempt.run(
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
        now,
        now
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const lessonCount = db
    .prepare('SELECT COUNT(*) AS count FROM user_lessons WHERE user_token_hash = ?')
    .get(tokenHash).count;
  const attemptCount = db
    .prepare('SELECT COUNT(*) AS count FROM user_attempts WHERE user_token_hash = ?')
    .get(tokenHash).count;

  console.log(`Done. Imported lessons: ${lessons.length}, attempts: ${attempts.length} for token ${tokenRow.token_hint}.`);
  console.log(`Token totals now - lessons: ${lessonCount}, attempts: ${attemptCount}`);
}

main();
