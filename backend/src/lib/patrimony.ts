import type { Prisma } from '@/generated/prisma/client';
import { dayKeyInSaoPaulo } from '@/lib/civil-date';
import { decimal } from '@/lib/decimal';
import {
  getAssetHistory,
  getAssetQuote,
  getCdiHistory,
  getIpcaHistory,
} from '@/lib/market';
import { plainDecimal, toMoney } from '@/lib/money';
import {
  buildCashFlows,
  buildPatrimonyRows,
  calculationStart,
  parseHistoryDate,
  PatrimonyError,
  patrimonyToday,
  percentDiff,
  withTodayPoint,
} from '@/lib/patrimony-calc';
import { prisma } from '@/lib/prisma';

// Pure maths lives in lib/patrimony-calc.ts; re-exported for callers.
export {
  buildCashFlows,
  calculationStart,
  PatrimonyError,
  patrimonyToday,
} from '@/lib/patrimony-calc';

/** Days before the base date used to find the last price/index before it. */
const PRICE_LOOKBACK_DAYS = 10;
const IPCA_LOOKBACK_DAYS = 60;

export async function getPatrimonyHistory(
  userId: string,
  fromInput?: string,
  toInput?: string,
  now = new Date(),
) {
  const settings = await prisma.patrimonySettings.findUnique({
    where: { userId },
  });
  if (!settings) {
    throw new PatrimonyError('Patrimônio ainda não configurado');
  }

  const today = patrimonyToday(now);
  const base = new Date(
    Date.UTC(
      settings.baseDate.getUTCFullYear(),
      settings.baseDate.getUTCMonth(),
      settings.baseDate.getUTCDate(),
      12,
    ),
  );
  const requestedFrom = fromInput ? parseHistoryDate(fromInput) : base;
  const requestedTo = toInput ? parseHistoryDate(toInput) : today;
  if (requestedFrom > today || requestedTo > today) {
    throw new PatrimonyError('Data futura não permitida');
  }
  const calculationBase = calculationStart(base, today);
  const from =
    requestedFrom < calculationBase ? calculationBase : requestedFrom;
  const to = requestedTo > today ? today : requestedTo;
  if (from > to) throw new PatrimonyError('Período inválido');

  const [expenses, entries, assetTransactions, piggyTransactions] =
    await Promise.all([
      prisma.expense.findMany({
        where: { userId },
        include: { splits: true, payments: true },
      }),
      prisma.entry.findMany({ where: { userId }, include: { receipts: true } }),
      prisma.assetTransaction.findMany({
        where: { userId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.piggyTransaction.findMany({
        where: { userId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

  const internalExpenseIds = new Set<string>();
  const internalEntryIds = new Set<string>();
  for (const transaction of [...assetTransactions, ...piggyTransactions]) {
    if (transaction.expenseId) internalExpenseIds.add(transaction.expenseId);
    if (transaction.entryId) internalEntryIds.add(transaction.entryId);
  }

  const flows = buildCashFlows({
    baseDate: base,
    to,
    expenses,
    entries,
    internalExpenseIds,
    internalEntryIds,
  });

  const calculationBaseKey = dayKeyInSaoPaulo(calculationBase);
  const storedBaseKey = dayKeyInSaoPaulo(base);
  const toKey = dayKeyInSaoPaulo(to);
  const todayKey = dayKeyInSaoPaulo(today);

  // The history cap applies to [calculationBase, to] only; look-backs are
  // added by the market layer on top of it.
  const [btcSeries, usdSeries, cdiSeries, ipcaSeries, btcQuote, usdQuote] =
    await Promise.all([
      getAssetHistory('BTC', calculationBaseKey, toKey, {
        lookbackDays: PRICE_LOOKBACK_DAYS,
      }),
      getAssetHistory('USD', calculationBaseKey, toKey, {
        lookbackDays: PRICE_LOOKBACK_DAYS,
      }),
      getCdiHistory(calculationBaseKey, toKey),
      getIpcaHistory(calculationBaseKey, toKey, {
        lookbackDays: IPCA_LOOKBACK_DAYS,
      }),
      getAssetQuote('BTC'),
      getAssetQuote('USD'),
    ]);

  // Series are copies, but never mutate them anyway: build new arrays.
  const includeToday = toKey === todayKey;
  const btcPoints = includeToday
    ? withTodayPoint(btcSeries.points, todayKey, btcQuote.value)
    : btcSeries.points;
  const usdPoints = includeToday
    ? withTodayPoint(usdSeries.points, todayKey, usdQuote.value)
    : usdSeries.points;

  const rows = buildPatrimonyRows({
    storedBaseKey,
    calculationBaseKey,
    fromKey: dayKeyInSaoPaulo(from),
    toKey,
    openingCash: decimal(settings.openingCashBrl),
    flows,
    piggyTransactions,
    assetTransactions,
    btcPoints,
    usdPoints,
    cdiPoints: cdiSeries.points,
    ipcaPoints: ipcaSeries.points,
  });

  const latest = rows.at(-1);
  if (!latest) throw new PatrimonyError('Sem histórico patrimonial');
  const real = decimal(latest.patrimonyBrl);
  const cdi = decimal(latest.cdiBrl);
  const ipca = decimal(latest.ipcaBrl);

  return {
    settings: {
      baseDate: storedBaseKey,
      openingCashBrl: plainDecimal(settings.openingCashBrl),
    },
    summary: {
      patrimonyBrl: latest.patrimonyBrl,
      cashBrl: latest.cashBrl,
      piggyBrl: latest.piggyBrl,
      btcBrl: latest.btcBrl,
      usdBrl: latest.usdBrl,
      cdiBrl: latest.cdiBrl,
      ipcaBrl: latest.ipcaBrl,
      versusCdiBrl: plainDecimal(real.minus(cdi)),
      versusCdiPercent: stringOrNull(percentDiff(real, cdi)),
      versusIpcaBrl: plainDecimal(real.minus(ipca)),
      versusIpcaPercent: stringOrNull(percentDiff(real, ipca)),
    },
    stale: {
      btc: btcSeries.stale || btcQuote.stale,
      usd: usdSeries.stale || usdQuote.stale,
      cdi: cdiSeries.stale,
      ipca: ipcaSeries.stale,
    },
    history: rows,
  };
}

function stringOrNull(value: Prisma.Decimal | null) {
  return value ? plainDecimal(value) : null;
}

export async function savePatrimonySettings(
  userId: string,
  baseDateInput: unknown,
  openingCashInput: unknown,
  now = new Date(),
) {
  const baseDate = parseHistoryDate(String(baseDateInput ?? ''));
  const today = patrimonyToday(now);
  if (baseDate > today) {
    throw new PatrimonyError('Data-base futura não é permitida');
  }

  let openingCash: Prisma.Decimal;
  try {
    openingCash = toMoney(String(openingCashInput ?? ''));
    if (!openingCash.isFinite()) throw new Error();
  } catch {
    throw new PatrimonyError('Saldo inicial inválido');
  }

  return prisma.patrimonySettings.upsert({
    where: { userId },
    update: { baseDate, openingCashBrl: openingCash },
    create: { userId, baseDate, openingCashBrl: openingCash },
  });
}
