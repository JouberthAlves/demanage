import { Prisma } from '@prisma/client';

import { dateKey, dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import {
  getAssetHistory,
  getAssetQuote,
  getCdiHistory,
  getIpcaHistory,
  type MarketPoint,
} from '@/lib/market-data';
import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';

type ExpenseWithSplits = Prisma.ExpenseGetPayload<{
  include: { splits: true };
}>;
type EntryRecord = Prisma.EntryGetPayload<{}>;
type AssetTx = Prisma.AssetTransactionGetPayload<{}>;
type PiggyTx = Prisma.PiggyTransactionGetPayload<{}>;

type CashFlow = {
  date: string;
  amount: Prisma.Decimal;
  external: boolean;
};

export class PatrimonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatrimonyError';
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampDay(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(Math.max(day, 1), last);
}

function amountForExpense(expense: ExpenseWithSplits) {
  if (expense.isInvoice) return decimal(expense.amount);
  if (expense.splits.length > 0) {
    return expense.splits
      .filter((split) => split.kind === 'pix')
      .reduce((sum, split) => sum.plus(split.amount), ZERO);
  }
  if (expense.cardId) return ZERO;
  return decimal(expense.amount);
}

function occurrenceMonths(from: Date, to: Date) {
  const result: Array<{ year: number; month: number }> = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  while (
    year < to.getUTCFullYear() ||
    (year === to.getUTCFullYear() && month <= to.getUTCMonth())
  ) {
    result.push({ year, month });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return result;
}

function buildCashFlows(args: {
  baseDate: Date;
  to: Date;
  expenses: ExpenseWithSplits[];
  entries: EntryRecord[];
  internalExpenseIds: Set<string>;
  internalEntryIds: Set<string>;
}) {
  const flows: CashFlow[] = [];
  const months = occurrenceMonths(args.baseDate, args.to);
  const baseKey = dateKey(args.baseDate);
  const toKey = dateKey(args.to);

  for (const expense of args.expenses) {
    const cash = amountForExpense(expense);
    if (cash.lte(0)) continue;
    const external = !args.internalExpenseIds.has(expense.id);

    if (expense.frequency === 'unica') {
      const when = dateKey(expense.occurredAt ?? expense.createdAt);
      if (when > baseKey && when <= toKey) {
        flows.push({ date: when, amount: cash.negated(), external });
      }
      continue;
    }

    for (const { year, month } of months) {
      const day = clampDay(year, month, expense.dueDay ?? 1);
      const when = new Date(Date.UTC(year, month, day, 12));
      const key = dateKey(when);
      if (key <= baseKey || key > toKey) continue;
      if (expense.startsAt && when < dateOnlyUtc(expense.startsAt)) continue;
      if (expense.endsAt && when > dateOnlyUtc(expense.endsAt)) continue;
      const multiplier =
        expense.frequency === 'semanal' ? decimal(4) : decimal(1);
      flows.push({
        date: key,
        amount: cash.mul(multiplier).negated(),
        external,
      });
    }
  }

  for (const entry of args.entries) {
    const amount = decimal(entry.amount);
    if (amount.lte(0)) continue;
    const external = !args.internalEntryIds.has(entry.id);

    if (entry.frequency === 'unica') {
      const when = dateKey(entry.date ?? entry.createdAt);
      if (when > baseKey && when <= toKey) {
        flows.push({ date: when, amount, external });
      }
      continue;
    }

    for (const { year, month } of months) {
      const day = clampDay(year, month, entry.receiveDay ?? 1);
      const when = new Date(Date.UTC(year, month, day, 12));
      const key = dateKey(when);
      if (key <= baseKey || key > toKey) continue;
      if (entry.startsAt && when < dateOnlyUtc(entry.startsAt)) continue;
      if (entry.endsAt && when > dateOnlyUtc(entry.endsAt)) continue;
      const multiplier =
        entry.frequency === 'semanal' ? decimal(4) : decimal(1);
      flows.push({ date: key, amount: amount.mul(multiplier), external });
    }
  }

  return flows;
}

function latestPointAtOrBefore(points: MarketPoint[], day: string) {
  let found: MarketPoint | null = null;
  for (const point of points) {
    if (point.date > day) break;
    found = point;
  }
  return found;
}

function sumPiggyAt(transactions: PiggyTx[], day: string) {
  return transactions.reduce((sum, transaction) => {
    if (dateKey(transaction.date) > day) return sum;
    return transaction.type === 'withdraw'
      ? sum.minus(transaction.amount)
      : sum.plus(transaction.amount);
  }, ZERO);
}

function assetQuantityAt(
  transactions: AssetTx[],
  asset: 'BTC' | 'USD',
  day: string,
) {
  return transactions.reduce((sum, transaction) => {
    if (transaction.asset !== asset || dateKey(transaction.date) > day) {
      return sum;
    }
    if (transaction.type === 'SELL') return sum.minus(transaction.quantity);
    return sum.plus(transaction.quantity);
  }, ZERO);
}

function percentDiff(value: Prisma.Decimal, reference: Prisma.Decimal) {
  if (reference.eq(0)) return null;
  return value.minus(reference).div(reference.abs()).mul(100);
}

export async function getPatrimonyHistory(
  userId: string,
  fromInput?: string,
  toInput?: string,
) {
  await catchUpPiggyInterest(userId);

  const settings = await prisma.patrimonySettings.findUnique({
    where: { userId },
  });
  if (!settings) {
    throw new PatrimonyError('Patrimônio ainda não configurado');
  }

  const today = dateOnlyUtc(new Date());
  const base = dateOnlyUtc(settings.baseDate);
  const requestedFrom = fromInput ? dateOnlyUtc(fromInput) : base;
  const requestedTo = toInput ? dateOnlyUtc(toInput) : today;
  const from = requestedFrom < base ? base : requestedFrom;
  const to = requestedTo > today ? today : requestedTo;
  if (from > to) throw new PatrimonyError('Período inválido');

  const [expenses, entries, assetTransactions, piggyTransactions] =
    await Promise.all([
      prisma.expense.findMany({
        where: { userId },
        include: { splits: true },
      }),
      prisma.entry.findMany({ where: { userId } }),
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
  for (const transaction of assetTransactions) {
    if (transaction.expenseId) internalExpenseIds.add(transaction.expenseId);
    if (transaction.entryId) internalEntryIds.add(transaction.entryId);
  }
  for (const transaction of piggyTransactions) {
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
  const flowsByDay = new Map<string, CashFlow[]>();
  for (const flow of flows) {
    const list = flowsByDay.get(flow.date) ?? [];
    list.push(flow);
    flowsByDay.set(flow.date, list);
  }

  const marketFrom = addDays(base, -10);
  const ipcaFrom = addDays(base, -800);
  const [btcSeries, usdSeries, cdiSeries, ipcaSeries, btcQuote, usdQuote] =
    await Promise.all([
      getAssetHistory('BTC', dateKey(marketFrom), dateKey(to)),
      getAssetHistory('USD', dateKey(marketFrom), dateKey(to)),
      getCdiHistory(dateKey(base), dateKey(to)),
      getIpcaHistory(dateKey(ipcaFrom), dateKey(to)),
      getAssetQuote('BTC'),
      getAssetQuote('USD'),
    ]);

  const todayKey = dateKey(today);
  if (dateKey(to) === todayKey) {
    btcSeries.points.push({ date: todayKey, value: btcQuote.value });
    usdSeries.points.push({ date: todayKey, value: usdQuote.value });
    btcSeries.points = dedupeMarket(btcSeries.points);
    usdSeries.points = dedupeMarket(usdSeries.points);
  }

  const baseKey = dateKey(base);
  const baseBtcPrice = latestPointAtOrBefore(btcSeries.points, baseKey);
  const baseUsdPrice = latestPointAtOrBefore(usdSeries.points, baseKey);
  if (!baseBtcPrice || !baseUsdPrice) {
    throw new PatrimonyError(
      'Histórico de cotação insuficiente para a data-base',
    );
  }

  const baseBtc = assetQuantityAt(assetTransactions, 'BTC', baseKey).mul(
    baseBtcPrice.value,
  );
  const baseUsd = assetQuantityAt(assetTransactions, 'USD', baseKey).mul(
    baseUsdPrice.value,
  );
  const basePiggy = sumPiggyAt(piggyTransactions, baseKey);
  let cash = decimal(settings.openingCashBrl);
  const baseReal = cash.plus(basePiggy).plus(baseBtc).plus(baseUsd);
  let cdiBenchmark = baseReal;
  let ipcaBenchmark = baseReal;
  let lastIpca = latestPointAtOrBefore(ipcaSeries.points, baseKey);

  const cdiMap = new Map(
    cdiSeries.points.map((point) => [point.date, decimal(point.value)]),
  );
  const ipcaMap = new Map(
    ipcaSeries.points.map((point) => [point.date, decimal(point.value)]),
  );
  const rows: Array<Record<string, string>> = [];

  let cursor = base;
  while (cursor <= to) {
    const key = dateKey(cursor);
    if (key !== baseKey) {
      const dayFlows = flowsByDay.get(key) ?? [];
      for (const flow of dayFlows) cash = cash.plus(flow.amount);
      const externalFlow = dayFlows
        .filter((flow) => flow.external)
        .reduce((sum, flow) => sum.plus(flow.amount), ZERO);

      const newIpca = ipcaMap.get(key);
      if (newIpca && lastIpca) {
        ipcaBenchmark = ipcaBenchmark.mul(newIpca).div(lastIpca.value);
        lastIpca = { date: key, value: newIpca.toString() };
      } else if (newIpca) {
        lastIpca = { date: key, value: newIpca.toString() };
      }
      ipcaBenchmark = ipcaBenchmark.plus(externalFlow);

      cdiBenchmark = cdiBenchmark.plus(externalFlow);
      const cdiRate = cdiMap.get(key);
      if (cdiRate) {
        cdiBenchmark = cdiBenchmark.mul(
          decimal(1).plus(cdiRate.div(100)),
        );
      }
    }

    if (cursor >= from) {
      const btcPrice = latestPointAtOrBefore(btcSeries.points, key);
      const usdPrice = latestPointAtOrBefore(usdSeries.points, key);
      if (!btcPrice || !usdPrice) {
        throw new PatrimonyError(`Cotação histórica ausente em ${key}`);
      }
      const piggy = sumPiggyAt(piggyTransactions, key);
      const btc = assetQuantityAt(assetTransactions, 'BTC', key).mul(
        btcPrice.value,
      );
      const usd = assetQuantityAt(assetTransactions, 'USD', key).mul(
        usdPrice.value,
      );
      const real = cash.plus(piggy).plus(btc).plus(usd);
      rows.push({
        date: key,
        patrimonyBrl: real.toString(),
        cashBrl: cash.toString(),
        piggyBrl: piggy.toString(),
        btcBrl: btc.toString(),
        usdBrl: usd.toString(),
        cdiBrl: cdiBenchmark.toString(),
        ipcaBrl: ipcaBenchmark.toString(),
      });
    }

    cursor = addDays(cursor, 1);
  }

  const latest = rows.at(-1);
  if (!latest) throw new PatrimonyError('Sem histórico patrimonial');
  const real = decimal(latest.patrimonyBrl);
  const cdi = decimal(latest.cdiBrl);
  const ipca = decimal(latest.ipcaBrl);

  return {
    settings: {
      baseDate: baseKey,
      openingCashBrl: settings.openingCashBrl.toString(),
    },
    summary: {
      patrimonyBrl: latest.patrimonyBrl,
      cashBrl: latest.cashBrl,
      piggyBrl: latest.piggyBrl,
      btcBrl: latest.btcBrl,
      usdBrl: latest.usdBrl,
      cdiBrl: latest.cdiBrl,
      ipcaBrl: latest.ipcaBrl,
      versusCdiBrl: real.minus(cdi).toString(),
      versusCdiPercent: percentDiff(real, cdi)?.toString() ?? null,
      versusIpcaBrl: real.minus(ipca).toString(),
      versusIpcaPercent: percentDiff(real, ipca)?.toString() ?? null,
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

function dedupeMarket(points: MarketPoint[]) {
  const map = new Map(points.map((point) => [point.date, point.value]));
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}

export async function savePatrimonySettings(
  userId: string,
  baseDateInput: unknown,
  openingCashInput: unknown,
) {
  const baseDate = dateOnlyUtc(String(baseDateInput ?? ''));
  if (Number.isNaN(baseDate.getTime())) {
    throw new PatrimonyError('Data-base inválida');
  }
  if (baseDate > dateOnlyUtc(new Date())) {
    throw new PatrimonyError('Data-base futura não é permitida');
  }

  let openingCash: Prisma.Decimal;
  try {
    openingCash = money(String(openingCashInput ?? ''));
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
