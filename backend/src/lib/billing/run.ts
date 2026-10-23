import type { Expense, ExpenseSplit } from '@/generated/prisma/client';
import { addDaysToKey, dayKeyToDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { parseObligationVersions } from './obligation-versions';
import { planCardBilling } from './plan';

type ExpenseForBilling = Expense & { splits?: ExpenseSplit[] };

/**
 * Generates every pending card invoice for the user.
 *
 * `now` defaults to the instant the per-user lock is acquired (taken INSIDE
 * the transaction, so a request that waited on the lock never bills against a
 * stale clock). Passing `now` explicitly (tests, cron) overrides that.
 */
export async function processUserCardBilling(userId: string, now?: Date) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const effectiveNow = now ?? new Date();
    const cutoff = dayKeyToDate(
      addDaysToKey(todayKeyInSaoPaulo(effectiveNow), -1),
    );

    const cards = await tx.card.findMany({
      where: { userId, archivedAt: null },
    });

    // Source every obligation owned by this account: an earlier version can
    // reference a card that no longer appears in the current expense splits.
    const expenses = await tx.expense.findMany({
      where: { userId, isInvoice: false },
      include: { splits: true, obligationVersions: { orderBy: { sequence: 'asc' } } },
    });
    const billable: ExpenseForBilling[] = expenses.map((expense) => ({
      ...expense,
      obligationVersions: parseObligationVersions(expense.obligationVersions),
    }));

    let createdCount = 0;
    const invoiceRows: Array<{
      userId: string;
      cardId: string;
      name: string;
      amount: string;
      category: 'outro';
      frequency: 'unica';
      isInvoice: true;
      occurredAt: Date;
      billingPeriodStart: Date;
      billingPeriodEnd: Date;
      notes: string;
    }> = [];

    for (const card of cards) {
      const { invoices, cardUpdate } = planCardBilling(
        card,
        billable,
        cutoff,
        effectiveNow,
      );

      for (const invoice of invoices) {
        invoiceRows.push({
          userId,
          cardId: card.id,
          name: `Fatura do cartão ${card.name}`,
          amount: invoice.amount.toFixed(2),
          category: 'outro',
          frequency: 'unica',
          isInvoice: true,
          occurredAt: invoice.closingOn,
          billingPeriodStart: invoice.periodStart,
          billingPeriodEnd: invoice.closingOn,
          notes: invoice.notes,
        });
        createdCount += 1;
      }

      if (cardUpdate) {
        await tx.card.update({ where: { id: card.id }, data: cardUpdate });
      }
    }

    if (invoiceRows.length > 0) {
      await tx.expense.createMany({ data: invoiceRows });
    }

    return { createdCount };
  });
}
