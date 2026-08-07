import { Router, Request, Response } from 'express';

import { customTagSelect, resolveCustomTagId } from '@/lib/custom-tag';
import { parseAbnt2Text } from '@/lib/abnt2';
import {
  parseEndsAt,
  parseReceiveDay,
  parseStartsAt,
} from '@/lib/entry-schedule';
import {
  allocateSplitAmounts,
  assertCardLimits,
  assertCardsForSplits,
  denormalizedCardId,
  ExpenseSplitError,
  expenseSplitInclude,
  getCommittedByCard,
  replaceExpenseSplits,
  resolveAndValidateSplits,
  serializeExpense,
  type ResolvedSplit,
  type SplitInput,
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

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const existing = await prisma.expense.findFirst({
      where: { id, userId },
      include: { splits: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Despesa não encontrada' });
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

    if (category !== undefined && !isValidExpenseCategory(category)) {
      return res.status(400).json({ error: 'Categoria inválida' });
    }

    if (category === 'cofrinho' || existing.category === 'cofrinho') {
      if (category !== undefined && category !== 'cofrinho') {
        return res.status(400).json({
          error: 'Despesas de cofrinho não podem mudar de categoria',
        });
      }
      if (category === 'cofrinho' && existing.category !== 'cofrinho') {
        return res.status(400).json({
          error: 'Depósitos no cofrinho são feitos pela aba Cofrinho',
        });
      }
    }

    if (frequency !== undefined && !isValidFrequency(frequency)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }

    let resolvedCustomTagId: string | null | undefined;
    if (customTagId !== undefined) {
      try {
        resolvedCustomTagId = await resolveCustomTagId({
          userId,
          scope: 'expense',
          customTagId,
        });
      } catch {
        return res.status(400).json({ error: 'Tipo personalizado inválido' });
      }
    }

    const nextCategory = category ?? existing.category;
    const nextFrequency = frequency ?? existing.frequency;
    const nextCustomTagId =
      resolvedCustomTagId !== undefined
        ? resolvedCustomTagId
        : existing.customTagId;
    const nextAmount = parsedAmount ?? Number(existing.amount);

    if (nextCustomTagId && nextCategory !== 'outro') {
      return res.status(400).json({
        error: 'Tipos personalizados devem usar category=outro',
      });
    }

    let resolvedDueDay: number | null | undefined;
    let resolvedStartsAt: Date | null | undefined;
    let resolvedEndsAt: Date | null | undefined;

    try {
      if (nextFrequency === 'unica') {
        resolvedDueDay = null;
        resolvedStartsAt = null;
        resolvedEndsAt = null;
      } else {
        if (dueDay !== undefined) {
          resolvedDueDay = parseReceiveDay(dueDay);
          if (resolvedDueDay == null) {
            return res.status(400).json({
              error: 'Informe o dia em que será descontado (1-31)',
            });
          }
        } else if (existing.dueDay == null && !existing.isInvoice) {
          return res.status(400).json({
            error: 'Informe o dia em que será descontado (1-31)',
          });
        }

        if (startsAt !== undefined) {
          resolvedStartsAt = parseStartsAt(startsAt);
          if (resolvedStartsAt == null) {
            return res.status(400).json({
              error: 'Informe o mês em que será descontado',
            });
          }
        } else if (existing.startsAt == null && !existing.isInvoice) {
          return res.status(400).json({
            error: 'Informe o mês em que será descontado',
          });
        }

        if (endsAt !== undefined) {
          resolvedEndsAt = parseEndsAt(endsAt);
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
        error: 'Data de término deve ser após o primeiro desconto',
      });
    }

    let resolvedSplits: ResolvedSplit[];
    try {
      if (splits !== undefined || cardId !== undefined) {
        resolvedSplits = await resolveAndValidateSplits({
          userId,
          totalAmount: nextAmount,
          splits,
          cardId,
          excludeExpenseId: id,
        });
      } else if (existing.splits.length > 0) {
        const inputs: SplitInput[] = existing.splits.map((split) =>
          split.kind === 'pix'
            ? { kind: 'pix', percent: Number(split.percent) }
            : {
                kind: 'card',
                cardId: String(split.cardId),
                percent: Number(split.percent),
              },
        );
        const cards = await assertCardsForSplits({ userId, inputs });
        resolvedSplits = allocateSplitAmounts(
          nextAmount,
          inputs.map((item) =>
            item.kind === 'pix'
              ? { kind: 'pix', cardId: null, percent: item.percent }
              : { kind: 'card', cardId: item.cardId, percent: item.percent },
          ),
        );
        const committedByCard = await getCommittedByCard({
          userId,
          excludeExpenseId: id,
        });
        assertCardLimits({ cards, resolved: resolvedSplits, committedByCard });
      } else {
        resolvedSplits = [];
      }
    } catch (error) {
      if (error instanceof ExpenseSplitError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    const expense = await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(frequency !== undefined ? { frequency } : {}),
          cardId: denormalizedCardId(resolvedSplits),
          ...(resolvedDueDay !== undefined ? { dueDay: resolvedDueDay } : {}),
          ...(resolvedStartsAt !== undefined
            ? { startsAt: resolvedStartsAt }
            : {}),
          ...(resolvedEndsAt !== undefined ? { endsAt: resolvedEndsAt } : {}),
          ...(notes !== undefined
            ? {
                notes:
                  notes == null || notes === ''
                    ? null
                    : parseAbnt2Text(notes, { maxLength: 500 }) || null,
              }
            : {}),
          ...(resolvedCustomTagId !== undefined
            ? { customTagId: resolvedCustomTagId }
            : {}),
        },
      });

      await replaceExpenseSplits({
        tx,
        expenseId: id,
        resolved: resolvedSplits,
      });

      return tx.expense.findUniqueOrThrow({
        where: { id },
        include: {
          customTag: { select: customTagSelect },
          ...expenseSplitInclude,
        },
      });
    });

    return res.json(serializeExpense(expense));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
