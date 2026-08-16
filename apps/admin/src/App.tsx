import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui/States';
import { ApiError } from './lib/api';
import { AuditPage } from './pages/AuditPage';
import { BookingDetailPage } from './pages/BookingDetailPage';
import { BookingsPage } from './pages/BookingsPage';
import { ComplaintDetailPage } from './pages/ComplaintDetailPage';
import { ComplaintsPage } from './pages/ComplaintsPage';
import { JournalDetailPage } from './pages/JournalDetailPage';
import { LoginPage } from './pages/LoginPage';
import { MoneyPage } from './pages/MoneyPage';
import { OverviewPage } from './pages/OverviewPage';
import { PayoutBatchPage } from './pages/PayoutBatchPage';
import { ProviderDetailPage } from './pages/ProviderDetailPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { QueuesPage } from './pages/QueuesPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { VerificationCasePage } from './pages/VerificationCasePage';
import { VerificationQueuePage } from './pages/VerificationQueuePage';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Nothing is cached for long and nothing is retried blindly.
         *
         * An ops screen showing a number that was true five minutes ago is worse
         * than a slightly slower one showing the truth — the same reasoning the
         * API's admin repository states for caching nothing server-side.
         */
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // A 4xx is an answer, not a hiccup. Retrying a 403 three times only
          // makes the error state take three times as long to appear.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** The door. Everything behind it assumes an ops or admin session exists. */
function RequireOps({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'restoring') return <Spinner label="Restoring your session…" />;
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location }} />;

  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireOps>
            <Layout />
          </RequireOps>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/verification" element={<VerificationQueuePage />} />
        <Route path="/verification/:caseId" element={<VerificationCasePage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/providers/:providerId" element={<ProviderDetailPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/bookings/:bookingId" element={<BookingDetailPage />} />
        <Route path="/complaints" element={<ComplaintsPage />} />
        <Route path="/complaints/:complaintId" element={<ComplaintDetailPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/money" element={<MoneyPage />} />
        <Route path="/money/batches/:batchId" element={<PayoutBatchPage />} />
        <Route path="/money/journals/:journalId" element={<JournalDetailPage />} />
        <Route path="/queues" element={<QueuesPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Providers without a router.
 *
 * The router stays outside so tests can mount the same tree inside a
 * `MemoryRouter` at any route — the alternative is a component that can only
 * ever be tested through the browser's address bar.
 */
export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient ?? createQueryClient()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
