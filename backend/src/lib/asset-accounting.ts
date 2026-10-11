import type { Asset, AssetTransactionType } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { decimal, type DecimalLike, ZERO } from '@/lib/decimal';
import { plainDecimal } from '@/lib/money';

export type AccountingTransaction = {
  id?: string;
  createdAt?: Date;
  asset: Asset;
  type: AssetTransactionType;
  quantity: DecimalLike;
  cashAmountBrl: DecimalLike;
  feeAmountBrl?: DecimalLike;
  costBasisKnown: boolean;
  date: Date;
};

function compareTransactions(
  left: AccountingTransaction,
  right: AccountingTransaction,
) {
  const dateDiff = left.date.getTime() - right.date.getTime();
  if (dateDiff !== 0) return dateDiff;
  const createdAtDiff =
    (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
  if (createdAtDiff !== 0) return createdAtDiff;
  return (left.id ?? '').localeCompare(right.id ?? '');
}

export function isAssetTimelineValid(input: AccountingTransaction[]) {
  let balance = ZERO;
  const transactions = [...input].sort(compareTransactions);

  for (const transaction of transactions) {
    const quantity = decimal(transaction.quantity);
    if (transaction.type === 'BUY') {
      balance = balance.plus(quantity);
    } else if (transaction.type === 'SELL') {
      if (quantity.gt(balance)) return false;
      balance = balance.minus(quantity);
    } else {
      balance = balance.plus(quantity);
      if (balance.lt(0)) return false;
    }
  }

  return true;
}

export type AssetAccounting = {
  asset: Asset;
  quantity: string;
  knownQuantity: string;
  unknownQuantity: string;
  investedBrl: string;
  averageCostBrl: string | null;
  feesBrl: string;
  realizedPnlBrl: string;
  realizedCostBasisBrl: string;
  pnlComplete: boolean;
};

export function countDecimalPlaces(raw: unknown) {
  const value = String(raw).trim().toLowerCase();
  if (!value) return 0;
  if (value.includes('e')) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
    const fixed = parsed.toFixed(20).replace(/0+$/, '');
    return fixed.includes('.') ? fixed.split('.')[1].length : 0;
  }
  return value.includes('.') ? value.split('.')[1].length : 0;
}

export function calculateAssetAccounting(
  asset: Asset,
  input: AccountingTransaction[],
): AssetAccounting {
  let knownQty = ZERO;
  let unknownQty = ZERO;
  let knownCost = ZERO;
  let realizedPnl = ZERO;
  let realizedCost = ZERO;
  let fees = ZERO;
  let pnlComplete = true;

  const transactions = [...input]
    .filter((item) => item.asset === asset)
    .sort(compareTransactions);

  for (const transaction of transactions) {
    const quantity = decimal(transaction.quantity);
    const cash = decimal(transaction.cashAmountBrl);
    fees = fees.plus(decimal(transaction.feeAmountBrl ?? 0));

    if (transaction.type === 'BUY') {
      if (quantity.lte(0)) continue;
      if (transaction.costBasisKnown) {
        knownQty = knownQty.plus(quantity);
        knownCost = knownCost.plus(cash);
      } else {
        unknownQty = unknownQty.plus(quantity);
        pnlComplete = false;
      }
      continue;
    }

    if (transaction.type === 'MANUAL_ADJUSTMENT') {
      if (quantity.eq(0)) continue;
      if (quantity.gt(0)) {
        if (transaction.costBasisKnown && cash.gt(0)) {
          knownQty = knownQty.plus(quantity);
          knownCost = knownCost.plus(cash);
        } else {
          unknownQty = unknownQty.plus(quantity);
          pnlComplete = false;
        }
        continue;
      }

      const removal = removeFromBuckets(
        knownQty,
        unknownQty,
        knownCost,
        quantity.abs(),
      );
      if (removal.total.lte(0)) continue;
      knownQty = removal.knownQty;
      unknownQty = removal.unknownQty;
      knownCost = removal.knownCost;
      if (removal.removedUnknown.gt(0)) pnlComplete = false;
      continue;
    }

    if (transaction.type === 'SELL') {
      if (quantity.lte(0)) continue;
      const removal = removeFromBuckets(
        knownQty,
        unknownQty,
        knownCost,
        quantity,
      );
      if (removal.total.lte(0)) continue;
      const knownCashShare = removal.removed.eq(0)
        ? ZERO
        : removal.removedKnown.div(removal.removed);

      realizedPnl = realizedPnl.plus(
        cash.mul(knownCashShare).minus(removal.removedKnownCost),
      );
      realizedCost = realizedCost.plus(removal.removedKnownCost);
      knownQty = removal.knownQty;
      unknownQty = removal.unknownQty;
      knownCost = removal.knownCost;
      if (removal.removedUnknown.gt(0)) pnlComplete = false;
    }
  }

  const quantity = knownQty.plus(unknownQty);
  const averageCost = knownQty.gt(0) ? knownCost.div(knownQty) : null;

  return {
    asset,
    quantity: plainDecimal(quantity),
    knownQuantity: plainDecimal(knownQty),
    unknownQuantity: plainDecimal(unknownQty),
    investedBrl: plainDecimal(knownCost),
    averageCostBrl: averageCost ? plainDecimal(averageCost) : null,
    feesBrl: plainDecimal(fees),
    realizedPnlBrl: plainDecimal(realizedPnl),
    realizedCostBasisBrl: plainDecimal(realizedCost),
    pnlComplete,
  };
}

