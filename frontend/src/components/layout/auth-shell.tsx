import type { ReactNode } from 'react';

type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className='relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,184,0,0.16),transparent_42%),radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.14),transparent_38%)]' />
      <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-amber/40 to-transparent' />
      <div className='relative w-full max-w-md'>{children}</div>
    </div>
  );
}
