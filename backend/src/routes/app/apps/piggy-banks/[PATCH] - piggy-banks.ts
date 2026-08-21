import { Router, Request, Response } from 'express';

import { parseAbnt2Text } from '@/lib/abnt2';
import {
  computeMonthlyGoal,
  parseAutoDebitDay,
  parseOptionalTargetDate,
  piggyGoalAmount,
  serializePiggyBank,
} from '@/lib/piggy';
import { parsePositiveAmount } from '@/lib/validate';
import { requireAuth } from '@/middlewares/require-auth';
import { prisma } from '@/lib/prisma';

const router = Router();

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const existing = await prisma.piggyBank.findFirst({
      where: { id, userId },
      include: { transactions: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Cofre não encontrado' });
    }

    if (existing.archivedAt) {
      return res.status(400).json({ error: 'Cofre arquivado não pode ser editado' });
    }

    const { name, goalAmount, targetDate, monthlyGoal: monthlyGoalInput, autoDebit, autoDebitDay, isEmergency } =
      req.body;

    let nextGoal = piggyGoalAmount(existing.goalAmount);
    if (goalAmount !== undefined) {
      if (goalAmount == null || goalAmount === '') {
        nextGoal = null;
      } else {
        const parsed = parsePositiveAmount(goalAmount);
        if (parsed == null) {
          return res.status(400).json({ error: 'Meta final deve ser maior que zero' });
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

    if (nextGoal == null) {
      nextTarget = null;
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
        return res.status(400).json({
          error: 'Informe o valor do débito automático',
        });
      }
      monthlyGoal = parsedMonthly;
    }

    let nextAutoDebitDay = existing.autoDebitDay;
    if (autoDebitDay !== undefined || (autoDebit !== undefined && nextAutoDebit)) {
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
      const parsed = parseAbnt2Text(name, { maxLength: 50, required: true });
      if (!parsed) {
        return res.status(400).json({ error: 'Nome inválido' });
      }
      nextName = parsed;
    }

    const bank = await prisma.piggyBank.update({
      where: { id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        goalAmount: nextGoal,
        targetDate: nextTarget,
        monthlyGoal,
        autoDebit: nextAutoDebit,
        autoDebitDay: nextAutoDebitDay,
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
