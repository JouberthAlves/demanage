import {
  badRequest,
  conflict,
  isUniqueViolation,
  unauthorized,
} from '@/http/errors';
import { parseAbnt2Text, sanitizeAbnt2 } from '@/lib/abnt2';
import { comparePassword, hashPassword } from '@/lib/auth';
import { passwordPolicyError } from '@/lib/password-policy';
import { prisma } from '@/lib/prisma';
import {
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/lib/recovery-code';

const ABNT2_PASSWORD_MESSAGE =
  'Use apenas caracteres do teclado ABNT2 na senha';
const EMAIL_TAKEN_MESSAGE = 'E-mail já cadastrado';
const INVALID_RECOVERY_MESSAGE = 'E-mail ou código de recuperação inválidos';

/** String do corpo, ou `''` quando ausente/não-string (nunca lança). */
function stringField(value: unknown) {
  return typeof value === 'string' ? value : '';
}

/** Senha nova: apenas teclado ABNT2 e política de tamanho. */
export function assertValidNewPassword(password: string) {
  if (!sanitizeAbnt2(password) || sanitizeAbnt2(password) !== password) {
    throw badRequest(ABNT2_PASSWORD_MESSAGE);
  }
  const policyError = passwordPolicyError(password);
  if (policyError) throw badRequest(policyError);
}

export type RegisterInput = { name: string; email: string; password: string };

export function parseRegister(body: Record<string, unknown>): RegisterInput {
  const name = parseAbnt2Text(body.name, { maxLength: 100, required: true });
  const email = parseAbnt2Text(body.email, { required: true })?.toLowerCase();
  const password = body.password;

  if (
    // codeql[js/user-controlled-bypass] -- This validates required fields on intentionally public registration; it grants no existing-user permission.
    !name ||
    // codeql[js/user-controlled-bypass] -- This validates required fields on intentionally public registration; it grants no existing-user permission.
    !email ||
    typeof password !== 'string' ||
    // codeql[js/user-controlled-bypass] -- This validates required fields on intentionally public registration; it grants no existing-user permission.
    !password
  ) {
    throw badRequest('Campos obrigatórios: name, email, password');
  }

  assertValidNewPassword(password);
  return { name, email, password };
}

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw conflict(EMAIL_TAKEN_MESSAGE);

  const passwordHash = await hashPassword(input.password);
  const recoveryCode = generateRecoveryCode();
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        recoveryCodeHash: hashRecoveryCode(recoveryCode),
        recoveryCodeCreatedAt: new Date(),
      },
    });
    return { user, recoveryCode };
  } catch (error) {
    // Cadastro concorrente com o mesmo e-mail passa pelo pré-check acima.
    if (isUniqueViolation(error)) throw conflict(EMAIL_TAKEN_MESSAGE);
    throw error;
  }
}

export function parseLogin(body: Record<string, unknown>) {
  const email = stringField(body.email).trim().toLowerCase();
  const password = stringField(body.password);
  if (!email || !password) {
    throw badRequest('Campos obrigatórios: email, password');
  }
  return { email, password };
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw unauthorized('E-mail ou senha inválidos');
  }
  return user;
}

export function parseCurrentPassword(body: Record<string, unknown>) {
  const password = body.currentPassword;
  if (typeof password !== 'string' || !password) {
    throw badRequest('Informe a senha atual');
  }
  return password;
}

export async function rotateRecoveryCode(
  userId: string,
  currentPassword: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user || !(await comparePassword(currentPassword, user.passwordHash))) {
    throw unauthorized('Senha atual inválida');
  }

  const recoveryCode = generateRecoveryCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
      recoveryCodeCreatedAt: new Date(),
    },
  });

  console.info('[security] recovery_code_rotated', {
    userId,
    at: new Date().toISOString(),
  });
  return recoveryCode;
}

export type RecoverPasswordInput = {
  email: string;
  recoveryCode: string;
  newPassword: string;
};

export function parseRecoverPassword(
  body: Record<string, unknown>,
): RecoverPasswordInput {
  const email = stringField(body.email).trim().toLowerCase();
  const recoveryCode = stringField(body.recoveryCode).trim();
  const newPassword = body.newPassword;

  if (
    // codeql[js/user-controlled-bypass] -- These are request-shape checks; the password change is authorized by verifyRecoveryCode below.
    !email ||
    // codeql[js/user-controlled-bypass] -- These are request-shape checks; the password change is authorized by verifyRecoveryCode below.
    !recoveryCode ||
    typeof newPassword !== 'string' ||
    // codeql[js/user-controlled-bypass] -- These are request-shape checks; the password change is authorized by verifyRecoveryCode below.
    !newPassword
  ) {
    throw badRequest('Campos obrigatórios: email, recoveryCode, newPassword');
  }

  assertValidNewPassword(newPassword);
  return { email, recoveryCode, newPassword };
}

/** Troca a senha com o código de recuperação, revoga sessões e gira o código. */
export async function recoverPassword(input: RecoverPasswordInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (
    !user?.recoveryCodeHash ||
    !verifyRecoveryCode(input.recoveryCode, user.recoveryCodeHash)
  ) {
    throw unauthorized(INVALID_RECOVERY_MESSAGE);
  }

  const passwordHash = await hashPassword(input.newPassword);
  const nextRecoveryCode = generateRecoveryCode();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      recoveryCodeHash: hashRecoveryCode(nextRecoveryCode),
      recoveryCodeCreatedAt: new Date(),
      sessionVersion: { increment: 1 },
    },
  });
  return nextRecoveryCode;
}
