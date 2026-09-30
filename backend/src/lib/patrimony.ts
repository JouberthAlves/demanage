import { Prisma } from '@/generated/prisma/client';

import { dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import { dateKeyInSaoPaulo, todayInSaoPaulo } from '@/lib/card-billing';
import {
  MAX_HISTORY_RANGE_DAYS,
  getAssetHistory,
  getAssetQuote,
  getCdiHistory,
  getIpcaHistory,
  type MarketPoint,
} from '@/lib/market-data';
import { prisma } from '@/lib/prisma';

type ExpenseWithSplits = Prisma.ExpenseGetPayload<{
  include: { splits: true; payments: true };
}>;
type EntryRecord = Prisma.EntryGetPayload<{ include: { receipts: true } }>;
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

function parseHistoryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PatrimonyError('Data inválida');
  }
  const date = dateOnlyUtc(value);
  if (Number.isNaN(date.getTime()) || dateKeyInSaoPaulo(date) !== value) {
    throw new PatrimonyError('Data inválida');
  }
  return date;
}

export function calculationStart(base: Date, today: Date) {
  const earliest = addDays(today, 11 - MAX_HISTORY_RANGE_DAYS);
  return base < earliest ? earliest : base;
}

export function patrimonyToday(now = new Date()) {
  return dateOnlyUtc(todayInSaoPaulo(now));
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

export function buildCashFlows(args: {
  baseDate: Date;
  to: Date;
  expenses: ExpenseWithSplits[];
  entries: EntryRecord[];
  internalExpenseIds: Set<string>;
  internalEntryIds: Set<string>;
}) {
  const flows: CashFlow[] = [];
  const baseKey = dateKeyInSaoPaulo(args.baseDate);
  const toKey = dateKeyInSaoPaulo(args.to);

  for (const expense of args.expenses) {
    const external = !args.internalExpenseIds.has(expense.id);
    if (expense.systemOrigin !== 'manual') {
      if (expense.archivedAt) continue;
      const amount = amountForExpense(expense);
      const when = dateKeyInSaoPaulo(expense.occurredAt ?? expense.createdAt);
      if (amount.gt(0) && when > baseKey && when <= toKey) {
        flows.push({ date: when, amount: amount.negated(), external: false });
      }
    } else if (expense.payments.length > 0) {
      for (const payment of expense.payments) {
        const when = dateKeyInSaoPaulo(payment.paidAt);
        const amount = decimal(payment.amount);
        if (amount.gt(0) && when > baseKey && when <= toKey) {
          flows.push({ date: when, amount: amount.negated(), external });
        }
      }
    }
  }

  for (const entry of args.entries) {
    const external = !args.internalEntryIds.has(entry.id);
    if (entry.systemOrigin !== 'manual') {
      if (entry.archivedAt) continue;
      const amount = decimal(entry.amount);
      const when = dateKeyInSaoPaulo(entry.date ?? entry.createdAt);
      if (amount.gt(0) && when > baseKey && when <= toKey) {
        flows.push({ date: when, amount, external: false });
      }
    } else if (entry.receipts.length > 0) {
      for (const receipt of entry.receipts) {
        const when = dateKeyInSaoPaulo(receipt.receivedAt);
        const amount = decimal(receipt.amount);
        if (amount.gt(0) && when > baseKey && when <= toKey) {
          flows.push({ date: when, amount, external });
        }
      }
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
    if (dateKeyInSaoPaulo(transaction.date) > day) return sum;
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
    if (
      transaction.asset !== asset ||
      dateKeyInSaoPaulo(transaction.date) > day
    ) {
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
  now = new Date(),
) {
  const settings = await prisma.patrimonySettings.findUnique({
    where: { userId },
  });
  if (!settings) {
    throw new PatrimonyError('Patrimônio ainda não configurado');
  }

  const today = patrimonyToday(now);
  const base = dateOnlyUtc(settings.baseDate);
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

  const calculationBaseKey = dateKeyInSaoPaulo(calculationBase);
  const storedBaseKey = dateKeyInSaoPaulo(base);
  const marketFrom = addDays(calculationBase, -10);
  const ipcaFrom = addDays(calculationBase, -800);
  const [btcSeries, usdSeries, cdiSeries, ipcaSeries, btcQuote, usdQuote] =
    await Promise.all([
      getAssetHistory('BTC', dateKeyInSaoPaulo(marketFrom), dateKeyInSaoPaulo(to)),
      getAssetHistory('USD', dateKeyInSaoPaulo(marketFrom), dateKeyInSaoPaulo(to)),
      getCdiHistory(calculationBaseKey, dateKeyInSaoPaulo(to)),
      getIpcaHistory(dateKeyInSaoPaulo(ipcaFrom), dateKeyInSaoPaulo(to)),
      getAssetQuote('BTC'),
      getAssetQuote('USD'),
    ]);

  const todayKey = dateKeyInSaoPaulo(today);
  if (dateKeyInSaoPaulo(to) === todayKey) {
    btcSeries.points.push({ date: todayKey, value: btcQuote.value });
    usdSeries.points.push({ date: todayKey, value: usdQuote.value });
    btcSeries.points = dedupeMarket(btcSeries.points);
    usdSeries.points = dedupeMarket(usdSeries.points);
  }

  const baseBtcPrice = latestPointAtOrBefore(
    btcSeries.points,
    calculationBaseKey,
  );
  const baseUsdPrice = latestPointAtOrBefore(
    usdSeries.points,
    calculationBaseKey,
  );
  if (!baseBtcPrice || !baseUsdPrice) {
    throw new PatrimonyError(
      'Histórico de cotação insuficiente para a data-base',
    );
  }

  const baseBtc = assetQuantityAt(
    assetTransactions,
    'BTC',
    calculationBaseKey,
  ).mul(baseBtcPrice.value);
  const baseUsd = assetQuantityAt(
    assetTransactions,
    'USD',
    calculationBaseKey,
  ).mul(baseUsdPrice.value);
  const basePiggy = sumPiggyAt(piggyTransactions, calculationBaseKey);
  let cash = flows.reduce(
    (balance, flow) =>
      flow.date > storedBaseKey && flow.date <= calculationBaseKey
        ? balance.plus(flow.amount)
        : balance,
    decimal(settings.openingCashBrl),
  );
  const baseReal = cash.plus(basePiggy).plus(baseBtc).plus(baseUsd);
  let cdiBenchmark = baseReal;
  let ipcaBenchmark = baseReal;
  let lastIpca = latestPointAtOrBefore(ipcaSeries.points, calculationBaseKey);

  const cdiMap = new Map(
    cdiSeries.points.map((point) => [point.date, decimal(point.value)]),
  );
  const ipcaMap = new Map(
    ipcaSeries.points.map((point) => [point.date, decimal(point.value)]),
  );
  const rows: Array<Record<string, string>> = [];

  let cursor = calculationBase;
  while (cursor <= to) {
    const key = dateKeyInSaoPaulo(cursor);
    if (key !== calculationBaseKey) {
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
        cdiBenchmark = cdiBenchmark.mul(decimal(1).plus(cdiRate.div(100)));
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
      baseDate: storedBaseKey,
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
  now = new Date(),
) {
  const baseDate = parseHistoryDate(String(baseDateInput ?? ''));
  const today = patrimonyToday(now);
  if (baseDate > today) {
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
