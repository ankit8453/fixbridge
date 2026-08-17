import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@fixbridge/shared';
import { RequireRole } from '@/lib/auth/guards';
import AdminAppEntry from '../AdminAppEntry';
import MoneyPage from '../pages/MoneyPage';
import { mockApi, testQueryClient } from '@/test/harness';

/**
 * Ported from `legacy-next-src/components/admin/__tests__/role-gate.test.tsx`.
 * The equivalent risk in this app is `router/router.tsx`'s
 * `RequireRole(['ops','admin'])` never rendering `AdminShell`/`children` for
 * the wrong role, and the two money-moving actions the permission split
 * restricts (`ADMIN_ONLY_ROUTES` in `apps/api/src/core/audit.ts`) staying
 * **absent** rather than disabled for ops. Both are asserted directly here.
 */

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
    adminPasswordStep: vi.fn(),
    adminLogin: vi.fn(),
    logout: vi.fn(),
  }),
}));

function Gated() {
  return (
    <RequireRole role={['ops', 'admin']} redirectTo="/admin/login">
      <AdminAppEntry />
    </RequireRole>
  );
}

function renderGated(path = '/admin') {
  mockApi({
    'GET /api/v1/admin/summary': {
      body: {
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
      },
    },
  });

  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<Gated />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the /admin role gate', () => {
  it('renders no nav and no content for a customer token — absent, not disabled', () => {
    mockRoles = ['customer'];

    renderGated();

    // The whole point of RequireRole returning a redirect rather than a
    // hidden element: a customer who lands here must find no trace of the
    // console in the DOM.
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Technicians' })).not.toBeInTheDocument();
  });

  it('renders the nav and content for an ops token', async () => {
    mockRoles = ['ops'];

    renderGated();

    expect(await screen.findByRole('link', { name: 'Technicians' })).toBeInTheDocument();
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
  });

  it('renders the nav and content for an admin token', async () => {
    mockRoles = ['admin'];

    renderGated();

    expect(await screen.findByRole('link', { name: 'Technicians' })).toBeInTheDocument();
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

function renderMoneyPage() {
  mockApi({
    'GET /api/v1/admin/summary': { body: EMPTY_SUMMARY },
    'GET /api/v1/admin/payout-batches': { body: { batches: [], page: 1, pageSize: 20, total: 0 } },
    'GET /api/v1/admin/ledger/journals': {
      body: { journals: [], page: 1, pageSize: 20, total: 0 },
    },
  });

  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={['/admin/money']}>
        <MoneyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('admin-only money actions, hidden for ops', () => {
  it('hides "Record a repayment" (dues settlement is admin-only) from an ops token', async () => {
    mockRoles = ['ops'];

    renderMoneyPage();

    expect(await screen.findByText('Settle dues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a repayment' })).not.toBeInTheDocument();
    expect(screen.getByText(/only an admin account can record a settlement/i)).toBeInTheDocument();
  });

  it('shows "Record a repayment" for an admin token', async () => {
    mockRoles = ['admin'];

    renderMoneyPage();

    expect(await screen.findByRole('button', { name: 'Record a repayment' })).toBeInTheDocument();
  });
});
