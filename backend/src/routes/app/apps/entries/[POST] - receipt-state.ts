import { Router, Request, Response } from 'express';

import { customTagSelect } from '@/lib/custom-tag';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

type ReceiptState = 'automatic' | 'received' | 'waiting';

function parseMonthKey(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

function parseReceiptState(value: unknown): ReceiptState | null {
  if (value === 'automatic' || value === 'received' || value === 'waiting') {
    return value;
  }
  return null;
}

function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthIndex = month - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
  };
}

router.post('/:id/receipt-state', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const month = parseMonthKey(req.body?.month);
    const state = parseReceiptState(req.body?.state);
    if (!month || !state) {
      return res.status(400).json({ error: 'Estado de recebimento inválido' });
    }

    const existing = await prisma.entry.findFirst({
      where: { id, userId },
      include: { customTag: { select: customTagSelect } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Entrada não encontrada' });
    }

    if (existing.type !== 'salario' || existing.frequency !== 'mensal') {
      return res.status(400).json({
        error: 'Confirmação manual é permitida apenas para salário mensal',
      });
    }

    const bounds = monthBounds(month);
    if (existing.startsAt && existing.startsAt > bounds.end) {
      return res.status(400).json({
        error: 'Esse salário ainda não começou no mês selecionado',
      });
    }
    if (existing.endsAt && existing.endsAt < bounds.start) {
      return res.status(400).json({
        error: 'Esse salário já terminou antes do mês selecionado',
      });
    }

    const data =
      state === 'received'
        ? {
            receivedForMonth: month,
            receiptHoldForMonth: null,
            receivedAt: new Date(),
          }
        : state === 'waiting'
          ? {
              receivedForMonth: null,
              receiptHoldForMonth: month,
              receivedAt: null,
            }
          : {
              receivedForMonth: null,
              receiptHoldForMonth: null,
              receivedAt: null,
            };

    const entry = await prisma.entry.update({
      where: { id },
      data,
      include: { customTag: { select: customTagSelect } },
    });

    return res.json(entry);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
