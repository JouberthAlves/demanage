import type { ReactNode } from 'react';

type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className='relative flex min-h-screen items-center justify-center bg-background px-4'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,184,0,0.14),transparent_40%),radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.12),transparent_35%)]' />
      <div className='relative w-full max-w-md'>{children}</div>
    </div>
  );
}
