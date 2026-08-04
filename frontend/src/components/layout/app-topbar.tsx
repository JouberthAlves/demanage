import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getInitials } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';

export function AppTopbar() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const displayName = user?.name || 'deManage';

  async function handleLogout() {
    await logout();
    toast.success('Sessão encerrada');
    navigate('/login', { replace: true });
  }

  return (
    <header className='flex h-14 shrink-0 justify-end border-b border-border bg-background/80 px-6 backdrop-blur md:px-8'>
      <div className='flex items-center gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              className='h-9 gap-2 rounded-full border border-border bg-card/40 px-2 pr-3'
            >
              <Avatar className='size-7'>
                <AvatarFallback className='bg-accent text-[11px] text-foreground'>
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <span className='hidden max-w-32 truncate text-sm sm:inline'>
                {displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-56'>
            <DropdownMenuLabel>
              <div className='flex flex-col gap-0.5'>
                <span className='truncate text-sm font-medium'>
                  {displayName}
                </span>
                {user?.email ? (
                  <span className='truncate text-xs text-muted-foreground'>
                    {user.email}
                  </span>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut data-icon='inline-start' />
                Sair
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
