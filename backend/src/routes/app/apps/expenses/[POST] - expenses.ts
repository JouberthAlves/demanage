import { Router, Request, Response } from 'express';

import { customTagSelect, resolveCustomTagId } from '@/lib/custom-tag';
import { parseEndsAt, parseReceiveDay } from '@/lib/entry-schedule';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const VALID_FREQUENCIES = new Set(['mensal', 'semanal', 'unica']);

const router = Router();

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const {
      name,
      amount,
      category,
      frequency,
      cardId,
      dueDay,
      endsAt,
      notes,
      customTagId,
    } = req.body;

    if (!name || amount == null || !category) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, amount, category',
      });
    }

    const resolvedFrequency = frequency ?? 'mensal';
    if (!VALID_FREQUENCIES.has(resolvedFrequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    const resolvedCardId = cardId || null;

    if (resolvedCardId) {
      const card = await prisma.card.findFirst({
        where: { id: resolvedCardId, userId },
      });

      if (!card) {
        return res.status(400).json({ error: 'Cartão inválido' });
      }

      if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({
          error: 'Cartão vencido. Renove a validade no Perfil.',
        });
      }
    }

    let resolvedCustomTagId: string | null = null;
    try {
      resolvedCustomTagId = await resolveCustomTagId({
        userId,
        scope: 'expense',
        customTagId,
      });
    } catch {
      return res.status(400).json({ error: 'Tipo personalizado inválido' });
    }

    if (resolvedCustomTagId && category !== 'outro') {
      return res.status(400).json({
        error: 'Tipos personalizados devem usar category=outro',
      });
    }

    let resolvedDueDay: number | null = null;
    let resolvedEndsAt: Date | null = null;

    try {
      if (resolvedFrequency === 'unica') {
        resolvedDueDay = null;
        resolvedEndsAt = null;
      } else {
        resolvedDueDay = parseReceiveDay(dueDay);
        if (resolvedDueDay == null) {
          return res.status(400).json({
            error: 'Informe o dia em que será descontado (1-31)',
          });
        }
        resolvedEndsAt = parseEndsAt(endsAt);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_RECEIVE_DAY') {
        return res.status(400).json({
          error: 'Dia de desconto inválido (1-31)',
        });
      }
      if (error instanceof Error && error.message === 'INVALID_ENDS_AT') {
        return res.status(400).json({ error: 'Data de término inválida' });
      }
      throw error;
    }

    const expense = await prisma.expense.create({
      data: {
        userId,
        name,
        amount,
        category,
        frequency: resolvedFrequency,
        cardId: resolvedCardId,
        dueDay: resolvedDueDay,
        endsAt: resolvedEndsAt,
        notes: notes || null,
        customTagId: resolvedCustomTagId,
      },
      include: { customTag: { select: customTagSelect } },
    });

    return res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
