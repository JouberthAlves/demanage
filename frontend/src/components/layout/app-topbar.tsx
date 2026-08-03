import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';

export function AppTopbar() {
  const name = useFinanceStore((state) => state.profile.name);

  return (
    <header className='flex h-14 shrink-0 items-center justify-between border-b border-border px-6 md:px-8'>
      <div className='text-sm font-medium tracking-tight text-foreground'>
        deManage
      </div>
      <Avatar className='size-8'>
        <AvatarFallback className='bg-accent text-xs text-foreground'>
          {getInitials(name || 'deManage')}
        </AvatarFallback>
      </Avatar>
    </header>
  );
}
