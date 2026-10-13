import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

type PasswordFieldsProps = {
  /** Prefixo dos ids (`register`, `recovery`): `${idPrefix}-password`, ... */
  idPrefix: string;
  password: string;
  confirmPassword: string;
  confirmError: string | null;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  passwordLabel?: string;
  confirmLabel?: string;
};

/** Par senha + confirmação com a mensagem de erro da confirmação. */
export function PasswordFields({
  idPrefix,
  password,
  confirmPassword,
  confirmError,
  onPasswordChange,
  onConfirmPasswordChange,
  passwordLabel = 'Senha',
  confirmLabel = 'Confirmar senha',
}: PasswordFieldsProps) {
  const confirmId = `${idPrefix}-confirm-password`;
  const confirmErrorId = `${confirmId}-error`;

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-password`}>
          {passwordLabel}
        </FieldLabel>
        <Input
          id={`${idPrefix}-password`}
          type='password'
          autoComplete='new-password'
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <FieldDescription>
          Mínimo de {MIN_PASSWORD_LENGTH} caracteres e máximo de{' '}
          {MAX_PASSWORD_BYTES} bytes em UTF-8.
        </FieldDescription>
      </Field>

      <Field data-invalid={confirmError ? true : undefined}>
        <FieldLabel htmlFor={confirmId}>{confirmLabel}</FieldLabel>
        <Input
          id={confirmId}
          type='password'
          autoComplete='new-password'
          value={confirmPassword}
          onChange={(event) => onConfirmPasswordChange(event.target.value)}
          aria-invalid={Boolean(confirmError)}
          aria-describedby={confirmError ? confirmErrorId : undefined}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        {confirmError ? (
          <FieldError id={confirmErrorId}>{confirmError}</FieldError>
        ) : null}
      </Field>
    </>
  );
}
