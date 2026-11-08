import {
  badRequest,
  conflict,
  forbidden,
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
// bcrypt cost 10, generated once offline. No request ever hashes a dummy
// password at runtime; missing and existing accounts both compare one hash.
const DUMMY_LOGIN_PASSWORD_HASH =
  '$2b$10$X.PHm9ikr7jqfq5BRg096emZR7SXrSmVLLYBol4HTz75XO30hQu4K';

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

export async function authenticate(
  email: string,
  password: string,
  userStore: Pick<typeof prisma.user, 'findUnique'> = prisma.user,
) {
  const user = await userStore.findUnique({ where: { email } });
  const matches = await comparePassword(
    password,
    user?.passwordHash ?? DUMMY_LOGIN_PASSWORD_HASH,
  );
  if (!user || !matches) {
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

/**
 * Validate and publish one recovery-code rotation against the same credential
 * snapshot. A password reset or session revocation between read and write
 * makes the CAS fail instead of publishing a code from stale authentication.
 */
export async function rotateRecoveryCodeInTransaction(
  userId: string,
  currentPassword: string,
  userStore: Pick<typeof prisma.user, 'findUnique' | 'updateMany'>,
) {
  const user = await userStore.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      sessionVersion: true,
      recoveryCodeHash: true,
    },
  });
  if (!user || !(await comparePassword(currentPassword, user.passwordHash))) {
    throw unauthorized('Senha atual inválida');
  }

  const recoveryCode = generateRecoveryCode();
  const { count } = await userStore.updateMany({
    // The snapshot is authenticated but may already have been superseded.
    // All credential/session fields must still match when this update commits.
    where: {
      id: userId,
      passwordHash: user.passwordHash,
      sessionVersion: user.sessionVersion,
      recoveryCodeHash: user.recoveryCodeHash,
    },
    data: {
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
      recoveryCodeCreatedAt: new Date(),
    },
  });
  if (count !== 1) throw unauthorized('Senha atual inválida');

  return recoveryCode;
}

export async function rotateRecoveryCode(
  userId: string,
  currentPassword: string,
) {
  const recoveryCode = await prisma.$transaction(
    (tx) => rotateRecoveryCodeInTransaction(userId, currentPassword, tx.user),
    { maxWait: 10_000, timeout: 15_000 },
  );

  console.info('[security] recovery_code_rotated', {
    userId,
    at: new Date().toISOString(),
  });
  return recoveryCode;
}

type AccountDeletionTx = Pick<
  typeof prisma,
  | 'user'
  | 'oAuthConnection'
  | 'oAuthArtifact'
  | 'piggyTransaction'
  | 'assetTransaction'
  | 'entryReceipt'
  | 'salaryVersion'
  | 'salaryHold'
  | 'expensePayment'
  | 'expenseSplit'
>;

/**
 * Remove the user and every row they own inside one transaction. Children
 * guarded by ON DELETE RESTRICT (receipts, payments, salary history, splits)
 * and ledger rows whose SET NULL would break CHECK constraints are removed
 * explicitly first; the User delete then cascades through the rest.
 */
export async function deleteAccountInTransaction(
  userId: string,
  currentPassword: string,
  tx: AccountDeletionTx,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true },
  });
  if (!user) throw unauthorized();
  // 403, not 401: a typo must not look like an expired session to the client.
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw forbidden('Senha atual inválida', 'INVALID_PASSWORD');
  }

  // Lock the row against a concurrent password reset or deletion; a stale
  // snapshot makes the CAS fail and the whole transaction roll back.
  const { count } = await tx.user.updateMany({
    where: {
      id: userId,
      passwordHash: user.passwordHash,
      sessionVersion: user.sessionVersion,
    },
    data: { sessionVersion: { increment: 1 } },
  });
  if (count !== 1) throw unauthorized('Senha atual inválida');

  const connections = await tx.oAuthConnection.findMany({
    where: { userId },
    select: { grantId: true },
  });
  const grantIds = connections.map((connection) => connection.grantId);
  if (grantIds.length) {
    await tx.oAuthArtifact.deleteMany({
      where: {
        OR: [
          { grantId: { in: grantIds } },
          { model: 'Grant', id: { in: grantIds } },
        ],
      },
    });
  }

  await tx.piggyTransaction.deleteMany({ where: { userId } });
  await tx.assetTransaction.deleteMany({ where: { userId } });
  await tx.entryReceipt.deleteMany({ where: { entry: { userId } } });
  await tx.salaryVersion.deleteMany({ where: { entry: { userId } } });
  await tx.salaryHold.deleteMany({ where: { entry: { userId } } });
  await tx.expensePayment.deleteMany({ where: { expense: { userId } } });
  await tx.expenseSplit.deleteMany({ where: { expense: { userId } } });
  await tx.user.delete({ where: { id: userId } });
}

