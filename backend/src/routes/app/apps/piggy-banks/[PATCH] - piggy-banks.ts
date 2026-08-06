import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import {
  computeMonthlyGoal,
  parseTargetDate,
  serializePiggyBank,
} from '@/lib/piggy';
import { parsePositiveAmount } from '@/lib/validate';
import { requireAuth } from '@/middlewares/require-auth';

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

    const { name, goalAmount, targetDate, autoDebit, isEmergency } = req.body;

    let nextGoal = Number(existing.goalAmount);
    if (goalAmount !== undefined) {
      const parsed = parsePositiveAmount(goalAmount);
      if (parsed == null) {
        return res.status(400).json({ error: 'Meta final deve ser maior que zero' });
      }
      nextGoal = parsed;
    }

    let nextTarget = existing.targetDate;
    if (targetDate !== undefined) {
      try {
        nextTarget = parseTargetDate(targetDate);
      } catch {
        return res.status(400).json({ error: 'Data de conclusão inválida' });
      }
    }

    const monthlyGoal = computeMonthlyGoal(nextGoal, nextTarget);

    const bank = await prisma.piggyBank.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(goalAmount !== undefined ? { goalAmount: nextGoal } : {}),
        ...(targetDate !== undefined ? { targetDate: nextTarget } : {}),
        monthlyGoal,
        ...(autoDebit !== undefined ? { autoDebit: Boolean(autoDebit) } : {}),
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
