import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordVersion, newPassword, signSession, verifySession, sessionFrom, sessionCookie, clearCookie, publicUser, usernameOk, passwordOk } from '../src/cloud/auth.mjs';
import { cookieOf, keyOkFor } from '../src/cloud/http.mjs';

test('passwords: scrypt hash verifies, wrong or malformed fails, version tracks the hash', () => {
  const h = hashPassword('correct horse battery'); assert.ok(h.startsWith('scrypt$16384$'));
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong horse', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(verifyPassword('x', ''), false);
  assert.notEqual(hashPassword('correct horse battery'), h, 'fresh salt each time');
  assert.equal(passwordVersion(h).length, 8); assert.notEqual(passwordVersion(h), passwordVersion(hashPassword('correct horse battery')));
  assert.throws(() => hashPassword('short'), /10 to 200/);
  assert.match(newPassword(), /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/); assert.notEqual(newPassword(), newPassword());
  assert.ok(usernameOk('sax.q_b-7') && !usernameOk('a') && !usernameOk('a b') && !usernameOk('../x'));
  assert.ok(passwordOk('0123456789') && !passwordOk('012345678') && !passwordOk(null));
});

test('sessions: signed, tamper-proof, expiring; cookie round trip; public user hides the hash', () => {
  const secret = 's'.repeat(32); const now = 1_000_000;
  const tok = signSession({ uid: 7, pv: 'abc' }, secret, { now, ttlMs: 1000 });
  assert.deepEqual(verifySession(tok, secret, now + 500), { uid: 7, pv: 'abc', exp: now + 1000 });
  assert.equal(verifySession(tok, secret, now + 1001), null, 'expired');
  assert.equal(verifySession(tok, 'x'.repeat(32), now), null, 'wrong secret');
  const [p, s] = tok.split('.');
  assert.equal(verifySession(p + 'x.' + s, secret, now), null, 'payload tampered');
  assert.equal(verifySession(p + '.' + s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A'), secret, now), null, 'signature tampered');
  assert.equal(verifySession('', secret, now), null); assert.equal(verifySession(tok, '', now), null);
  assert.throws(() => signSession({ uid: 1 }, 'short'), /BINAS_SESSION_SECRET/);
  const cookie = sessionCookie(tok);
  assert.ok(cookie.startsWith('binas_session=') && cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax') && cookie.includes('Path=/'));
  assert.equal(sessionFrom({ headers: { cookie: 'a=b; ' + cookie.split(';')[0] } }, secret, now).uid, 7);
  assert.equal(cookieOf({ headers: { cookie: 'x=1; y=%20z' } }, 'y'), ' z'); assert.equal(cookieOf({ headers: {} }, 'y'), '');
  assert.ok(clearCookie().includes('Max-Age=0'));
  assert.deepEqual(publicUser({ id: '3', username: 'u', display: 'U', role: 'tester', floor: 'u', allowance_usd: '25', pass_hash: 'secret' }), { id: 3, username: 'u', display: 'U', role: 'tester', floor: 'u', allowanceUsd: 25 });
  assert.equal(publicUser({ id: '1', allowance_usd: null }).allowanceUsd, null); assert.equal(publicUser(null), null);
});

test('the master key opens every floor; a floor key opens only its floor; nothing configured opens nothing', () => {
  const env = { BINAS_KEY: 'master', BINAS_KEY_T1: 'one' };
  assert.equal(keyOkFor('master', 'default', env), true); assert.equal(keyOkFor('master', 't1', env), true); assert.equal(keyOkFor('master', 'other', env), true);
  assert.equal(keyOkFor('one', 't1', env), true); assert.equal(keyOkFor('one', 'default', env), false); assert.equal(keyOkFor('one', 'other', env), false);
  assert.equal(keyOkFor('master', 't1', {}), false); assert.equal(keyOkFor('', 'default', { BINAS_KEY: '' }), false);
});