export async function deleteAccount(userId: string, currentPassword: string) {
  await prisma.$transaction(
    (tx) => deleteAccountInTransaction(userId, currentPassword, tx),
    { maxWait: 10_000, timeout: 30_000 },
  );

  console.info('[security] account_deleted', {
    userId,
    at: new Date().toISOString(),
  });
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

/**
 * Consumes the offline recovery proof exactly once. The returned session
 * version is tied to the successful CAS, never a later read: a concurrent
 * logout/recovery must invalidate this token instead of minting a newer one.
 */
export async function recoverPasswordWithSession(
  input: RecoverPasswordInput,
  database: Pick<typeof prisma, 'user' | '$transaction'> = prisma,
) {
  const user = await database.user.findUnique({ where: { email: input.email } });
  if (
    !user?.recoveryCodeHash ||
    !verifyRecoveryCode(input.recoveryCode, user.recoveryCodeHash)
  ) {
    throw unauthorized(INVALID_RECOVERY_MESSAGE);
  }

  const passwordHash = await hashPassword(input.newPassword);
  const nextRecoveryCode = generateRecoveryCode();
  const nextSessionVersion = user.sessionVersion + 1;
  await database.$transaction(async (tx) => {
    // Password, session epoch and OAuth revocation either commit together or
    // all roll back. Updating User first locks its row against consent writes.
    const { count } = await tx.user.updateMany({
      where: {
        id: user.id,
        recoveryCodeHash: user.recoveryCodeHash,
        sessionVersion: user.sessionVersion,
      },
      data: {
        passwordHash,
        recoveryCodeHash: hashRecoveryCode(nextRecoveryCode),
        recoveryCodeCreatedAt: new Date(),
        sessionVersion: { increment: 1 },
        trustedDeviceVersion: { increment: 1 },
        trustedProofFailures: 0,
        trustedProofWindowAt: null,
      },
    });
    if (count !== 1) throw unauthorized(INVALID_RECOVERY_MESSAGE);

    // Password recovery revokes the independent possession factor atomically
    // with the session epoch and OAuth grants. Routine logout does not.
    await tx.trustedLoginDevice.updateMany({
      where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() },
    });

    const connections = await tx.oAuthConnection.findMany({
      where: { userId: user.id },
      select: { grantId: true },
    });
    await tx.oAuthConnection.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const grantIds = connections.map((connection) => connection.grantId);
    if (grantIds.length) {
      // Access, refresh and authorization-code objects all carry grantId.
      // The Grant object itself uses the ID as primary key.
      await tx.oAuthArtifact.deleteMany({
        where: { OR: [
          { grantId: { in: grantIds } },
          { model: 'Grant', id: { in: grantIds } },
        ] },
      });
    }
  });
  return {
    recoveryCode: nextRecoveryCode,
    user: { ...user, sessionVersion: nextSessionVersion },
  };
}

/** Backward-compatible password recovery for service and OAuth callers. */
export async function recoverPassword(
  input: RecoverPasswordInput,
  database: Pick<typeof prisma, 'user' | '$transaction'> = prisma,
) {
  const result = await recoverPasswordWithSession(input, database);
  return result.recoveryCode;
}
