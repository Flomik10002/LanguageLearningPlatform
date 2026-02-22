const crypto = require('crypto');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest('hex');
}

function tokenHint(rawToken) {
  const token = String(rawToken || '');
  if (!token) {
    return '';
  }
  if (token.length <= 8) {
    return token;
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function randomToken(length = 40) {
  const bytes = Math.ceil(length / 2);
  return crypto.randomBytes(bytes).toString('hex').slice(0, length);
}

module.exports = {
  hashToken,
  tokenHint,
  randomToken
};
