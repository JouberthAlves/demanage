import type { Card, Expense } from '@prisma/client';

import { prisma } from '@/lib/prisma';

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function closingDateInMonth(
  year: number,
  monthIndex: number,
  closingDay: number,
) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(closingDay, lastDay);
  return new Date(year, monthIndex, day);
}

/** Datas de fechamento estritamente após `after`, até `until` (inclusive). */
export function listDueClosingDates(
  closingDay: number,
  after: Date,
  until: Date,
) {
  const dates: Date[] = [];
  const end = startOfDay(until);
  const afterDay = startOfDay(after);

  let year = afterDay.getFullYear();
  let month = afterDay.getMonth();

  for (let i = 0; i < 48; i += 1) {
    const candidate = closingDateInMonth(year, month, closingDay);
    if (candidate > afterDay && candidate <= end) {
      dates.push(candidate);
    }
    if (candidate > end) break;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return dates;
}

function chargesTotal(expenses: Expense[]) {
  return expenses
    .filter((expense) => !expense.isInvoice)
    .reduce((sum, expense) => sum + Number(expense.amount), 0);
}

export async function processUserCardBilling(userId: string) {
  const today = startOfDay(new Date());
  const cards = await prisma.card.findMany({
    where: { userId, closingDay: { not: null } },
    include: { expenses: true },
  });

  let createdCount = 0;

  for (const card of cards) {
    if (!card.closingDay) continue;

    const after = card.lastInvoicedOn
      ? startOfDay(card.lastInvoicedOn)
      : startOfDay(card.createdAt);

    const dueDates = listDueClosingDates(card.closingDay, after, today);
    const amount = chargesTotal(card.expenses);

    for (const closingOn of dueDates) {
      if (amount <= 0) {
        await prisma.card.update({
          where: { id: card.id },
          data: { lastInvoicedOn: closingOn },
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.expense.create({
          data: {
            userId,
            cardId: card.id,
            name: `Fatura do cartão ${card.name}`,
            amount,
            category: 'outro',
            frequency: 'mensal',
            isInvoice: true,
            notes: `Fechamento ${closingOn.toLocaleDateString('pt-BR')}`,
          },
        });

        await tx.card.update({
          where: { id: card.id },
          data: { lastInvoicedOn: closingOn },
        });
      });

      createdCount += 1;
    }
  }

  return { createdCount };
}

export function serializeCard(card: Card) {
  return {
    id: card.id,
    name: card.name,
    limit: card.limit == null ? null : Number(card.limit),
    closingDay: card.closingDay,
    expiresAt: card.expiresAt,
    lastInvoicedOn: card.lastInvoicedOn,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    expired: card.expiresAt ? card.expiresAt.getTime() < Date.now() : false,
  };
}
