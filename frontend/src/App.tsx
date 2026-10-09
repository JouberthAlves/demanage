import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';

import { TooltipProvider } from '@/components/ui/tooltip';
import { router } from '@/router';
import { useAuthStore } from '@/stores/auth-store';

export function App() {
  const sessionRevision = useAuthStore((state) => state.sessionRevision);

  // Never reuse cached financial responses across browser authentication sessions.
  // Old in-flight requests can only update their previous, detached QueryClient.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
    [sessionRevision],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors theme='dark' />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
