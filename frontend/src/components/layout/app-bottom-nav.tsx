import { NavLink } from 'react-router';

import { APP_NAV_ITEMS } from '@/components/layout/nav-items';
import { cn } from '@/lib/utils';

export function AppBottomNav() {
  return (
    <nav
      className='fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden'
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className='flex h-16 overflow-x-auto overscroll-x-contain'>
        {APP_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to} className='min-w-[72px] flex-1'>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium text-muted-foreground transition-colors',
                    isActive && 'text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span className='absolute top-0 h-0.5 w-8 rounded-full bg-neon-amber' />
                    ) : null}
                    <Icon className={cn('size-5', isActive && 'text-neon-amber')} />
                    <span className='max-w-[68px] truncate'>{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
