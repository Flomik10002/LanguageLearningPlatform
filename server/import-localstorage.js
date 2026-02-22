const fs = require('fs');
const path = require('path');
const { openDb, initDb, DB_PATH } = require('./db');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeExport(parsed) {
  const lessons = Array.isArray(parsed?.lessons) ? parsed.lessons : [];
  const attempts = Array.isArray(parsed?.attempts) ? parsed.attempts : [];

  if (lessons.length || attempts.length) {
    return { lessons, attempts };
  }

  if (Array.isArray(parsed)) {
    const lessonLike = parsed.filter((item) => isObject(item) && typeof item.lessonId === 'string');
    const attemptLike = parsed.filter((item) => isObject(item) && typeof item.attemptId === 'string');
    return { lessons: lessonLike, attempts: attemptLike };
  }

  if (isObject(parsed)) {
    const maybeLessons = Array.isArray(parsed.lessons) ? parsed.lessons : [];
    const maybeAttempts = Array.isArray(parsed.attempts) ? parsed.attempts : [];
    return { lessons: maybeLessons, attempts: maybeAttempts };
  }

  return { lessons: [], attempts: [] };
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node server/import-localstorage.js /path/to/backup.json');
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  const parsed = readJson(absolutePath);
  const { lessons, attempts } = normalizeExport(parsed);

  if (!lessons.length && !attempts.length) {
    console.error('No lessons or attempts found in the provided file.');
    process.exit(1);
  }

  const db = initDb(openDb());
  const now = new Date().toISOString();

  const insertLesson = db.prepare(`
    INSERT INTO lessons (
      lesson_id,
      title,
      language_id,
      level,
      tags_json,
      tasks_count,
      data_json,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lesson_id) DO UPDATE SET
      title = excluded.title,
      language_id = excluded.language_id,
      level = excluded.level,
      tags_json = excluded.tags_json,
      tasks_count = excluded.tasks_count,
      data_json = excluded.data_json,
      imported_at = excluded.imported_at
  `);

  const insertAttempt = db.prepare(`
    INSERT INTO attempts (
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
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(attempt_id) DO UPDATE SET
      lesson_id = excluded.lesson_id,
      timestamp_start = excluded.timestamp_start,
      timestamp_end = excluded.timestamp_end,
      duration_sec = excluded.duration_sec,
      mode = excluded.mode,
      score_percent = excluded.score_percent,
      points_earned = excluded.points_earned,
      points_max = excluded.points_max,
      data_json = excluded.data_json,
      imported_at = excluded.imported_at
  `);

  try {
    db.exec('BEGIN');

    lessons.forEach((lesson) => {
      if (!lesson || typeof lesson.lessonId !== 'string') return;
      const tags = Array.isArray(lesson.tags) ? lesson.tags : [];
      const tasksCount = Array.isArray(lesson.tasks) ? lesson.tasks.length : 0;
      insertLesson.run(
        lesson.lessonId,
        lesson.title || null,
        lesson.languageId || null,
        lesson.level || null,
        JSON.stringify(tags),
        tasksCount,
        JSON.stringify(lesson),
        now
      );
    });

    attempts.forEach((attempt) => {
      if (!attempt || typeof attempt.attemptId !== 'string') return;
      const score = attempt.score || {};
      insertAttempt.run(
        attempt.attemptId,
        attempt.lessonId || null,
        attempt.timestampStart || null,
        attempt.timestampEnd || null,
        typeof attempt.durationSec === 'number' ? attempt.durationSec : null,
        attempt.mode || null,
        typeof score.percent === 'number' ? score.percent : null,
        typeof score.pointsEarned === 'number' ? score.pointsEarned : null,
        typeof score.pointsMax === 'number' ? score.pointsMax : null,
        JSON.stringify(attempt),
        now
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const lessonCount = db.prepare('SELECT COUNT(*) AS count FROM lessons').get().count;
  const attemptCount = db.prepare('SELECT COUNT(*) AS count FROM attempts').get().count;

  console.log(`Import complete. Lessons: ${lessonCount}, Attempts: ${attemptCount}`);
  console.log(`DB path: ${DB_PATH}`);
}

main();
