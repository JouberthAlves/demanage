import { Router, Request, Response } from 'express';

import { customTagSelect, resolveCustomTagId } from '@/lib/custom-tag';
import { parseAbnt2Text } from '@/lib/abnt2';
import {
  parseEndsAt,
  parseReceiveDay,
  parseStartsAt,
} from '@/lib/entry-schedule';
import { prisma } from '@/lib/prisma';
import {
  isValidEntryType,
  isValidFrequency,
  parsePositiveAmount,
  parseUniqueDate,
  positiveAmountError,
} from '@/lib/validate';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const existing = await prisma.entry.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Entrada não encontrada' });
    }

    if (existing.type === 'salario') {
      return res.status(400).json({
        error: 'O salário é gerenciado pela aba Perfil',
      });
    }

    const {
      name,
      amount,
      type,
      frequency,
      date,
      customTagId,
      receiveDay,
      startsAt,
      endsAt,
    } = req.body;

    let nextName: string | undefined;
    if (name !== undefined) {
      const parsed = parseAbnt2Text(name, { maxLength: 100, required: true });
      if (!parsed) {
        return res.status(400).json({ error: 'Nome inválido' });
      }
      nextName = parsed;
    }

    let parsedAmount: number | undefined;
    if (amount !== undefined) {
      const nextAmount = parsePositiveAmount(amount);
      if (nextAmount == null) {
        return res.status(400).json({ error: positiveAmountError(amount) });
      }
      parsedAmount = nextAmount;
    }

    if (type !== undefined && !isValidEntryType(type)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    if (type === 'salario') {
      return res.status(400).json({
        error: 'O salário é cadastrado pela aba Perfil',
      });
    }

    if (frequency !== undefined && !isValidFrequency(frequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    let resolvedCustomTagId: string | null | undefined;
    if (customTagId !== undefined) {
      try {
        resolvedCustomTagId = await resolveCustomTagId({
          userId,
          scope: 'income',
          customTagId,
        });
      } catch {
        return res.status(400).json({ error: 'Tipo personalizado inválido' });
      }
    }

    const nextType = type ?? existing.type;
    const nextFrequency = frequency ?? existing.frequency;
    const nextCustomTagId =
      resolvedCustomTagId !== undefined
        ? resolvedCustomTagId
        : existing.customTagId;

    if (nextCustomTagId && nextType !== 'outro') {
      return res.status(400).json({
        error: 'Tipos personalizados devem usar type=outro',
      });
    }

    let resolvedReceiveDay: number | null | undefined;
    let resolvedStartsAt: Date | null | undefined;
    let resolvedEndsAt: Date | null | undefined;

    try {
      if (nextFrequency === 'unica') {
        resolvedReceiveDay = null;
        resolvedStartsAt = null;
        resolvedEndsAt = null;
      } else {
        if (receiveDay !== undefined) {
          resolvedReceiveDay = parseReceiveDay(receiveDay);
          if (resolvedReceiveDay == null) {
            return res.status(400).json({
              error: 'Informe o dia em que recebe (1-31)',
            });
          }
        } else if (existing.receiveDay == null) {
          return res.status(400).json({
            error: 'Informe o dia em que recebe (1-31)',
          });
        }

        if (startsAt !== undefined) {
          resolvedStartsAt = parseStartsAt(startsAt);
          if (resolvedStartsAt == null) {
            return res.status(400).json({
              error: 'Informe o mês em que recebe',
            });
          }
        } else if (existing.startsAt == null) {
          return res.status(400).json({
            error: 'Informe o mês em que recebe',
          });
        }

        if (endsAt !== undefined) {
          resolvedEndsAt = parseEndsAt(endsAt);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_RECEIVE_DAY') {
        return res
          .status(400)
          .json({ error: 'Dia de recebimento inválido (1-31)' });
      }
      if (error instanceof Error && error.message === 'INVALID_STARTS_AT') {
        return res.status(400).json({ error: 'Mês de recebimento inválido' });
      }
      if (error instanceof Error && error.message === 'INVALID_ENDS_AT') {
        return res.status(400).json({ error: 'Data de término inválida' });
      }
      throw error;
    }

    const nextStartsAt =
      resolvedStartsAt !== undefined ? resolvedStartsAt : existing.startsAt;
    const nextEndsAt =
      resolvedEndsAt !== undefined ? resolvedEndsAt : existing.endsAt;

    if (
      nextFrequency !== 'unica' &&
      nextStartsAt &&
      nextEndsAt &&
      nextEndsAt.getTime() < nextStartsAt.getTime()
    ) {
      return res.status(400).json({
        error: 'Data de término deve ser após o primeiro recebimento',
      });
    }

    let nextDate: Date | null | undefined;
    if (nextFrequency === 'unica') {
      if (date !== undefined) {
        nextDate = parseUniqueDate(date);
        if (!nextDate) {
          return res.status(400).json({
            error: 'Informe a data da entrada única',
          });
        }
      } else if (!existing.date) {
        return res.status(400).json({
          error: 'Informe a data da entrada única',
        });
      }
    } else {
      nextDate = null;
    }

    const entry = await prisma.entry.update({
      where: { id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(nextDate !== undefined ? { date: nextDate } : {}),
        ...(resolvedReceiveDay !== undefined
          ? { receiveDay: resolvedReceiveDay }
          : {}),
        ...(resolvedStartsAt !== undefined
          ? { startsAt: resolvedStartsAt }
          : {}),
        ...(resolvedEndsAt !== undefined ? { endsAt: resolvedEndsAt } : {}),
        ...(resolvedCustomTagId !== undefined
          ? { customTagId: resolvedCustomTagId }
          : {}),
      },
      include: { customTag: { select: customTagSelect } },
    });

    return res.json(entry);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
