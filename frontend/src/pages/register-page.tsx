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
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/api-error';
import { useAuthStore } from '@/stores/auth-store';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<
    string | null
  >(null);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  if (isLoading) return <AuthLoading />;

  if (isAuthenticated && !recoveryCode) {
    return <Navigate to='/' replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setEmailError(null);
    setConfirmPasswordError(null);

    const issue = validatePasswordPair(password, confirmPassword);
    if (issue) {
      if (issue.field === 'confirm-password') {
        setConfirmPasswordError(issue.message);
      } else {
        setError(issue.message);
      }
      toast.error(issue.message);
      document.getElementById(`register-${issue.field}`)?.focus();
      return;
    }

    setSubmitting(true);

    try {
      const result = await register(name.trim(), email.trim(), password);
      setRecoveryCode(result.recoveryCode);
      toast.success('Conta criada');
    } catch (err) {
      const message = getApiErrorMessage(err, 'Não foi possível criar a conta');
      if (getApiErrorStatus(err) === 409) {
        setEmailError(message);
      } else {
        setError(message);
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryCode) {
    return (
      <AuthCard
        brandTitle='Conta criada'
        brandSubtitle='Salve seu código antes de continuar'
        title='Seu código offline'
        description='Ele permite redefinir sua senha sem e-mail ou SMS.'
        footer={
          <Button
            type='button'
            className='w-full'
            onClick={() => navigate('/', { replace: true })}
          >
            Já guardei, continuar
          </Button>
        }
      >
        <RecoveryCodePanel recoveryCode={recoveryCode} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      brandTitle='deManage'
      brandSubtitle='Comece a organizar seu mês'
      title='Criar conta'
      description='Cadastre-se para começar a usar o deManage.'
      footer={
        <FieldDescription>
          Já tem conta?{' '}
          <Link to='/login' className='underline underline-offset-4'>
            Entrar
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
            <FieldLabel htmlFor='register-name'>Nome</FieldLabel>
            <Input
              id='register-name'
              type='text'
              autoComplete='name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field data-invalid={emailError ? true : undefined}>
            <FieldLabel htmlFor='register-email'>E-mail</FieldLabel>
            <Input
              id='register-email'
              type='email'
              autoComplete='email'
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'register-email-error' : undefined}
              required
            />
            {emailError ? (
              <FieldError id='register-email-error'>{emailError}</FieldError>
            ) : null}
          </Field>
          <PasswordFields
            idPrefix='register'
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
            Criar conta
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
