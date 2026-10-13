import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { TooltipProvider } from '@/components/ui/tooltip';
import { shouldRetryReadRequest } from '@/lib/query-retry';
import { router } from '@/router';
import { useAuthStore } from '@/stores/auth-store';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: shouldRetryReadRequest,
      },
    },
  });
}

/**
 * One QueryClient per authentication session: cached financial responses are
 * never reused across accounts, and the previous cache is dropped from memory.
 * Late in-flight requests can only update their own, detached client.
 */
function SessionQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => () => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export function App() {
  const sessionRevision = useAuthStore((state) => state.sessionRevision);

  return (
    <TooltipProvider>
      <SessionQueryProvider key={sessionRevision}>
        <RouterProvider router={router} />
      </SessionQueryProvider>
      <Toaster richColors theme='dark' />
    </TooltipProvider>
  );
}
