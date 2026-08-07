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

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
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

    const trimmedName = parseAbnt2Text(name, { maxLength: 100, required: true });
    if (!trimmedName || amount == null || !type || !frequency) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, amount, type, frequency',
      });
    }

    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount == null) {
      return res.status(400).json({ error: positiveAmountError(amount) });
    }

    if (!isValidEntryType(type)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    if (type === 'salario') {
      return res.status(400).json({
        error: 'O salário é cadastrado pela aba Perfil',
      });
    }

    if (!isValidFrequency(frequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    let uniqueDate: Date | null = null;
    if (frequency === 'unica') {
      uniqueDate = parseUniqueDate(date);
      if (!uniqueDate) {
        return res.status(400).json({
          error: 'Informe a data da entrada única',
        });
      }
    }

    let resolvedCustomTagId: string | null = null;
    try {
      resolvedCustomTagId = await resolveCustomTagId({
        userId,
        scope: 'income',
        customTagId,
      });
    } catch {
      return res.status(400).json({ error: 'Tipo personalizado inválido' });
    }

    if (resolvedCustomTagId && type !== 'outro') {
      return res.status(400).json({
        error: 'Tipos personalizados devem usar type=outro',
      });
    }

    let resolvedReceiveDay: number | null = null;
    let resolvedStartsAt: Date | null = null;
    let resolvedEndsAt: Date | null = null;

    try {
      if (frequency === 'unica') {
        resolvedReceiveDay = null;
        resolvedStartsAt = null;
        resolvedEndsAt = null;
      } else {
        resolvedReceiveDay = parseReceiveDay(receiveDay);
        if (resolvedReceiveDay == null) {
          return res.status(400).json({
            error: 'Informe o dia em que recebe (1-31)',
          });
        }
        resolvedStartsAt = parseStartsAt(startsAt);
        if (resolvedStartsAt == null) {
          return res.status(400).json({
            error: 'Informe o mês em que recebe',
          });
        }
        resolvedEndsAt = parseEndsAt(endsAt);
        if (
          resolvedEndsAt &&
          resolvedStartsAt &&
          resolvedEndsAt.getTime() < resolvedStartsAt.getTime()
        ) {
          return res.status(400).json({
            error: 'Data de término deve ser após o primeiro recebimento',
          });
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

    const entry = await prisma.entry.create({
      data: {
        userId,
        name: trimmedName,
        amount: parsedAmount,
        type,
        frequency,
        date: uniqueDate,
        receiveDay: resolvedReceiveDay,
        startsAt: resolvedStartsAt,
        endsAt: resolvedEndsAt,
        customTagId: resolvedCustomTagId,
      },
      include: { customTag: { select: customTagSelect } },
    });

    return res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
