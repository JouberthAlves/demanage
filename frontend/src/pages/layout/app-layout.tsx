import { Outlet } from 'react-router';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppTopbar } from '@/components/layout/app-topbar';
import { useCards } from '@/hooks/use-cards';
import { useEntries } from '@/hooks/use-entries';
import { useExpenses } from '@/hooks/use-expenses';

export function AppLayout() {
  useCards();
  useEntries();
  useExpenses();

  return (
    <div className='flex min-h-screen bg-background text-foreground'>
      <AppSidebar />
      <div className='flex min-w-0 flex-1 flex-col'>
        <AppTopbar />
        <main className='flex-1 px-6 py-6 md:px-8'>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
