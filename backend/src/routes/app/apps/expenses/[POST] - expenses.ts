import { Router, Request, Response } from 'express';

import { parseAbnt2Text } from '@/lib/abnt2';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { customTagSelect, resolveCustomTagId } from '@/lib/custom-tag';
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
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import {
  isValidExpenseCategory,
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
      category,
      frequency,
      date,
      cardId,
      dueDay,
      startsAt,
      endsAt,
      notes,
      customTagId,
      splits,
    } = req.body;

    const trimmedName = parseAbnt2Text(name, {
      maxLength: 100,
      required: true,
    });
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

    if (category === 'cofrinho' || category === 'investimento') {
      return res.status(400).json({
        error: 'Investimentos são lançados pelas abas Cofrinho ou Moedas',
      });
    }

    const resolvedFrequency = frequency ?? 'mensal';
    if (!isValidFrequency(resolvedFrequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    const uniqueDate =
      resolvedFrequency === 'unica' ? parseUniqueDate(date) : null;
    if (resolvedFrequency === 'unica' && !uniqueDate) {
      return res.status(400).json({
        error: 'Informe uma data válida para a despesa avulsa',
      });
    }
    if (uniqueDate && uniqueDate > todayInSaoPaulo()) {
      return res.status(400).json({
        error: 'A data da despesa avulsa não pode ser futura',
      });
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

    const expense = await withUserWriteLockTransaction(userId, async (tx) => {
      const resolvedSplits = await resolveAndValidateSplits({
        userId,
        totalAmount: parsedAmount,
        splits,
        cardId,
        tx,
      });
      const created = await tx.expense.create({
        data: {
          userId,
          name: trimmedName,
          amount: parsedAmount,
          category,
          frequency: resolvedFrequency,
          occurredAt: uniqueDate,
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

      if (uniqueDate) {
        const cashAmount =
          resolvedSplits.length > 0
            ? resolvedSplits
                .filter((split) => split.kind === 'pix')
                .reduce((sum, split) => sum + split.amount, 0)
            : parsedAmount;
        if (cashAmount > 0) {
          await tx.expensePayment.create({
            data: {
              expenseId: created.id,
              month: uniqueDate.toISOString().slice(0, 7),
              amount: cashAmount,
              paidAt: uniqueDate,
            },
          });
        }
      }

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
    if (err instanceof ExpenseSplitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
