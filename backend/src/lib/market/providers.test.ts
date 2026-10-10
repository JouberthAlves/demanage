import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@/generated/prisma/client';
import { diffDays } from '@/lib/civil-date';
import { parseAwesomeHistory, parseAwesomeQuote } from '@/lib/market/providers/awesomeapi';
import { bcbRangeUrl, parseBcbBody, parseBcbRows } from '@/lib/market/providers/bcb';
import {
  coinbaseCandlesUrl,
  coinbaseCandleWindows,
  parseCoinbaseCandles,
  parseCoinbaseSpot,
} from '@/lib/market/providers/coinbase';
import { ipcaPeriodRange, parseSidraIpca } from '@/lib/market/providers/ibge';
import { parseMercadoBitcoinTicker } from '@/lib/market/providers/mercadobitcoin';
import { parseYahooBtcBrl } from '@/lib/market/providers/yahoo';

test('BCB rows parse comma decimals and skip malformed rows', () => {
  assert.deepEqual(
    parseBcbRows([
      { data: '05/10/2026', valor: '0,055131' },
      { data: '06/10/2026', valor: '0.055131' },
      { data: 'bad', valor: '1' },
      { data: '07/10/2026', valor: 'abc' },
      { data: '08/10/2026', valor: '-1' },
      { data: '09/10/2026' },
    ]),
    [
      { date: '2026-10-05', value: '0.055131' },
      { date: '2026-10-06', value: '0.055131' },
    ],
  );
  assert.equal(
    bcbRangeUrl(12, '2026-01-02', '2026-03-04'),
    'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2026&dataFinal=04/03/2026',
  );
});

test('BCB bodies: 404-as-JSON and null mean no data, anything else throws', () => {
  assert.deepEqual(parseBcbBody(null), []);
  assert.deepEqual(parseBcbBody({ erro: { statusCode: 404 } }), []);
  assert.deepEqual(parseBcbBody([{ data: '01/01/2026', valor: '1' }]).length, 1);
  assert.throws(() => parseBcbBody({ erro: { statusCode: 500 } }), /BCB/);
});

test('AwesomeAPI quote and history parsing', () => {
  assert.equal(parseAwesomeQuote({ USDBRL: { bid: '5.4321' } }), '5.4321');
  assert.throws(() => parseAwesomeQuote({}), /USD/);
  const points = parseAwesomeHistory(
    [
      { bid: '5.40', timestamp: String(Date.UTC(2026, 9, 5, 15) / 1000) },
      { bid: '0', timestamp: String(Date.UTC(2026, 9, 6, 15) / 1000) },
      { bid: '5.50', create_date: '2026-10-07 10:00:00' },
      { bid: '5.60', create_date: '2025-01-01 10:00:00' },
    ],
    '2026-10-01',
    '2026-10-31',
  );
  assert.deepEqual(points, [
    { date: '2026-10-05', value: '5.4' },
    { date: '2026-10-07', value: '5.5' },
  ]);
});

test('Coinbase fallback is chunked into windows of at most 300 candles', () => {
  const windows = coinbaseCandleWindows('2024-01-01', '2026-10-01');
  assert.ok(windows.length > 3);
  assert.equal(windows[0].from, '2024-01-01');
  assert.equal(windows.at(-1)?.to, '2026-10-01');
  for (let index = 0; index < windows.length; index += 1) {
    assert.ok(diffDays(windows[index].to, windows[index].from) + 1 <= 300);
    if (index > 0) {
      assert.equal(diffDays(windows[index].from, windows[index - 1].to), 1);
    }
  }
  assert.throws(() => coinbaseCandlesUrl('2024-01-01', '2026-10-01'), /limite/);
  assert.match(
    coinbaseCandlesUrl('2026-01-01', '2026-02-01'),
    /start=2026-01-01T00:00:00Z&end=2026-02-01T23:59:59Z/,
  );
});

test('Coinbase candles and spot parsing', () => {
  const day = Date.UTC(2026, 9, 5) / 1000;
  assert.deepEqual(
    parseCoinbaseCandles(
      [
        [day, 1, 2, 3, 350000.123, 10],
        [day + 86_400, 1, 2, 3, 0, 10],
        [day - 40 * 86_400, 1, 2, 3, 100, 10],
      ],
      '2026-10-01',
      '2026-10-31',
    ),
    [{ date: '2026-10-05', value: '350000.12' }],
  );
  assert.throws(() => parseCoinbaseCandles({}, '2026-10-01', '2026-10-31'), /BTC/);
  assert.equal(parseCoinbaseSpot({ data: { amount: '350000.5' } }), '350000.5');
  assert.equal(parseCoinbaseSpot({ data: { amount: 'x' } }), null);
  assert.equal(parseMercadoBitcoinTicker({ ticker: { last: '351000' } }), '351000');
  assert.throws(() => parseMercadoBitcoinTicker({}), /BTC/);
});

test('Yahoo closes are converted with the USD/BRL on or before the day', () => {
  const usd = new Map([
    ['2026-10-02', new Prisma.Decimal('5')],
    ['2026-10-06', new Prisma.Decimal('6')],
  ]);
  const t = (d: string) => Date.UTC(2026, 9, Number(d)) / 1000;
  const points = parseYahooBtcBrl(
    {
      chart: {
        result: [
          {
            timestamp: [t('01'), t('03'), t('06')],
            indicators: { quote: [{ close: [100, 100, null] }] },
          },
        ],
      },
    },
    usd,
    '2026-10-01',
    '2026-10-31',
  );
  assert.deepEqual(points, [{ date: '2026-10-03', value: '500.00' }]);
});

test('SIDRA IPCA: index takes effect on the 15th of the following month', () => {
  const rows = [
    { D3C: 'Período', V: 'Valor' },
    { D3C: '202508', V: '4200,50' },
    { D3C: '202512', V: '7000,5' },
    { D3C: '202601', V: '...' },
  ];
  const points = parseSidraIpca(rows, '2025-01-01', '2026-12-31', '2026-10-10');
  assert.deepEqual(points, [
    { date: '2025-09-15', value: '4200.5' },
    { date: '2026-01-15', value: '7000.5' },
  ]);
  // Not yet effective -> excluded.
  assert.deepEqual(parseSidraIpca(rows, '2025-01-01', '2026-12-31', '2025-09-14'), []);
  assert.equal(ipcaPeriodRange(new Date('2026-09-01T12:00:00Z'), new Date('2026-09-10T12:00:00Z')), null);
});
