import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignedFinanceIntent, verifySignedFinanceIntent } from './finance-intent';

const secret = 'test-only-financial-intent-secret-at-least-32-bytes';
const identity = { userId: 'user-a', clientId: 'client-a' };
const draft = {
  kind: 'receive_income',
  amountCents: 2000,
  dateKey: '2026-10-16',
  description: 'Presente da minha vó',
  tagName: 'Presente',
};

test('intent is bound to user, client and expiration', () => {
  const signed = createSignedFinanceIntent(identity, draft, secret, 100_000);
  assert.match(signed.nonce, /^[a-zA-Z0-9_-]+$/);
  assert.deepEqual(verifySignedFinanceIntent(signed.token, identity, secret, 100_001), {
    nonce: signed.nonce,
    action: draft,
  });
  assert.throws(
    () => verifySignedFinanceIntent(signed.token, { ...identity, userId: 'user-b' }, secret, 100_001),
    /intent|identidade|inválid/i,
  );
  assert.throws(
    () => verifySignedFinanceIntent(signed.token, { ...identity, clientId: 'client-b' }, secret, 100_001),
    /intent|identidade|inválid/i,
  );
  assert.throws(
    () => verifySignedFinanceIntent(signed.token, identity, secret, 400_001),
    /expirad/i,
  );
});

test('intent rejects tampering, key confusion and malformed tokens', () => {
  const signed = createSignedFinanceIntent(identity, draft, secret, 100_000);
  const [body, mac] = signed.token.split('.');
  const tamperedBody = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
  assert.throws(
    () => verifySignedFinanceIntent(`${tamperedBody}.${mac}`, identity, secret, 100_001),
    /intent|assinatura|inválid/i,
  );
  assert.throws(
    () => verifySignedFinanceIntent(signed.token, identity, `${secret}bad`, 100_001),
    /intent|assinatura|inválid/i,
  );
  assert.throws(() => verifySignedFinanceIntent('garbage', identity, secret, 100_001));
  assert.notEqual(createSignedFinanceIntent(identity, draft, secret, 100_000).nonce, signed.nonce);
});

test('oversized signed intents are rejected at creation, not at execution', () => {
  assert.throws(
    () => createSignedFinanceIntent(identity, { ...draft, extra: 'x'.repeat(10_000) }, secret, 100_000),
    /grande|inválido|longo/i,
  );
});
