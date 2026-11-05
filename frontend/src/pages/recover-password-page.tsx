import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { AuthCard, AuthLoading } from '@/components/auth/auth-card';
import { PasswordFields } from '@/components/auth/password-fields';
import { validatePasswordPair } from '@/components/auth/password-validation';
import { RecoveryCodePanel } from '@/components/auth/recovery-code-panel';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuthStore } from '@/stores/auth-store';

export function RecoverPasswordPage() {
  const navigate = useNavigate();
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const recoverWithCode = useAuthStore((state) => state.recoverWithCode);
  const acknowledgeRecoveryCode = useAuthStore((state) => state.acknowledgeRecoveryCode);
  const nextRecoveryCode = useAuthStore((state) => state.pendingRecoveryCode);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<
    string | null
  >(null);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  if (isLoading) return <AuthLoading />;

  if (isAuthenticated && !nextRecoveryCode && !submitting) {
    return <Navigate to='/' replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setConfirmPasswordError(null);

    const issue = validatePasswordPair(password, confirmPassword);
    if (issue) {
      if (issue.field === 'confirm-password') {
        setConfirmPasswordError(issue.message);
      } else {
        setError(issue.message);
      }
      toast.error(issue.message);
      document.getElementById(`recovery-${issue.field}`)?.focus();
      return;
    }

    setSubmitting(true);

    try {
      await recoverWithCode(
        email.trim(), recoveryCode.trim(), password,
      );
      toast.success('Senha redefinida');
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        'Não foi possível recuperar a senha',
      );
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      brandTitle='Recuperar senha'
      brandSubtitle='Use o código que você guardou offline'
      title={nextRecoveryCode ? 'Senha alterada' : 'Código de recuperação'}
      description={
        nextRecoveryCode
          ? 'Você já está conectado. Seu código antigo foi invalidado; salve o novo código abaixo antes de continuar.'
          : 'Não é necessário e-mail, SMS ou serviço externo.'
      }
      footer={nextRecoveryCode ? (
        <Button type='button' className='w-full' onClick={() => {
          acknowledgeRecoveryCode();
          navigate('/', { replace: true });
        }}>
          Já guardei, continuar
        </Button>
      ) : (
        <FieldDescription>
          <Link to='/login' className='underline underline-offset-4'>
            Voltar para o login
          </Link>
        </FieldDescription>
      )}
    >
      {nextRecoveryCode ? (
        <RecoveryCodePanel recoveryCode={nextRecoveryCode} />
      ) : (
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {error ? (
              <p role='alert' className='text-sm text-destructive'>
                {error}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor='recovery-email'>E-mail</FieldLabel>
              <Input
                id='recovery-email'
                type='email'
                autoComplete='email'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor='recovery-code'>Código offline</FieldLabel>
              <Input
                id='recovery-code'
                type='text'
                autoComplete='off'
                autoCapitalize='characters'
                spellCheck={false}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder='XXXXX-XXXXX-XXXXX-XXXXX'
                required
              />
              <FieldDescription>
                Hífens e espaços são ignorados.
              </FieldDescription>
            </Field>

            <PasswordFields
              idPrefix='recovery'
              passwordLabel='Nova senha'
              confirmLabel='Confirmar nova senha'
              password={password}
              confirmPassword={confirmPassword}
              confirmError={confirmPasswordError}
              onPasswordChange={(value) => {
                setPassword(value);
                setConfirmPasswordError(null);
              }}
              onConfirmPasswordChange={(value) => {
                setConfirmPassword(value);
                setConfirmPasswordError(null);
              }}
            />

            <Button type='submit' className='w-full' disabled={submitting}>
              {submitting ? <Spinner data-icon='inline-start' /> : null}
              Redefinir senha
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthCard>
  );
}
