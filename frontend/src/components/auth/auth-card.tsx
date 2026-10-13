import type { ReactNode } from 'react';

import { AuthShell } from '@/components/layout/auth-shell';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const GLOW_CLASS = {
  amber: 'drop-shadow-[0_0_24px_rgba(255,184,0,0.35)]',
  green: 'drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]',
} as const;

type AuthCardProps = {
  brandTitle: string;
  brandSubtitle: string;
  glow?: keyof typeof GLOW_CLASS;
  title: string;
  description: string;
  footer?: ReactNode;
  children: ReactNode;
};

/** Shell comum das telas de autenticação: marca + cartão com título. */
export function AuthCard({
  brandTitle,
  brandSubtitle,
  glow = 'green',
  title,
  description,
  footer,
  children,
}: AuthCardProps) {
  return (
    <AuthShell>
      <div className='mb-8 flex flex-col items-center gap-3 text-center'>
        <img
          src='/favicon.svg'
          alt='deManage'
          className={cn('size-16', GLOW_CLASS[glow])}
        />
        <div>
          <p className='text-2xl font-semibold tracking-tight'>{brandTitle}</p>
          <p className='mt-1 text-sm text-muted-foreground'>{brandSubtitle}</p>
        </div>
      </div>

      <Card
        className='w-full border-white/10 bg-card/55 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur-xl'
        size='sm'
      >
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer ? <CardFooter>{footer}</CardFooter> : null}
      </Card>
    </AuthShell>
  );
}

export function AuthLoading() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-background'>
      <Spinner className='size-6' />
    </div>
  );
}
