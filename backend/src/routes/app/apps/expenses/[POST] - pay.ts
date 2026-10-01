import { Router, Request, Response } from 'express';

import { customTagSelect } from '@/lib/custom-tag';
import { expenseSplitInclude, serializeExpense } from '@/lib/expense-splits';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

function parseMonthKey(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthIndex = month - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
  };
}

router.post('/:id/pay', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const paidForMonth = parseMonthKey(req.body?.month);
    if (!paidForMonth) {
      return res.status(400).json({ error: 'Mês de pagamento inválido' });
    }

    const result = await withUserWriteLockTransaction(userId, async (tx) => {
      const existing = await tx.expense.findFirst({
        where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
        include: {
          customTag: { select: customTagSelect },
          ...expenseSplitInclude,
        },
      });

      if (!existing) return { status: 404, error: 'Despesa não encontrada' };

      if (existing.isInvoice) {
        const periodEnd = existing.billingPeriodEnd ?? existing.occurredAt;
        const invoiceMonth = periodEnd?.toISOString().slice(0, 7);
        if (!invoiceMonth || paidForMonth !== invoiceMonth) {
          return {
            status: 400,
            error: 'O mês de pagamento deve corresponder ao ciclo da fatura',
          };
        }
      } else if (existing.frequency !== 'mensal') {
        return {
          status: 400,
          error:
            'Pagamento antecipado é permitido apenas para despesas fixas mensais',
        };
      }

      const cashAmount = existing.isInvoice
        ? Number(existing.amount)
        : existing.splits.length > 0
          ? existing.splits
              .filter((split) => split.kind === 'pix')
              .reduce((sum, split) => sum + Number(split.amount), 0)
          : existing.cardId
            ? 0
            : Number(existing.amount);

      if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
        return {
          status: 400,
          error: existing.isInvoice
            ? 'Valor da fatura inválido'
            : 'Despesas somente no cartão entram no saldo pela fatura',
        };
      }

      if (!existing.isInvoice) {
        const bounds = monthBounds(paidForMonth);
        if (existing.startsAt && existing.startsAt > bounds.end) {
          return {
            status: 400,
            error: 'Essa despesa ainda não começou no mês selecionado',
          };
        }
        if (existing.endsAt && existing.endsAt < bounds.start) {
          return {
            status: 400,
            error: 'Essa despesa já terminou antes do mês selecionado',
          };
        }
      }

      const now = new Date();
      const payment = await tx.expensePayment.upsert({
        where: {
          expenseId_month: { expenseId: id, month: paidForMonth },
        },
        update: {},
        create: {
          expenseId: id,
          month: paidForMonth,
          amount: cashAmount,
          paidAt:
            existing.paidForMonth === paidForMonth && existing.paidAt
              ? existing.paidAt
              : now,
        },
      });

      if (existing.paidForMonth !== paidForMonth) {
        await tx.expense.update({
          where: { id },
          data: { paidForMonth, paidAt: payment.paidAt },
        });
      }

      const expense = await tx.expense.findFirst({
        where: { id, userId },
        include: {
          customTag: { select: customTagSelect },
          ...expenseSplitInclude,
        },
      });
      if (!expense) return { status: 404, error: 'Despesa não encontrada' };
      return { expense };
    });

    if ('error' in result) {
      return res.status(result.status ?? 500).json({ error: result.error });
    }
    return res.json(serializeExpense(result.expense));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
