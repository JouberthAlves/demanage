import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { toast } from 'sonner';

import { RecoveryCodePanel } from '@/components/auth/recovery-code-panel';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function RecoverPasswordPage() {
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nextRecoveryCode, setNextRecoveryCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <Spinner className='size-6' />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to='/' replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      const message = 'As senhas não coincidem';
      setError(message);
      toast.error(message);
      return;
    }

    setSubmitting(true);

    try {
      const { data } = await api.post<{ recoveryCode: string }>(
        '/auth/recover-password',
        {
          email: email.trim(),
          recoveryCode: recoveryCode.trim(),
          newPassword: password,
        },
      );
      setNextRecoveryCode(data.recoveryCode);
      toast.success('Senha redefinida');
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível recuperar a senha')
        : 'Não foi possível recuperar a senha';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className='mb-8 flex flex-col items-center gap-3 text-center'>
        <img
          src='/favicon.svg'
          alt='deManage'
          className='size-16 drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]'
        />
        <div>
          <p className='text-2xl font-semibold tracking-tight'>Recuperar senha</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            Use o código que você guardou offline
          </p>
        </div>
      </div>

      <Card
        className='w-full border-white/10 bg-card/55 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur-xl'
        size='sm'
      >
        <CardHeader>
          <CardTitle>
            {nextRecoveryCode ? 'Senha alterada' : 'Código de recuperação'}
          </CardTitle>
          <CardDescription>
            {nextRecoveryCode
              ? 'Seu código antigo foi invalidado. Salve o novo código abaixo.'
              : 'Não é necessário e-mail, SMS ou serviço externo.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {nextRecoveryCode ? (
            <RecoveryCodePanel recoveryCode={nextRecoveryCode} />
          ) : (
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor='recovery-email'>E-mail</FieldLabel>
                  <Input
                    id='recovery-email'
                    type='email'
                    autoComplete='email'
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-invalid={Boolean(error)}
                    required
                  />
                </Field>

                <Field data-invalid={error ? true : undefined}>
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
                    aria-invalid={Boolean(error)}
                    required
                  />
                  <FieldDescription>
                    Hífens e espaços são ignorados.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor='recovery-password'>Nova senha</FieldLabel>
                  <Input
                    id='recovery-password'
                    type='password'
                    autoComplete='new-password'
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={6}
                    required
                  />
                </Field>

                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor='recovery-confirm-password'>
                    Confirmar nova senha
                  </FieldLabel>
                  <Input
                    id='recovery-confirm-password'
                    type='password'
                    autoComplete='new-password'
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    aria-invalid={Boolean(error)}
                    minLength={6}
                    required
                  />
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>

                <Button type='submit' className='w-full' disabled={submitting}>
                  {submitting ? <Spinner data-icon='inline-start' /> : null}
                  Redefinir senha
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>

        <CardFooter>
          <FieldDescription>
            <Link to='/login' className='underline underline-offset-4'>
              {nextRecoveryCode ? 'Ir para o login' : 'Voltar para o login'}
            </Link>
          </FieldDescription>
        </CardFooter>
      </Card>
    </AuthShell>
  );
}
