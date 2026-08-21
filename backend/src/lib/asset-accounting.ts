import type { Asset, AssetTransactionType } from '@prisma/client';

import { decimal, type DecimalLike, ZERO } from '@/lib/decimal';

export type AccountingTransaction = {
  id?: string;
  asset: Asset;
  type: AssetTransactionType;
  quantity: DecimalLike;
  cashAmountBrl: DecimalLike;
  feeAmountBrl?: DecimalLike;
  costBasisKnown: boolean;
  date: Date;
};

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
    .sort((left, right) => {
      const dateDiff = left.date.getTime() - right.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      return (left.id ?? '').localeCompare(right.id ?? '');
    });

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

      const removeQty = quantity.abs();
      const totalQty = knownQty.plus(unknownQty);
      if (totalQty.lte(0)) continue;
      const bounded = minDecimal(removeQty, totalQty);
      const knownShare = totalQty.eq(0) ? ZERO : knownQty.div(totalQty);
      const removeKnown = bounded.mul(knownShare);
      const removeUnknown = bounded.minus(removeKnown);
      const averageCost = knownQty.gt(0) ? knownCost.div(knownQty) : ZERO;
      knownQty = knownQty.minus(removeKnown);
      unknownQty = unknownQty.minus(removeUnknown);
      knownCost = knownCost.minus(averageCost.mul(removeKnown));
      if (removeUnknown.gt(0)) pnlComplete = false;
      continue;
    }

    if (transaction.type === 'SELL') {
      if (quantity.lte(0)) continue;
      const totalQty = knownQty.plus(unknownQty);
      if (totalQty.lte(0)) continue;
      const sold = minDecimal(quantity, totalQty);
      const knownShare = totalQty.eq(0) ? ZERO : knownQty.div(totalQty);
      const soldKnown = sold.mul(knownShare);
      const soldUnknown = sold.minus(soldKnown);
      const averageCost = knownQty.gt(0) ? knownCost.div(knownQty) : ZERO;
      const soldKnownCost = averageCost.mul(soldKnown);
      const knownCashShare = sold.eq(0) ? ZERO : soldKnown.div(sold);
      const receivedForKnown = cash.mul(knownCashShare);

      realizedPnl = realizedPnl.plus(receivedForKnown.minus(soldKnownCost));
      realizedCost = realizedCost.plus(soldKnownCost);
      knownQty = knownQty.minus(soldKnown);
      unknownQty = unknownQty.minus(soldUnknown);
      knownCost = knownCost.minus(soldKnownCost);
      if (soldUnknown.gt(0)) pnlComplete = false;
    }
  }

  const quantity = knownQty.plus(unknownQty);
  const averageCost = knownQty.gt(0) ? knownCost.div(knownQty) : null;

  return {
    asset,
    quantity: quantity.toString(),
    knownQuantity: knownQty.toString(),
    unknownQuantity: unknownQty.toString(),
    investedBrl: knownCost.toString(),
    averageCostBrl: averageCost?.toString() ?? null,
    feesBrl: fees.toString(),
    realizedPnlBrl: realizedPnl.toString(),
    realizedCostBasisBrl: realizedCost.toString(),
    pnlComplete,
  };
}

function minDecimal(
  left: ReturnType<typeof decimal>,
  right: ReturnType<typeof decimal>,
) {
  return left.lte(right) ? left : right;
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
    quoteBrl: quote.toString(),
    marketValueBrl: marketValue.toString(),
    unrealizedPnlBrl: unrealized.toString(),
    totalPnlBrl: total.toString(),
    totalPnlPercent: totalPercent?.toString() ?? null,
  };
}
