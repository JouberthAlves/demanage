import { Router, Request, Response } from 'express';

import { parseAbnt2Text } from '@/lib/abnt2';
import {
  computeMonthlyGoal,
  parseAutoDebitDay,
  parseOptionalTargetDate,
  piggyGoalAmount,
  serializePiggyBank,
} from '@/lib/piggy';
import { prisma } from '@/lib/prisma';
import { parsePositiveAmount } from '@/lib/validate';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

function parseCdiPercent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const existing = await prisma.piggyBank.findFirst({
      where: { id, userId },
      include: { transactions: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Cofre não encontrado' });
    }
    if (existing.archivedAt) {
      return res
        .status(400)
        .json({ error: 'Cofre arquivado não pode ser editado' });
    }

    const {
      name,
      goalAmount,
      targetDate,
      monthlyGoal: monthlyGoalInput,
      autoDebit,
      autoDebitDay,
      isEmergency,
      yieldEnabled,
      cdiPercent,
    } = req.body;

    let nextGoal = piggyGoalAmount(existing.goalAmount);
    if (goalAmount !== undefined) {
      if (goalAmount == null || goalAmount === '') {
        nextGoal = null;
      } else {
        const parsed = parsePositiveAmount(goalAmount);
        if (parsed == null) {
          return res
            .status(400)
            .json({ error: 'Meta final deve ser maior que zero' });
        }
        nextGoal = parsed;
      }
    }

    let nextTarget = existing.targetDate;
    if (targetDate !== undefined) {
      try {
        nextTarget = parseOptionalTargetDate(targetDate);
      } catch {
        return res.status(400).json({ error: 'Data de conclusão inválida' });
      }
    }

    const computedMonthly = computeMonthlyGoal(nextGoal, nextTarget);
    let monthlyGoal = computedMonthly;
    const nextAutoDebit =
      autoDebit !== undefined ? Boolean(autoDebit) : existing.autoDebit;
    if (nextAutoDebit && monthlyGoal <= 0) {
      const parsedMonthly = parsePositiveAmount(
        monthlyGoalInput !== undefined
          ? monthlyGoalInput
          : existing.monthlyGoal,
      );
      if (parsedMonthly == null) {
        return res
          .status(400)
          .json({ error: 'Informe o valor do débito automático' });
      }
      monthlyGoal = parsedMonthly;
    }

    let nextAutoDebitDay = existing.autoDebitDay;
    if (
      autoDebitDay !== undefined ||
      (autoDebit !== undefined && nextAutoDebit)
    ) {
      const day = parseAutoDebitDay(
        autoDebitDay !== undefined ? autoDebitDay : existing.autoDebitDay,
      );
      if (nextAutoDebit && day == null) {
        return res.status(400).json({
          error: 'Dia do débito automático deve ser entre 1 e 31',
        });
      }
      if (day != null) nextAutoDebitDay = day;
    }

    let nextName: string | undefined;
    if (name !== undefined) {
      const parsed = parseAbnt2Text(name, {
        maxLength: 50,
        required: true,
      });
      if (!parsed) return res.status(400).json({ error: 'Nome inválido' });
      nextName = parsed;
    }

    const nextYieldEnabled =
      yieldEnabled !== undefined
        ? Boolean(yieldEnabled)
        : existing.yieldEnabled;
    let nextCdiPercent = Number(existing.cdiPercent);
    if (cdiPercent !== undefined) {
      const parsed = parseCdiPercent(cdiPercent);
      if (parsed == null) {
        return res
          .status(400)
          .json({ error: '% do CDI deve estar entre 0 e 1000' });
      }
      nextCdiPercent = parsed;
    }
    if (!nextYieldEnabled) nextCdiPercent = 0;

    const bank = await prisma.piggyBank.update({
      where: { id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        goalAmount: nextGoal,
        targetDate: nextTarget,
        monthlyGoal,
        autoDebit: nextAutoDebit,
        autoDebitDay: nextAutoDebitDay,
        yieldEnabled: nextYieldEnabled,
        cdiPercent: nextCdiPercent,
        ...(isEmergency !== undefined
          ? { isEmergency: Boolean(isEmergency) }
          : {}),
      },
      include: { transactions: true },
    });

    return res.json(serializePiggyBank(bank));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
