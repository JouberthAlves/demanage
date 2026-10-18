import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const consent = readFileSync(new URL('../src/pages/oauth-consent-page.tsx', import.meta.url), 'utf8');
const integrations = readFileSync(new URL('../src/pages/integrations-page.tsx', import.meta.url), 'utf8');

test('OAuth consent distinguishes identity confirmation from permission approval', () => {
  assert.match(consent, /request\?\.step === 'account'/);
  assert.match(consent, /Etapa 1 de 2/);
  assert.match(consent, /Etapa 2 de 2/);
  assert.match(consent, /Confirmar conta/);
  assert.match(consent, /Autorizar conex[aã]o/);
});

test('OAuth consent blocks repeated submit while redirecting', () => {
  assert.match(consent, /onSubmit=\{/);
  assert.match(consent, /preventDefault\(\)/);
  // Native form serialization must still include the clicked named submitter
  // (decision=approve/deny) after React handles onSubmit.
  assert.doesNotMatch(consent, /<button\s+disabled=\{submitting\}/);
  assert.match(consent, /<button[^>]*name='decision' value='approve'/);
  assert.match(consent, /<button[^>]*name='decision' value='deny'/);
});

test('Integrations distinguish granted consent from completed third-party installation', () => {
  assert.match(integrations, /n[aã]o confirma a instala[cç][aã]o/);
});
