import { Router, Request, Response } from 'express';

import { serializeCard } from '@/lib/card-billing';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

function parseExpiresAt(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_EXPIRES_AT');
  }
  return date;
}

function parseClosingDay(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('INVALID_CLOSING_DAY');
  }
  return day;
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { name, limit, closingDay, expiresAt } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Campo obrigatório: name' });
    }

    let parsedExpiresAt: Date | null = null;
    let parsedClosingDay: number | null = null;
    try {
      parsedExpiresAt = parseExpiresAt(expiresAt) ?? null;
      parsedClosingDay = parseClosingDay(closingDay) ?? null;
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_EXPIRES_AT') {
        return res.status(400).json({ error: 'Validade inválida' });
      }
      if (error instanceof Error && error.message === 'INVALID_CLOSING_DAY') {
        return res.status(400).json({
          error: 'Fechamento inválido. Use um dia entre 01 e 31',
        });
      }
      throw error;
    }

    const card = await prisma.card.create({
      data: {
        userId,
        name: name.trim(),
        limit: limit ?? null,
        closingDay: parsedClosingDay,
        expiresAt: parsedExpiresAt,
      },
    });

    return res.status(201).json(serializeCard(card));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