/** Stored quantities have at most 12 decimal places (Decimal(30,12)). */
const QUANTITY_SCALE = 12;

/**
 * Removes `requested` units (capped at what is held) from the known/unknown
 * buckets, EXACTLY: the known share is rounded once to the quantity scale and
 * clamped, so quantities stay exact multiples of 1e-12 and a full exit zeroes
 * both buckets and the cost basis (no "1e-20" residue with a stale cost).
 */
export function removeFromBuckets(
  knownQty: ReturnType<typeof decimal>,
  unknownQty: ReturnType<typeof decimal>,
  knownCost: ReturnType<typeof decimal>,
  requested: ReturnType<typeof decimal>,
) {
  const total = knownQty.plus(unknownQty);
  const none = {
    total,
    removed: ZERO,
    removedKnown: ZERO,
    removedUnknown: ZERO,
    removedKnownCost: ZERO,
    knownQty,
    unknownQty,
    knownCost,
  };
  if (total.lte(0) || requested.lte(0)) return none;

  const removed = requested.lte(total) ? requested : total;
  if (removed.eq(total)) {
    return {
      total,
      removed,
      removedKnown: knownQty,
      removedUnknown: unknownQty,
      removedKnownCost: knownCost,
      knownQty: ZERO,
      unknownQty: ZERO,
      knownCost: ZERO,
    };
  }

  let removedKnown = removed
    .mul(knownQty)
    .div(total)
    .toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  const mostKnown = removed.lte(knownQty) ? removed : knownQty;
  const leastKnown = removed.minus(unknownQty);
  if (removedKnown.gt(mostKnown)) removedKnown = mostKnown;
  if (removedKnown.lt(leastKnown)) removedKnown = leastKnown;
  if (removedKnown.lt(0)) removedKnown = ZERO;
  const removedUnknown = removed.minus(removedKnown);

  const nextKnownQty = knownQty.minus(removedKnown);
  const removedKnownCost = removedKnown.eq(knownQty)
    ? knownCost
    : knownQty.gt(0)
      ? knownCost.mul(removedKnown).div(knownQty)
      : ZERO;

  return {
    total,
    removed,
    removedKnown,
    removedUnknown,
    removedKnownCost,
    knownQty: nextKnownQty,
    unknownQty: unknownQty.minus(removedUnknown),
    knownCost: nextKnownQty.eq(0) ? ZERO : knownCost.minus(removedKnownCost),
  };
}

export function enrichAccountingWithQuote(
  accounting: AssetAccounting,
  quoteBrl: DecimalLike,
) {
  const quantity = decimal(accounting.quantity);
  const knownQuantity = decimal(accounting.knownQuantity);
  const quote = decimal(quoteBrl);
  const invested = decimal(accounting.investedBrl);
  const realized = decimal(accounting.realizedPnlBrl);
  const realizedCost = decimal(accounting.realizedCostBasisBrl);
  const marketValue = quantity.mul(quote);
  const knownMarketValue = knownQuantity.mul(quote);
  const unrealized = knownMarketValue.minus(invested);
  const total = realized.plus(unrealized);
  const denominator = realizedCost.plus(invested);
  const totalPercent = denominator.gt(0)
    ? total.div(denominator).mul(100)
    : null;

  return {
    ...accounting,
    quoteBrl: plainDecimal(quote),
    marketValueBrl: plainDecimal(marketValue),
    unrealizedPnlBrl: plainDecimal(unrealized),
    totalPnlBrl: plainDecimal(total),
    totalPnlPercent: totalPercent ? plainDecimal(totalPercent) : null,
  };
}
