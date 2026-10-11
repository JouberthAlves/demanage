import type { Card } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import {
  type CycleWindow,
  maxChargesForWindow,
  maxChargesPerCycle,
} from '@/lib/billing/charges';
import { DomainError } from '@/lib/errors';
import { allocateByPercent, toMoney } from '@/lib/money';

/** Pure split logic (no database import). DB helpers: lib/expense-splits.ts. */

export type SplitInput =
  | { kind: 'card'; cardId: string; percent: number }
  | { kind: 'pix'; percent: number };

export type ResolvedSplit = {
  kind: 'card' | 'pix';
  cardId: string | null;
  percent: number;
  amount: number;
};

export class ExpenseSplitError extends DomainError {
  constructor(message: string) {
    super(message, 'EXPENSE_SPLIT_INVALID');
  }
}

/**
 * Cent-exact allocation: every part but the last is HALF_UP rounded to cents
 * and the last part takes the remainder, so the parts always sum to `total`.
 * (R$ 19,99 at 50/50 -> 10,00 + 9,99.)
 */
export function allocateSplitAmounts(
  total: number,
  parts: Array<{
    kind: 'card' | 'pix';
    cardId: string | null;
    percent: number;
  }>,
): ResolvedSplit[] {
  const amounts = allocateByPercent(
    total,
    parts.map((part) => part.percent),
  );
  return parts.map((part, index) => ({
    kind: part.kind,
    cardId: part.cardId,
    percent: toMoney(part.percent).toNumber(),
    amount: amounts[index].toNumber(),
  }));
}

export function normalizeSplitInputs(args: {
  splits: unknown;
  cardId: unknown;
}): SplitInput[] | null {
  const { splits, cardId } = args;

  if (splits === undefined) {
    if (cardId) {
      return [{ kind: 'card', cardId: String(cardId), percent: 100 }];
    }
    return null;
  }

  if (splits === null) {
    return [];
  }

  if (!Array.isArray(splits)) {
    throw new ExpenseSplitError('Splits inválidos');
  }

  if (splits.length === 0) {
    return [];
  }

  const normalized: SplitInput[] = splits.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new ExpenseSplitError('Splits inválidos');
    }
    const item = raw as Record<string, unknown>;
    const percent = Number(item.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new ExpenseSplitError('Percentual inválido (use valores > 0)');
    }

    if (item.kind === 'pix') {
      return { kind: 'pix', percent };
    }

    if (item.kind === 'card' || item.cardId) {
      const id = typeof item.cardId === 'string' ? item.cardId.trim() : '';
      if (!id) throw new ExpenseSplitError('Cartão obrigatório no split');
      return { kind: 'card', cardId: id, percent };
    }

    throw new ExpenseSplitError('Split deve ser cartão ou PIX');
  });

  return normalized;
}

export function validateSplitShape(inputs: SplitInput[]) {
  if (inputs.length === 0) return;

  if (inputs.length > 2) {
    throw new ExpenseSplitError('No máximo 2 partes no split');
  }

  const percentSum = inputs.reduce(
    (sum, item) => sum.plus(item.percent),
    new Prisma.Decimal(0),
  );
  if (percentSum.minus(100).abs().gt('0.01')) {
    throw new ExpenseSplitError('A soma dos percentuais deve ser 100%');
  }

  const pixCount = inputs.filter((item) => item.kind === 'pix').length;
  const cardInputs = inputs.filter(
    (item): item is Extract<SplitInput, { kind: 'card' }> =>
      item.kind === 'card',
  );

  if (pixCount > 1) {
    throw new ExpenseSplitError('Só é permitido um split PIX');
  }

  if (pixCount === 1 && inputs.length === 1) {
    throw new ExpenseSplitError('PIX 100% não usa split — deixe sem cartão');
  }

  if (pixCount === 1 && cardInputs.length !== 1) {
    throw new ExpenseSplitError('Combine 1 cartão + PIX');
  }

  if (pixCount === 0 && cardInputs.length === 1 && inputs.length === 1) {
    if (Math.abs(cardInputs[0].percent - 100) > 0.01) {
      throw new ExpenseSplitError('Um cartão isolado deve ser 100%');
    }
    return;
  }

  if (pixCount === 0 && cardInputs.length === 2) {
    if (cardInputs[0].cardId === cardInputs[1].cardId) {
      throw new ExpenseSplitError('Escolha dois cartões diferentes');
    }
    return;
  }

  if (pixCount === 0 && cardInputs.length !== 1 && cardInputs.length !== 2) {
    throw new ExpenseSplitError('Splits de cartão inválidos');
  }
}

/**
 * Product rule: a new/edited expense must fit the card for a FULL billing
 * cycle. The candidate charge is the card's share times the most charges the
 * frequency can produce in the card's current open window (at least a normal
 * cycle: weekly 5, monthly/one-off 1; longer when a closing was skipped), and
 * `committedByCard` (current cycle, already excluding the expense being
 * edited) plus that charge may not exceed the limit.
 */
export function assertCardLimits(args: {
  cards: Map<string, Card>;
  resolved: ResolvedSplit[];
  committedByCard: Map<string, number>;
  frequency: string;
  /** Each card's current open window; absent = a normal full cycle. */
  windows?: Map<string, CycleWindow>;
}) {
  for (const split of args.resolved) {
    if (split.kind !== 'card' || !split.cardId) continue;
    const card = args.cards.get(split.cardId);
    if (!card || card.limit == null) continue;

    const window = args.windows?.get(split.cardId);
    const charges = window
      ? ((maxChargesForWindow(window) as Record<string, number>)[
          args.frequency
        ] ?? 1)
      : maxChargesPerCycle(args.frequency);

    const committed = args.committedByCard.get(split.cardId) ?? 0;
    const available = toMoney(new Prisma.Decimal(card.limit).minus(committed));
    const candidate = new Prisma.Decimal(split.amount).mul(charges);

    if (candidate.gt(available)) {
      throw new ExpenseSplitError(
        `Limite insuficiente no cartão ${card.name} (disponível R$ ${available.toFixed(2).replace('.', ',')})`,
      );
    }
  }
}

export function denormalizedCardId(resolved: ResolvedSplit[]): string | null {
  const cardSplits = resolved.filter((item) => item.kind === 'card');
  if (cardSplits.length === 1 && resolved.length === 1) {
    return cardSplits[0].cardId;
  }
  return null;
}
