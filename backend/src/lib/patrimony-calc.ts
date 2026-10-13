import { Prisma } from '@/generated/prisma/client';
import { splitShareFor } from '@/lib/billing/charges';
import {
  addDaysToKey,
  type DayKey,
  dayKeyInSaoPaulo,
  parseCivilDate,
  todayInSaoPaulo,
} from '@/lib/civil-date';
import { decimal, ZERO } from '@/lib/decimal';
import { DomainError } from '@/lib/errors';
import { createPointCursor } from '@/lib/market/series';
import type { MarketPoint } from '@/lib/market/types';
import { MAX_HISTORY_RANGE_DAYS } from '@/lib/market/types';
import { plainDecimal } from '@/lib/money';
import { signedAmount } from '@/lib/piggy/ledger';

/** Pure patrimony maths (no database import). DB side: lib/patrimony.ts. */

type ExpenseForFlows = {
  id: string;
  amount: Prisma.Decimal | string | number;
  isInvoice: boolean;
  cardId: string | null;
  frequency: string;
  startsAt: Date | null;
  endsAt: Date | null;
  occurredAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
  systemOrigin: string;
  splits: Array<{
    kind: string;
    cardId: string | null;
    amount: Prisma.Decimal | string | number;
  }>;
  payments: Array<{
    amount: Prisma.Decimal | string | number;
    paidAt: Date;
  }>;
};

type EntryForFlows = {
  id: string;
  amount: Prisma.Decimal | string | number;
  date: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
  systemOrigin: string;
  receipts: Array<{
    amount: Prisma.Decimal | string | number;
    receivedAt: Date;
  }>;
};

export type CashFlow = {
  date: string;
  amount: Prisma.Decimal;
  external: boolean;
};

export class PatrimonyError extends DomainError {
  constructor(message: string) {
    super(message, 'PATRIMONY');
  }
}

/** Strict YYYY-MM-DD -> noon-UTC Date. */
export function parseHistoryDate(value: string) {
  const date = parseCivilDate(value, 'noon');
  if (!date) throw new PatrimonyError('Data inválida');
  return date;
}

/** Earliest day the timeline is computed from (range stays within the cap). */
export function calculationStart(base: Date, today: Date) {
  const earliest = new Date(
    today.getTime() - (MAX_HISTORY_RANGE_DAYS - 1) * 86_400_000,
  );
  return base < earliest ? earliest : base;
}

export function patrimonyToday(now = new Date()) {
  return todayInSaoPaulo(now);
}

