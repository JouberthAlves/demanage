import { Router } from 'express';

import { bodyOf, requireUserId } from '@/http/request';
import {
  setAuthCookie,
  signAuthToken,
  toPublicUser,
} from '@/lib/auth';
import { createLogoutHandler } from '@/lib/logout-handler';
import { requireAuth } from '@/middlewares/require-auth';
import {
  authenticate,
  parseCurrentPassword,
  parseLogin,
  parseRecoverPassword,
  parseRegister,
  recoverPasswordWithSession,
  registerUser,
  rotateRecoveryCode,
} from '@/services/auth';
import {
  parseUpdateProfile,
  salaryReceiveDayOf,
  updateProfile,
} from '@/services/profile';

const authRoutes = Router();

authRoutes.post('/auth/register', async (req, res) => {
  const input = parseRegister(bodyOf(req));
  const { user, recoveryCode } = await registerUser(input);

  setAuthCookie(res, signAuthToken(user.id, user.sessionVersion), req);
  res.status(201).json({ user: toPublicUser(user, null), recoveryCode });
});

authRoutes.post('/auth/login', async (req, res) => {
  const { email, password } = parseLogin(bodyOf(req));
  const user = await authenticate(email, password);

  setAuthCookie(res, signAuthToken(user.id, user.sessionVersion), req);
  const salaryReceiveDay = await salaryReceiveDayOf(user.id);
  res.json({ user: toPublicUser(user, salaryReceiveDay) });
});

authRoutes.post('/auth/recovery-code', requireAuth, async (req, res) => {
  const currentPassword = parseCurrentPassword(bodyOf(req));
  const recoveryCode = await rotateRecoveryCode(
    requireUserId(req),
    currentPassword,
  );
  res.json({ recoveryCode });
});

authRoutes.post('/auth/recover-password', async (req, res) => {
  const { user, recoveryCode } = await recoverPasswordWithSession(
    parseRecoverPassword(bodyOf(req)),
  );
  // Recovery code is already a one-time high-entropy account credential.
  // A new session needs no further password check, which would be blocked
  // by an attacker exhausting the independent failed-login budget.
  setAuthCookie(res, signAuthToken(user.id, user.sessionVersion), req);
  res.json({ ok: true, recoveryCode, user: toPublicUser(user, null) });
});

authRoutes.post('/auth/logout', createLogoutHandler());

authRoutes.get('/auth/me', requireAuth, async (req, res) => {
  const salaryReceiveDay = await salaryReceiveDayOf(requireUserId(req));
  res.json({ user: { ...req.user, salaryReceiveDay } });
});

authRoutes.patch('/auth/me', requireAuth, async (req, res) => {
  const userId = requireUserId(req);
  const input = parseUpdateProfile(bodyOf(req));
  const user = await updateProfile(userId, input);

  res.json({ user: toPublicUser(user, await salaryReceiveDayOf(userId)) });
});

export default authRoutes;
