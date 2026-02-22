const { openDb, initDb } = require('./db');
const { hashToken, tokenHint, randomToken } = require('./auth');

function usage() {
  console.log('Usage:');
  console.log('  node server/manage-token.js add <token> [label]');
  console.log('  node server/manage-token.js create [label]');
  console.log('  node server/manage-token.js revoke <token>');
  console.log('  node server/manage-token.js activate <token>');
  console.log('  node server/manage-token.js list');
}

function main() {
  const command = process.argv[2];
  const db = initDb(openDb());

  if (!command) {
    usage();
    process.exit(1);
  }

  if (command === 'list') {
    const rows = db
      .prepare(
        `SELECT token_hint, label, is_active, created_at
         FROM auth_tokens
         ORDER BY created_at DESC`
      )
      .all();

    if (!rows.length) {
      console.log('No tokens configured.');
      return;
    }

    rows.forEach((row) => {
      const status = row.is_active ? 'active' : 'revoked';
      const label = row.label ? ` (${row.label})` : '';
      console.log(`${row.token_hint}${label} - ${status} - ${row.created_at}`);
    });
    return;
  }

  if (command === 'create') {
    const label = process.argv.slice(3).join(' ') || null;
    const token = randomToken(40);
    addToken(db, token, label);
    console.log(`Token created: ${token}`);
    return;
  }

  if (command === 'add') {
    const token = process.argv[3];
    const label = process.argv.slice(4).join(' ') || null;
    if (!token) {
      usage();
      process.exit(1);
    }
    addToken(db, token, label);
    console.log(`Token added: ${tokenHint(token)}`);
    return;
  }

  if (command === 'revoke' || command === 'activate') {
    const token = process.argv[3];
    if (!token) {
      usage();
      process.exit(1);
    }

    const tokenHash = hashToken(token);
    const isActive = command === 'activate' ? 1 : 0;
    const result = db
      .prepare('UPDATE auth_tokens SET is_active = ? WHERE token_hash = ?')
      .run(isActive, tokenHash);

    if (!result.changes) {
      console.error('Token not found.');
      process.exit(1);
    }

    console.log(`Token ${command}d: ${tokenHint(token)}`);
    return;
  }

  usage();
  process.exit(1);
}

function addToken(db, token, label) {
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO auth_tokens (token_hash, token_hint, label, is_active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(token_hash) DO UPDATE SET
         token_hint = excluded.token_hint,
         label = excluded.label,
         is_active = 1`
    )
    .run(hashToken(token), tokenHint(token), label, now);
}

main();