export function buildCashFlows(args: {
  baseDate: Date;
  to: Date;
  expenses: ExpenseForFlows[];
  entries: EntryForFlows[];
  internalExpenseIds: Set<string>;
  internalEntryIds: Set<string>;
}) {
  const flows: CashFlow[] = [];
  const baseKey = dayKeyInSaoPaulo(args.baseDate);
  const toKey = dayKeyInSaoPaulo(args.to);

  for (const expense of args.expenses) {
    const external = !args.internalExpenseIds.has(expense.id);
    if (expense.systemOrigin !== 'manual') {
      // Piggy/asset ledger rows: the money leaving cash is the cash share.
      if (expense.archivedAt) continue;
      const amount = splitShareFor(expense, { kind: 'cash' });
      const when = dayKeyInSaoPaulo(expense.occurredAt ?? expense.createdAt);
      if (amount.gt(0) && when > baseKey && when <= toKey) {
        flows.push({ date: when, amount: amount.negated(), external: false });
      }
    } else if (expense.payments.length > 0) {
      for (const payment of expense.payments) {
        const when = dayKeyInSaoPaulo(payment.paidAt);
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
      const when = dayKeyInSaoPaulo(entry.date ?? entry.createdAt);
      if (amount.gt(0) && when > baseKey && when <= toKey) {
        flows.push({ date: when, amount, external: false });
      }
    } else if (entry.receipts.length > 0) {
      for (const receipt of entry.receipts) {
        const when = dayKeyInSaoPaulo(receipt.receivedAt);
        const amount = decimal(receipt.amount);
        if (amount.gt(0) && when > baseKey && when <= toKey) {
          flows.push({ date: when, amount, external });
        }
      }
    }
  }

  return flows;
}

/**
 * Running total over (day, delta) steps, read at ascending days. Replaces
 * the old per-day full rescans (O(days x N)) with one pass.
 */
export function createRunningTotal(
  items: Array<{ day: DayKey; delta: Prisma.Decimal }>,
) {
  const sorted = [...items].sort((a, b) => a.day.localeCompare(b.day));
  let index = 0;
  let total = ZERO;
  return {
    /** Total of every step dated on or before `day`; `day` must not decrease. */
    at(day: DayKey) {
      while (index < sorted.length && sorted[index].day <= day) {
        total = total.plus(sorted[index].delta);
        index += 1;
      }
      return total;
    },
  };
}

export function percentDiff(
  value: Prisma.Decimal,
  reference: Prisma.Decimal,
) {
  if (reference.eq(0)) return null;
  return value.minus(reference).div(reference.abs()).mul(100);
}

/** Adds today's live quote to a (possibly shared) series WITHOUT mutating it. */
export function withTodayPoint(
  points: MarketPoint[],
  todayKey: DayKey,
  value: string,
): MarketPoint[] {
  return [...points.filter((point) => point.date !== todayKey), { date: todayKey, value }]
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type PatrimonyRow = {
  date: string;
  patrimonyBrl: string;
  cashBrl: string;
  piggyBrl: string;
  btcBrl: string;
  usdBrl: string;
  cdiBrl: string;
  ipcaBrl: string;
};

/**
 * The daily patrimony timeline. All inputs are plain data; every lookup is a
 * moving pointer, so the cost is O(days + rows), not O(days x transactions).
 */
export function buildPatrimonyRows(args: {
  storedBaseKey: DayKey;
  calculationBaseKey: DayKey;
  fromKey: DayKey;
  toKey: DayKey;
  openingCash: Prisma.Decimal;
  flows: CashFlow[];
  piggyTransactions: Array<{
    type: string;
    amount: Prisma.Decimal | string | number;
    date: Date;
  }>;
  assetTransactions: Array<{
    asset: string;
    type: string;
    quantity: Prisma.Decimal | string | number;
    date: Date;
  }>;
  btcPoints: MarketPoint[];
  usdPoints: MarketPoint[];
  cdiPoints: MarketPoint[];
  ipcaPoints: MarketPoint[];
}): PatrimonyRow[] {
  const flowsByDay = new Map<string, CashFlow[]>();
  for (const flow of args.flows) {
    const list = flowsByDay.get(flow.date) ?? [];
    list.push(flow);
    flowsByDay.set(flow.date, list);
  }

  const piggy = createRunningTotal(
    args.piggyTransactions.map((transaction) => ({
      day: dayKeyInSaoPaulo(transaction.date),
      delta: signedAmount(transaction.type, transaction.amount),
    })),
  );
  const quantityOf = (asset: 'BTC' | 'USD') =>
    createRunningTotal(
      args.assetTransactions
        .filter((transaction) => transaction.asset === asset)
        .map((transaction) => ({
          day: dayKeyInSaoPaulo(transaction.date),
          delta:
            transaction.type === 'SELL'
              ? decimal(transaction.quantity).negated()
              : decimal(transaction.quantity),
        })),
    );
  const btcQuantity = quantityOf('BTC');
  const usdQuantity = quantityOf('USD');
  const btcPrice = createPointCursor(args.btcPoints);
  const usdPrice = createPointCursor(args.usdPoints);
  const ipcaCursor = createPointCursor(args.ipcaPoints);

  const baseKey = args.calculationBaseKey;
  const baseBtcPrice = btcPrice.at(baseKey);
  const baseUsdPrice = usdPrice.at(baseKey);
  if (!baseBtcPrice || !baseUsdPrice) {
    throw new PatrimonyError(
      'Histórico de cotação insuficiente para a data-base',
    );
  }

  let cash = decimal(args.openingCash);
  for (const flow of args.flows) {
    if (flow.date > args.storedBaseKey && flow.date <= baseKey) {
      cash = cash.plus(flow.amount);
    }
  }
  const baseReal = cash
    .plus(piggy.at(baseKey))
    .plus(btcQuantity.at(baseKey).mul(baseBtcPrice.value))
    .plus(usdQuantity.at(baseKey).mul(baseUsdPrice.value));

  let cdiBenchmark = baseReal;
  let ipcaBenchmark = baseReal;
  let lastIpcaValue: Prisma.Decimal | null = (() => {
    const found = ipcaCursor.at(baseKey);
    return found ? decimal(found.value) : null;
  })();
  const cdiMap = new Map(
    args.cdiPoints.map((point) => [point.date, decimal(point.value)]),
  );
  const ipcaMap = new Map(
    args.ipcaPoints.map((point) => [point.date, decimal(point.value)]),
  );

  const rows: PatrimonyRow[] = [];
  for (let key = baseKey; key <= args.toKey; key = addDaysToKey(key, 1)) {
    if (key !== baseKey) {
      const dayFlows = flowsByDay.get(key) ?? [];
      let externalFlow = ZERO;
      for (const flow of dayFlows) {
        cash = cash.plus(flow.amount);
        if (flow.external) externalFlow = externalFlow.plus(flow.amount);
      }

      const newIpca = ipcaMap.get(key);
      if (newIpca) {
        if (lastIpcaValue) {
          ipcaBenchmark = ipcaBenchmark.mul(newIpca).div(lastIpcaValue);
        }
        lastIpcaValue = newIpca;
      }
      ipcaBenchmark = ipcaBenchmark.plus(externalFlow);

      cdiBenchmark = cdiBenchmark.plus(externalFlow);
      const cdiRate = cdiMap.get(key);
      if (cdiRate) {
        cdiBenchmark = cdiBenchmark.mul(decimal(1).plus(cdiRate.div(100)));
      }
    }

    if (key >= args.fromKey) {
      const btcQuote = btcPrice.at(key);
      const usdQuote = usdPrice.at(key);
      if (!btcQuote || !usdQuote) {
        throw new PatrimonyError(`Cotação histórica ausente em ${key}`);
      }
      const piggyBalance = piggy.at(key);
      const btc = btcQuantity.at(key).mul(btcQuote.value);
      const usd = usdQuantity.at(key).mul(usdQuote.value);
      rows.push({
        date: key,
        patrimonyBrl: plainDecimal(cash.plus(piggyBalance).plus(btc).plus(usd)),
        cashBrl: plainDecimal(cash),
        piggyBrl: plainDecimal(piggyBalance),
        btcBrl: plainDecimal(btc),
        usdBrl: plainDecimal(usd),
        cdiBrl: plainDecimal(cdiBenchmark),
        ipcaBrl: plainDecimal(ipcaBenchmark),
      });
    }
  }
  return rows;
}
