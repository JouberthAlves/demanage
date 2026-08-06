import { Outlet } from 'react-router';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppTopbar } from '@/components/layout/app-topbar';
import { useCards } from '@/hooks/use-cards';
import { useEntries } from '@/hooks/use-entries';
import { useExpenses } from '@/hooks/use-expenses';
import { usePiggyBanks } from '@/hooks/use-piggy-banks';

export function AppLayout() {
  useCards();
  useEntries();
  useExpenses();
  usePiggyBanks();

  return (
    <div className='flex min-h-screen bg-background text-foreground'>
      <AppSidebar />
      <div className='flex min-w-0 flex-1 flex-col'>
        <AppTopbar />
        <main className='relative flex-1 px-6 py-6 md:px-8'>
          <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,184,0,0.04),transparent_35%)]' />
          <div className='relative w-full'>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
