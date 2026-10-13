import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';

import { AuthCard, AuthLoading } from '@/components/auth/auth-card';
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

const TRANSIENT_MESSAGE =
  'A API não respondeu. Tenta de novo em alguns segundos.';

/** Timeouts, network drops and gateway errors: the request may not have reached the API. */
function isTransientFailure(err: unknown) {
  return (
    isAxiosError(err) &&
    (err.code === 'ECONNABORTED' ||
      err.code === 'ERR_NETWORK' ||
      err.response?.status === 504 ||
      err.response?.status === 502)
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  if (isLoading) return <AuthLoading />;

  if (isAuthenticated) {
    return <Navigate to='/' replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      toast.success('Login realizado');
      navigate('/', { replace: true });
    } catch (err) {
      const message = isTransientFailure(err)
        ? TRANSIENT_MESSAGE
        : getApiErrorMessage(err, 'Não foi possível entrar');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      brandTitle='deManage'
      brandSubtitle='Suas finanças, no controle'
      glow='amber'
      title='Entrar'
      description='Acesse sua conta para continuar gerenciando suas finanças.'
      footer={
        <FieldDescription>
          Não tem conta?{' '}
          <Link to='/register' className='underline underline-offset-4'>
            Criar conta
          </Link>
        </FieldDescription>
      }
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {error ? (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor='login-email'>E-mail</FieldLabel>
            <Input
              id='login-email'
              type='email'
              autoComplete='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='login-password'>Senha</FieldLabel>
            <Input
              id='login-password'
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <FieldDescription>
              <Link
                to='/recuperar-senha'
                className='underline underline-offset-4'
              >
                Esqueci minha senha
              </Link>
            </FieldDescription>
          </Field>
          <Button type='submit' className='w-full' disabled={submitting}>
            {submitting ? <Spinner data-icon='inline-start' /> : null}
            Entrar
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
