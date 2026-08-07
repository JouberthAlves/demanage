import { Router, Request, Response } from 'express';

import { customTagSelect, resolveCustomTagId } from '@/lib/custom-tag';
import { parseAbnt2Text } from '@/lib/abnt2';
import {
  parseEndsAt,
  parseReceiveDay,
  parseStartsAt,
} from '@/lib/entry-schedule';
import {
  denormalizedCardId,
  ExpenseSplitError,
  expenseSplitInclude,
  replaceExpenseSplits,
  resolveAndValidateSplits,
  serializeExpense,
} from '@/lib/expense-splits';
import { prisma } from '@/lib/prisma';
import {
  isValidExpenseCategory,
  isValidFrequency,
  parsePositiveAmount,
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
      category,
      frequency,
      cardId,
      dueDay,
      startsAt,
      endsAt,
      notes,
      customTagId,
      splits,
    } = req.body;

    const trimmedName = parseAbnt2Text(name, { maxLength: 100, required: true });
    if (!trimmedName || amount == null || !category) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, amount, category',
      });
    }

    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount == null) {
      return res.status(400).json({ error: positiveAmountError(amount) });
    }

    if (!isValidExpenseCategory(category)) {
      return res.status(400).json({ error: 'Categoria inválida' });
    }

    if (category === 'cofrinho') {
      return res.status(400).json({
        error: 'Depósitos no cofrinho são feitos pela aba Cofrinho',
      });
    }

    const resolvedFrequency = frequency ?? 'mensal';
    if (!isValidFrequency(resolvedFrequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    let resolvedSplits;
    try {
      resolvedSplits = await resolveAndValidateSplits({
        userId,
        totalAmount: parsedAmount,
        splits,
        cardId,
      });
    } catch (error) {
      if (error instanceof ExpenseSplitError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
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
    let resolvedStartsAt: Date | null = null;
    let resolvedEndsAt: Date | null = null;

    try {
      if (resolvedFrequency === 'unica') {
        resolvedDueDay = null;
        resolvedStartsAt = null;
        resolvedEndsAt = null;
      } else {
        resolvedDueDay = parseReceiveDay(dueDay);
        if (resolvedDueDay == null) {
          return res.status(400).json({
            error: 'Informe o dia em que será descontado (1-31)',
          });
        }
        resolvedStartsAt = parseStartsAt(startsAt);
        if (resolvedStartsAt == null) {
          return res.status(400).json({
            error: 'Informe o mês em que será descontado',
          });
        }
        resolvedEndsAt = parseEndsAt(endsAt);
        if (
          resolvedEndsAt &&
          resolvedStartsAt &&
          resolvedEndsAt.getTime() < resolvedStartsAt.getTime()
        ) {
          return res.status(400).json({
            error: 'Data de término deve ser após o primeiro desconto',
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_RECEIVE_DAY') {
        return res.status(400).json({
          error: 'Dia de desconto inválido (1-31)',
        });
      }
      if (error instanceof Error && error.message === 'INVALID_STARTS_AT') {
        return res.status(400).json({ error: 'Mês de desconto inválido' });
      }
      if (error instanceof Error && error.message === 'INVALID_ENDS_AT') {
        return res.status(400).json({ error: 'Data de término inválida' });
      }
      throw error;
    }

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          userId,
          name: trimmedName,
          amount: parsedAmount,
          category,
          frequency: resolvedFrequency,
          cardId: denormalizedCardId(resolvedSplits),
          dueDay: resolvedDueDay,
          startsAt: resolvedStartsAt,
          endsAt: resolvedEndsAt,
          notes:
            typeof notes === 'string'
              ? parseAbnt2Text(notes, { maxLength: 500 }) || null
              : null,
          customTagId: resolvedCustomTagId,
        },
      });

      await replaceExpenseSplits({
        tx,
        expenseId: created.id,
        resolved: resolvedSplits,
      });

      return tx.expense.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          customTag: { select: customTagSelect },
          ...expenseSplitInclude,
        },
      });
    });

    return res.status(201).json(serializeExpense(expense));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
