import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';

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
    setSubmitting(true);

    try {
      await register(name.trim(), email.trim(), password);
      toast.success('Conta criada');
      navigate('/', { replace: true });
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível criar a conta')
        : 'Não foi possível criar a conta';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-background px-4'>
      <Card className='w-full max-w-md' size='sm'>
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
          <CardDescription>
            Cadastre-se para começar a usar o deManage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor='register-name'>Nome</FieldLabel>
                <Input
                  id='register-name'
                  type='text'
                  autoComplete='name'
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={Boolean(error)}
                  required
                />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor='register-email'>E-mail</FieldLabel>
                <Input
                  id='register-email'
                  type='email'
                  autoComplete='email'
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(error)}
                  required
                />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor='register-password'>Senha</FieldLabel>
                <Input
                  id='register-password'
                  type='password'
                  autoComplete='new-password'
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error)}
                  minLength={6}
                  required
                />
                <FieldDescription>Mínimo de 6 caracteres.</FieldDescription>
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <Button type='submit' className='w-full' disabled={submitting}>
                {submitting ? <Spinner data-icon='inline-start' /> : null}
                Criar conta
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <FieldDescription>
            Já tem conta?{' '}
            <Link to='/login' className='underline underline-offset-4'>
              Entrar
            </Link>
          </FieldDescription>
        </CardFooter>
      </Card>
    </div>
  );
}
