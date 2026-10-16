import assert from 'node:assert/strict';
import test from 'node:test';

import { previewFinanceOperation, verifyIntent, verifyIntentWithNonce } from './finance-preview';

const secret = 'test-only-preview-intent-secret-with-more-than-32-bytes';
const identity = { userId: 'user-preview-a', clientId: 'client-preview-a' };
const received = {
  kind: 'receive_income',
  amountCents: 2_000,
  dateKey: '2026-10-16',
  description: ' Presente da minha vó ',
  tagName: ' Presente ',
};

test('receiving income signs a canonical, user-bound action with the correct cash effect', async () => {
  const preview = await previewFinanceOperation(identity, { ...received, ignored: 'do not sign' }, { secret });
  assert.equal(preview.status, 'ready');
  if (preview.status !== 'ready') return;
  assert.deepEqual(preview.effects, { cashDeltaCents: 2_000, piggyDeltaCents: 0 });
  assert.match(preview.summary, /20,00/);
  assert.deepEqual(verifyIntent(preview.intentToken, identity, { secret }), {
    kind: 'receive_income',
    amountCents: 2_000,
    dateKey: '2026-10-16',
    description: 'Presente da minha vó',
    tagName: 'Presente',
  });
  const verified = verifyIntentWithNonce(preview.intentToken, identity, { secret });
  assert.deepEqual(verified.action, verifyIntent(preview.intentToken, identity, { secret }));
  assert.match(verified.nonce, /^[A-Za-z0-9_-]+$/);
  assert.throws(() => verifyIntent(preview.intentToken, { ...identity, userId: 'other' }, { secret }));
  assert.throws(() => verifyIntent(preview.intentToken, { ...identity, clientId: 'other' }, { secret }));
  const [body, mac] = preview.intentToken.split('.');
  assert.throws(() => verifyIntent(body.slice(0, -1) + 'A.' + mac, identity, { secret }));
  assert.throws(() => verifyIntent(preview.intentToken, identity, { secret, nowMs: Date.now() + 310_000 }));
});

test('incomplete draft asks for missing money/date/tag without reading DB', async () => {
  const preview = await previewFinanceOperation(identity, {
    kind: 'receive_income',
    amountCents: 0,
    dateKey: 'not-a-date',
    description: '',
  }, { secret });
  assert.equal(preview.status, 'clarification_required');
  if (preview.status !== 'clarification_required') return;
  assert.ok(preview.questions.some((question) => /valor/i.test(question)));
  assert.ok(preview.questions.some((question) => /data/i.test(question)));
  assert.ok(preview.questions.some((question) => /tag/i.test(question)));
});

test('tagless income is signed with explicit null tag', async () => {
  const preview = await previewFinanceOperation(identity, { ...received, tagName: null }, { secret });
  assert.equal(preview.status, 'ready');
  if (preview.status !== 'ready') return;
  assert.deepEqual(verifyIntent(preview.intentToken, identity, { secret }), {
    kind: 'receive_income',
    amountCents: 2_000,
    dateKey: '2026-10-16',
    description: 'Presente da minha vó',
    tagName: null,
  });
});

test('future cash deposit asks for an actual posting date before any database lookup', async () => {
  const preview = await previewFinanceOperation(identity, {
    kind: 'deposit_existing_cash',
    amountCents: 2_000,
    dateKey: '2099-01-01',
    bankId: 'bank-porco',
    deductFromBalance: true,
  }, { secret });
  assert.equal(preview.status, 'clarification_required');
  if (preview.status !== 'clarification_required') return;
  assert.ok(preview.questions.some((question) => /data|futur/i.test(question)));
});

test('rejects extra signed fields despite a valid HMAC', async () => {
  const { createSignedFinanceIntent } = await import('./finance-intent');
  const token = createSignedFinanceIntent(identity, {
    ...received,
    description: 'Received',
    userId: 'attacker',
  }, secret).token;
  assert.throws(() => verifyIntent(token, identity, { secret }), /intent|ação|inválid/i);
});
