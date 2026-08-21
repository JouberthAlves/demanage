import { Router, Request, Response } from 'express';

import { parseAbnt2Text } from '@/lib/abnt2';
import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import {
  serializePiggyBank,
  serializePiggyTransaction,
  withdrawFromPiggyBank,
} from '@/lib/piggy';
import { parsePositiveAmount } from '@/lib/validate';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post('/:id/withdraw', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const amount = parsePositiveAmount(req.body?.amount);
    if (amount == null) {
      return res.status(400).json({ error: 'Valor deve ser maior que zero' });
    }

    await catchUpPiggyInterest(userId);
    const result = await withdrawFromPiggyBank({
      userId,
      piggyBankId: id,
      amount,
      note:
        typeof req.body?.note === 'string'
          ? parseAbnt2Text(req.body.note, { maxLength: 500 }) || null
          : null,
    });

    return res.status(201).json({
      bank: serializePiggyBank(result.bank),
      transaction: serializePiggyTransaction(result.transaction),
      isEmergency: result.bank.isEmergency,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Cofre não encontrado' });
      }
      if (err.message === 'ARCHIVED') {
        return res.status(400).json({ error: 'Cofre arquivado' });
      }
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'Saldo insuficiente no cofre' });
      }
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
