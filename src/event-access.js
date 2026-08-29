const crypto = require('crypto');

const COOKIE_NAME = 'scavengers_event_access';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;

function getSessionSecret() {
  return process.env.EVENT_SESSION_SECRET
    || process.env.TURSO_AUTH_TOKEN
    || 'scavengers-hole-local-development-session-secret';
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function readEventAccess(req) {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return [];

  const separator = cookie.lastIndexOf('.');
  if (separator < 1) return [];
  const payload = cookie.slice(0, separator);
  const providedSignature = cookie.slice(separator + 1);
  const expectedSignature = sign(payload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return [];

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session || Number(session.expiresAt) <= Date.now() || !Array.isArray(session.eventIds)) return [];
    return session.eventIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  } catch (error) {
    return [];
  }
}

function hasEventAccess(req, eventId) {
  return readEventAccess(req).includes(Number(eventId));
}

function grantEventAccess(req, res, eventId) {
  const eventIds = [...new Set([...readEventAccess(req), Number(eventId)])];
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = encode(JSON.stringify({ eventIds, expiresAt }));
  res.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

function hashEventPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(String(passcode), salt, SCRYPT_KEY_LENGTH).toString('base64url');
  return `scrypt$${salt}$${derived}`;
}

function verifyEventPasscode(passcode, storedHash) {
  if (!storedHash) return true;
  const value = String(passcode || '');

  if (storedHash.startsWith('scrypt$')) {
    const [, salt, expected] = storedHash.split('$');
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(value, salt, SCRYPT_KEY_LENGTH);
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  }

  const legacyActual = crypto.createHash('sha256').update(value).digest('hex');
  const actualBuffer = Buffer.from(legacyActual);
  const expectedBuffer = Buffer.from(String(storedHash));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isLegacyPasscodeHash(storedHash) {
  return Boolean(storedHash) && !String(storedHash).startsWith('scrypt$');
}

module.exports = {
  grantEventAccess,
  hashEventPasscode,
  hasEventAccess,
  isLegacyPasscodeHash,
  verifyEventPasscode,
};
