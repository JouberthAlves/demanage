import { Router } from 'express';

import {
  clearAuthCookie,
  comparePassword,
  hashPassword,
  setAuthCookie,
  signAuthToken,
  toPublicUser,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const authRoutes = Router();

authRoutes.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, email, password',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'A senha deve ter pelo menos 6 caracteres',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    const token = signAuthToken(user.id);
    setAuthCookie(res, token);

    return res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao registrar' });
  }
});

authRoutes.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email?.trim() || !password) {
      return res.status(400).json({
        error: 'Campos obrigatórios: email, password',
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const valid = await comparePassword(password, user.passwordHash);

    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const token = signAuthToken(user.id);
    setAuthCookie(res, token);

    return res.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao entrar' });
  }
});

authRoutes.post('/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

authRoutes.get('/auth/me', requireAuth, async (req, res) => {
  return res.json({ user: req.user });
});

export default authRoutes;
