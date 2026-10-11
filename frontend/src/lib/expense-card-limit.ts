import { maxChargesPerCycle } from '@/lib/billing';
import {
  allocateCentsByPercent,
  fromCents,
  toCents,
} from '@/lib/money';
import type { Card, ExpenseFrequency } from '@/types/finance';

export type PayMode = 'none' | 'one_card' | 'two_cards' | 'card_pix';

export const NO_CARD = 'none';

/** DOM ids of the card controls, used to focus the field that failed. */
export const CARD_FIELD_IDS = {
  card: 'expense-card',
  card1: 'expense-card-1',
  card2: 'expense-card-2',
  percent: 'expense-card-percent',
} as const;

/** The part of the expense form that decides which cards are charged. */
export type CardSelection = {
  payMode: PayMode;
  cardId: string;
  cardId2: string;
};

/** Integer percentage 1-99, or null for '' / '0' / anything out of range. */
export function parseCardPercent(raw: string) {
  if (!/^\d{1,2}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= 1 && value <= 99 ? value : null;
}

export type SplitShares = {
  /** Null while the typed percentage is invalid. */
  percent1: number | null;
  percent2: number;
  share1: number;
  share2: number;
};

export function computeSplitShares(
  amount: number,
  rawPercent: string,
): SplitShares {
  const percent1 = parseCardPercent(rawPercent);
  const display1 = percent1 ?? 0;
  // Same allocation as the backend: part 1 is HALF_UP to cents, part 2 is the
  // remainder (R$ 0,29 at 50/50 -> 0,15 + 0,14).
  const [cents1 = 0, cents2 = 0] = allocateCentsByPercent(toCents(amount), [
    display1,
    100 - display1,
  ]);
  return {
    percent1,
    percent2: 100 - display1,
    share1: fromCents(cents1),
    share2: fromCents(cents2),
  };
}

type CardShare = { cardId: string; amount: number; fieldId: string };

/** Amount charged to each selected card for the current pay mode. */
export function cardSharesFor(
  form: CardSelection,
  amount: number,
  shares: SplitShares,
): CardShare[] {
  const result: CardShare[] = [];
  const hasCard1 = form.cardId !== NO_CARD;
  if (form.payMode === 'one_card' && hasCard1) {
    result.push({
      cardId: form.cardId,
      amount,
      fieldId: CARD_FIELD_IDS.card,
    });
  } else if (form.payMode === 'two_cards') {
    if (hasCard1) {
      result.push({
        cardId: form.cardId,
        amount: shares.share1,
        fieldId: CARD_FIELD_IDS.card1,
      });
    }
    if (form.cardId2 !== NO_CARD) {
      result.push({
        cardId: form.cardId2,
        amount: shares.share2,
        fieldId: CARD_FIELD_IDS.card2,
      });
    }
  } else if (form.payMode === 'card_pix' && hasCard1) {
    result.push({
      cardId: form.cardId,
      amount: shares.share1,
      fieldId: CARD_FIELD_IDS.card1,
    });
  }
  return result;
}

export type CardLimitCheck = {
  card: Card;
  /** Null when the card has no limit. */
  available: number | null;
  exceeded: boolean;
};

export type CardLimitContext = {
  frequency: ExpenseFrequency;
  /** True when editing an existing expense (see checkCardLimit). */
  editing: boolean;
};

/**
 * Mirrors the backend limit rule for a NEW expense: the card share times the
 * most charges the frequency can make in one cycle must fit in
 * `card.available` (computed by the backend).
 *
 * When EDITING, the backend excludes the expense's own commitment from
 * `committed`, which the frontend cannot know exactly, so we never block in
 * the UI (`exceeded` is always false): the available amount is only shown as
 * information and the backend error is surfaced through getApiErrorMessage.
 */
export function checkCardLimit(
  card: Card | undefined,
  shareAmount: number,
  { frequency, editing }: CardLimitContext,
): CardLimitCheck | null {
  if (!card) return null;
  const available = card.available;
  const candidateCents = toCents(shareAmount) * maxChargesPerCycle(frequency);
  return {
    card,
    available,
    exceeded:
      !editing && available != null && candidateCents > toCents(available),
  };
}

/** First selected card whose share exceeds its available limit, if any. */
export function exceedsCardLimit(
  form: CardSelection,
  amount: number,
  shares: SplitShares,
  cards: Card[],
  context: CardLimitContext,
): (CardLimitCheck & { fieldId: string }) | null {
  for (const share of cardSharesFor(form, amount, shares)) {
    const check = checkCardLimit(
      cards.find((card) => card.id === share.cardId),
      share.amount,
      context,
    );
    if (check?.exceeded) return { ...check, fieldId: share.fieldId };
  }
  return null;
}
