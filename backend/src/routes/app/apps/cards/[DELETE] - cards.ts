import { Router, Request, Response } from 'express';

import {
  chargesTotalForClosing,
  lateOneOffsTotalForClosing,
  todayInSaoPaulo,
} from '@/lib/card-billing';
import { dateOnlyUtc } from '@/lib/decimal';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const archived = await withUserWriteLockTransaction(userId, async (tx) => {
      const card = await tx.card.findFirst({
        where: { id, userId, archivedAt: null },
        include: {
          expenses: { include: { splits: true } },
          expenseSplits: {
            where: { kind: 'card' },
            include: { expense: { include: { splits: true } } },
          },
        },
      });
      if (!card) return null;

      const expenseMap = new Map(
        card.expenses.map((expense) => [expense.id, expense]),
      );
      for (const split of card.expenseSplits) {
        expenseMap.set(split.expense.id, split.expense);
      }

      const today = todayInSaoPaulo();
      const periodStart = card.lastInvoicedOn
        ? dateOnlyUtc(card.lastInvoicedOn)
        : todayInSaoPaulo(card.createdAt);
      const expenses = [...expenseMap.values()];
      const cycleAmount = chargesTotalForClosing(
        expenses,
        card.id,
        today,
        periodStart,
        card.lastInvoicedOn == null,
      );
      const lateAdjustmentAmount =
        card.lastInvoicedOn && card.lastBillingProcessedAt
          ? lateOneOffsTotalForClosing(
              expenses,
              card.id,
              periodStart,
              card.lastBillingProcessedAt,
            )
          : 0;
      const amount = cycleAmount + lateAdjustmentAmount;
      if (amount > 0) {
        await tx.expense.create({
          data: {
            userId,
            cardId: card.id,
            name: `Fatura do cartão ${card.name}`,
            amount,
            category: 'outro',
            frequency: 'unica',
            isInvoice: true,
            occurredAt: today,
            billingPeriodStart: periodStart,
            billingPeriodEnd: today,
            notes:
              lateAdjustmentAmount > 0
                ? 'Fechamento final antes do arquivamento; inclui compras retroativas informadas após o fechamento anterior'
                : 'Fechamento final antes do arquivamento do cartão',
          },
        });
      }

      const archivedAt = new Date();
      return tx.card.update({
        where: { id },
        data: {
          archivedAt,
          lastInvoicedOn: today,
          lastBillingProcessedAt: archivedAt,
        },
      });
    });

    if (!archived) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    return res.json({ ok: true, archivedAt: archived.archivedAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
