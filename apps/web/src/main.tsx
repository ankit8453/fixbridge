import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './lib/auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { createQueryClient } from './lib/api';
import { router } from './router/router';
import './index.css';

/**
 * Provider order, outside-in:
 *
 *  1. `AuthProvider` — everything else, including the router's route guards
 *     (`RequireAuth`/`RequireRole`), reads `useAuth()`.
 *  2. `QueryClientProvider` — one client for the whole app (see `lib/api.ts`'s
 *     `createQueryClient`); mutations that call `logout()` need `AuthProvider`
 *     above them, not below.
 *  3. `ToastProvider` — the one place `useToast()` can be called from,
 *     mounted above the router so a toast can survive a navigation that
 *     triggered it (e.g. "payment recorded" firing just before a redirect).
 *  4. `RouterProvider` — the route tree itself (`router/router.tsx`).
 */
const queryClient = createQueryClient();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {/* v7_startTransition: the other React Router v7 future flag —
              see router/router.tsx's own comment on v7_relativeSplatPath. */}
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
