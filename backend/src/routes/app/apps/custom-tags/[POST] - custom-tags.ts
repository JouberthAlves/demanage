import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const router = Router();

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { scope, name, color } = req.body;

    if (scope !== 'expense' && scope !== 'income') {
      return res.status(400).json({ error: 'scope deve ser expense ou income' });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ error: 'Informe o nome do tipo' });
    }

    if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
      return res.status(400).json({ error: 'Cor inválida (use #RRGGBB)' });
    }

    const existing = await prisma.customTag.findFirst({
      where: {
        userId,
        scope,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Já existe um tipo com esse nome' });
    }

    const tag = await prisma.customTag.create({
      data: {
        userId,
        scope,
        name: trimmedName,
        color,
      },
    });

    return res.status(201).json(tag);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
