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
  assert.match(consent, /disabled=\{submitting\}/);
});

test('Integrations distinguish granted consent from completed third-party installation', () => {
  assert.match(integrations, /n[aã]o confirma a instala[cç][aã]o/);
});
