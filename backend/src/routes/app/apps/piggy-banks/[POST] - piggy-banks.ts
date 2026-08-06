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

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { name, goalAmount, targetDate, autoDebit, isEmergency } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const parsedGoal = parsePositiveAmount(goalAmount);

    if (!trimmedName || parsedGoal == null) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, goalAmount (> 0), targetDate',
      });
    }

    let parsedTarget: Date;
    try {
      parsedTarget = parseTargetDate(targetDate);
    } catch {
      return res.status(400).json({ error: 'Data de conclusão inválida' });
    }

    const today = new Date();
    const todayUtc = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    );
    if (parsedTarget.getTime() < todayUtc.getTime()) {
      return res.status(400).json({
        error: 'Data de conclusão deve ser hoje ou no futuro',
      });
    }

    const monthlyGoal = computeMonthlyGoal(parsedGoal, parsedTarget, today);

    const bank = await prisma.piggyBank.create({
      data: {
        userId,
        name: trimmedName,
        goalAmount: parsedGoal,
        targetDate: parsedTarget,
        monthlyGoal,
        autoDebit: Boolean(autoDebit),
        isEmergency: Boolean(isEmergency),
      },
      include: { transactions: true },
    });

    return res.status(201).json(serializePiggyBank(bank));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
