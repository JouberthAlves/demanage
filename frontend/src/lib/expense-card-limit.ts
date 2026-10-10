import { availableCardLimit } from '@/lib/expense-splits';
import type { Card } from '@/types/finance';

export type PayMode = 'none' | 'one_card' | 'two_cards' | 'card_pix';

export const NO_CARD = 'none';
export const LIMIT_TOLERANCE = 0.001;

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

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

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
  const share1 = roundMoney((amount * display1) / 100);
  return {
    percent1,
    percent2: roundMoney(100 - display1),
    share1,
    share2: roundMoney(amount - share1),
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

/** Whether `amount` fits in the card's remaining limit. */
export function checkCardLimit(
  card: Card | undefined,
  amount: number,
  committedByCard: Map<string, number>,
): CardLimitCheck | null {
  if (!card) return null;
  const available = availableCardLimit({
    limit: card.limit,
    committed: committedByCard.get(card.id) ?? 0,
  });
  return {
    card,
    available,
    exceeded: available != null && amount > available + LIMIT_TOLERANCE,
  };
}

/** First selected card whose share exceeds its available limit, if any. */
export function exceedsCardLimit(
  form: CardSelection,
  amount: number,
  shares: SplitShares,
  cards: Card[],
  committedByCard: Map<string, number>,
): (CardLimitCheck & { fieldId: string }) | null {
  for (const share of cardSharesFor(form, amount, shares)) {
    const check = checkCardLimit(
      cards.find((card) => card.id === share.cardId),
      share.amount,
      committedByCard,
    );
    if (check?.exceeded) return { ...check, fieldId: share.fieldId };
  }
  return null;
}
