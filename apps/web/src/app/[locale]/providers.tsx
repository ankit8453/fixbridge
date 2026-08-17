'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/api';
import { AuthProvider } from '@/lib/auth/AuthProvider';

/**
 * `useState`'s lazy initialiser, not a module-level singleton.
 *
 * This component renders on the server for the initial HTML too (it is
 * `'use client'`, not client-only), and a `QueryClient` created at module
 * scope would be shared across every concurrent request that server process
 * handles — one visitor's cached data leaking into another's response. Each
 * render call gets its own instance instead; React reuses it across
 * re-renders on the client the normal way.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
