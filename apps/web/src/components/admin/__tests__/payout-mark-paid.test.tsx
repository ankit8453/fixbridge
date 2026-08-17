import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PayoutBatchPage from '@/app/[locale]/admin/money/batches/[batchId]/page';
import { mockApi, renderAdminPage, waitForCall } from './harness';

/**
 * Ported from apps/admin/src/test/payout-mark-paid.test.tsx, plus one new
 * case: the Phase 12 permission split moved "mark paid"/"mark failed" to
 * `ADMIN_ONLY_ROUTES` (apps/api/src/core/audit.ts). The two original cases
 * below are otherwise unchanged; `mockRoles` controls which token the page
 * renders under.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en', batchId: 'batch-1' }),
  usePathname: () => '/en/admin/money/batches/batch-1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

let mockRoles: string[] = ['admin'];
vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({
    status: 'signedIn',
    user: { id: 'u1', name: 'Meena', phone: '+9199999*****', roles: mockRoles, status: 'active' },
    roles: mockRoles,
    requestOtp: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const BATCH = {
  batch: {
    id: 'batch-1',
    status: 'processing',
    windowEnd: '2026-08-15T18:29:59.000Z',
    totalPaise: 125050,
    payoutCount: 1,
    createdAt: '2026-08-16T04:00:00.000Z',
    completedAt: null,
    payouts: [
      {
        id: 'payout-1',
        providerId: 'provider-1',
        amountPaise: 125050,
        status: 'pending',
        utrRef: null,
        createdAt: '2026-08-16T04:00:00.000Z',
        paidAt: null,
      },
    ],
  },
};

describe('marking a payout paid', () => {
  it('refuses an empty UTR and then sends the reference it was given', async () => {
    mockRoles = ['admin'];

    const api = mockApi({
      'GET /api/v1/admin/payments/payout-batches/batch-1': { body: BATCH },
      'POST /api/v1/admin/payments/payouts/payout-1/paid': { body: { payout: {} } },
    });

    const user = userEvent.setup({ delay: null });
    renderAdminPage(<PayoutBatchPage />);

    // The amount is in the dialog title so ops confirm the number, not the row.
    await user.click(await screen.findByRole('button', { name: 'Mark paid' }));
    expect(screen.getByRole('dialog', { name: /₹1,250.50/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record as paid' }));

    /**
     * A database CHECK refuses a paid payout with no bank reference. The
     * dialog has to refuse it first — otherwise the failure arrives as an
     * opaque 500 after ops have already believed the money moved.
     */
    expect(await screen.findByText('UTR / bank reference is required.')).toBeInTheDocument();
    expect(api.lastCall('POST /api/v1/admin/payments/payouts/payout-1/paid')).toBeUndefined();

    await user.type(screen.getByLabelText('UTR / bank reference'), '  N123456789012345  ');
    await user.click(screen.getByRole('button', { name: 'Record as paid' }));

    const call = await waitForCall(api, 'POST /api/v1/admin/payments/payouts/payout-1/paid');

    // Trimmed: a UTR pasted out of a bank portal routinely arrives with padding,
    // and a reference with a leading space does not match at the bank.
    expect(call.body).toEqual({ utrRef: 'N123456789012345' });
  });

  it('sends a note when a payout failed at the bank', async () => {
    mockRoles = ['admin'];

    const api = mockApi({
      'GET /api/v1/admin/payments/payout-batches/batch-1': { body: BATCH },
      'POST /api/v1/admin/payments/payouts/payout-1/failed': { body: { payout: {} } },
    });

    const user = userEvent.setup({ delay: null });
    renderAdminPage(<PayoutBatchPage />);

    await user.click(await screen.findByRole('button', { name: 'Mark failed' }));
    await user.type(screen.getByLabelText('Note'), 'Account number rejected by the bank.');
    await user.click(screen.getByRole('button', { name: 'Record as failed' }));

    const call = await waitForCall(api, 'POST /api/v1/admin/payments/payouts/payout-1/failed');
    expect(call.body).toEqual({ note: 'Account number rejected by the bank.' });
  });

  it('Phase 12: hides Mark paid/Mark failed from an ops token — admin-only route', async () => {
    mockRoles = ['ops'];

    mockApi({ 'GET /api/v1/admin/payments/payout-batches/batch-1': { body: BATCH } });

    renderAdminPage(<PayoutBatchPage />);

    // The batch and its lines still load and render for ops — this is a
    // judgment-adjacent read, not a money-moving action — only the two
    // admin-only buttons are gone, not the whole row.
    expect(await screen.findByText('Payouts (1)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark failed' })).not.toBeInTheDocument();
    // "Close batch" is not admin-only (payout batch create/review stays ops
    // judgment work), so it must still be there.
    expect(screen.getByRole('button', { name: 'Close batch' })).toBeInTheDocument();
  });
});
