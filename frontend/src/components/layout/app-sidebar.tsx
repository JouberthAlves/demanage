import {
  LayoutDashboard,
  PiggyBank,
  Receipt,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { NavLink } from 'react-router';
import logo from '../../../public/favicon.svg';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/perfil', label: 'Perfil', icon: UserRound },
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/despesas', label: 'Despesas', icon: Receipt },
  { to: '/cofrinho', label: 'Cofrinho', icon: PiggyBank },
  { to: '/entradas', label: 'Entradas', icon: TrendingUp },
];

export function AppSidebar() {
  return (
    <aside className='sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-border bg-card/20 pb-5'>
      <div className='flex items-center justify-center w-full'>
        <img src={logo} alt='logo' className=' mt-4 size-10 border-b w-full' />
      </div>
      <nav className='flex flex-1 flex-col items-center gap-2'>
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      isActive &&
                        'bg-accent text-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.06)]',
                      isActive &&
                        'before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-full before:bg-neon-amber',
                    )
                  }
                >
                  <Icon className='size-5' />
                  <span className='sr-only'>{item.label}</span>
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side='right'>{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
