import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@fixbridge/shared';
import { RequireRole } from '@/lib/auth/guards';
import { AdminShell } from '@/components/admin/Shell';
import MoneyPage from '@/app/[locale]/admin/money/page';
import { mockApi, renderAdminPage } from './harness';

/**
 * New in Phase 12 — not a port. Phase 11's role gate lived entirely inside
 * apps/admin/src/auth/AuthProvider.tsx, which refused a non-ops/admin login
 * outright (see its `login.test.tsx`, not portable here — this app has no
 * console-specific login to refuse into, see this suite's report). The
 * equivalent risk in this app is `[locale]/admin/layout.tsx`'s `RequireRole`
 * never rendering `AdminShell`/`children` for the wrong role, and the two
 * money-moving actions the Phase 12 permission split newly restricts
 * (`ADMIN_ONLY_ROUTES` in apps/api/src/core/audit.ts) staying **absent**
 * rather than disabled for ops. Both are asserted directly here.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  usePathname: () => '/en/admin',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

let mockRoles: Role[] = ['ops'];
const mockUser = (roles: Role[]): AuthUser => ({
  id: 'u1',
  phone: '+9199999*****',
  name: 'Meena',
  roles,
  status: 'active',
  defaultCityId: 1,
  preferredLanguage: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
});

vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({
    status: 'signedIn',
    user: mockUser(mockRoles),
    roles: mockRoles,
    requestOtp: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function Gated() {
  return (
    <RequireRole role={['ops', 'admin']} redirectTo="/login">
      <AdminShell>
        <div>Overview content</div>
      </AdminShell>
    </RequireRole>
  );
}

describe('the /admin role gate', () => {
  it('renders no nav and no content for a customer token — absent, not disabled', () => {
    mockRoles = ['customer'];

    renderAdminPage(<Gated />);

    // The whole point of RequireRole returning `null` rather than a hidden
    // element: a customer who lands here (same OTP login as everyone else,
    // see Shell.tsx's comment) must find no trace of the console in the DOM.
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
    expect(screen.queryByText('Overview content')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Technicians' })).not.toBeInTheDocument();
  });

  it('renders the nav and content for an ops token', () => {
    mockRoles = ['ops'];

    renderAdminPage(<Gated />);

    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Overview content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Technicians' })).toBeInTheDocument();
  });

  it('renders the nav and content for an admin token', () => {
    mockRoles = ['admin'];

    renderAdminPage(<Gated />);

    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Overview content')).toBeInTheDocument();
  });
});

const EMPTY_SUMMARY = {
  queues: {
    verificationPending: 0,
    complaintsOpen: 0,
    reviewReports: 0,
    parkedOutbox: 0,
    parkedWebhooks: 0,
    parkedDeliveries: 0,
    heldDeliveries: 0,
    pendingBatches: 0,
    otpLockedBookings: 0,
    suspendedProviders: 0,
    pendingEntryApproval: 0,
  },
  bookings: { today: {}, todayTotal: 0 },
  money: {
    gmvTodayPaise: 0,
    gmv7dPaise: 0,
    gmv30dPaise: 0,
    revenuePaise: 0,
    gatewayCashPaise: 0,
    owedToProvidersPaise: 0,
    owedByProvidersPaise: 0,
  },
  generatedAt: '2026-08-17T09:00:00.000Z',
};

function mockMoneyReads() {
  return mockApi({
    'GET /api/v1/admin/summary': { body: EMPTY_SUMMARY },
    'GET /api/v1/admin/payout-batches': { body: { batches: [], page: 1, pageSize: 20, total: 0 } },
    'GET /api/v1/admin/ledger/journals': {
      body: { journals: [], page: 1, pageSize: 20, total: 0 },
    },
  });
}

describe('admin-only money actions, hidden for ops', () => {
  it('hides "Record a repayment" (dues settlement is admin-only) from an ops token', async () => {
    mockRoles = ['ops'];
    mockMoneyReads();

    renderAdminPage(<MoneyPage />);

    expect(await screen.findByText('Settle dues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a repayment' })).not.toBeInTheDocument();
    expect(screen.getByText(/only an admin account can record a settlement/i)).toBeInTheDocument();
  });

  it('shows "Record a repayment" for an admin token', async () => {
    mockRoles = ['admin'];
    mockMoneyReads();

    renderAdminPage(<MoneyPage />);

    expect(await screen.findByRole('button', { name: 'Record a repayment' })).toBeInTheDocument();
  });
});
