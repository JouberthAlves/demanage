import { Router, Request, Response } from 'express';

import { customTagSelect } from '@/lib/custom-tag';
import {
  expenseSplitInclude,
  serializeExpense,
} from '@/lib/expense-splits';
import { prisma } from '@/lib/prisma';
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

    const existing = await prisma.expense.findFirst({
      where: { id, userId },
      include: {
        customTag: { select: customTagSelect },
        ...expenseSplitInclude,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Despesa não encontrada' });
    }

    if (existing.isInvoice || existing.frequency !== 'mensal') {
      return res.status(400).json({
        error: 'Pagamento antecipado é permitido apenas para despesas fixas mensais',
      });
    }

    const cashAmount =
      existing.splits.length > 0
        ? existing.splits
            .filter((split) => split.kind === 'pix')
            .reduce((sum, split) => sum + Number(split.amount), 0)
        : existing.cardId
          ? 0
          : Number(existing.amount);

    if (cashAmount <= 0) {
      return res.status(400).json({
        error: 'Despesas somente no cartão entram no saldo pela fatura',
      });
    }

    const bounds = monthBounds(paidForMonth);
    if (existing.startsAt && existing.startsAt > bounds.end) {
      return res.status(400).json({
        error: 'Essa despesa ainda não começou no mês selecionado',
      });
    }
    if (existing.endsAt && existing.endsAt < bounds.start) {
      return res.status(400).json({
        error: 'Essa despesa já terminou antes do mês selecionado',
      });
    }

    if (existing.paidForMonth === paidForMonth) {
      return res.json(serializeExpense(existing));
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: { paidForMonth, paidAt: new Date() },
      include: {
        customTag: { select: customTagSelect },
        ...expenseSplitInclude,
      },
    });

    return res.json(serializeExpense(expense));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
