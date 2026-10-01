export function resolveJwtSecret(
  value: string | undefined,
  nodeEnv: string | undefined,
) {
  const secret = value?.trim();
  if (
    nodeEnv === 'production' &&
    Buffer.byteLength(secret ?? '', 'utf8') < 32
  ) {
    throw new Error(
      '[deManage] JWT_SECRET must contain at least 32 bytes in production',
    );
  }
  return secret || 'demanage-dev-secret';
}
