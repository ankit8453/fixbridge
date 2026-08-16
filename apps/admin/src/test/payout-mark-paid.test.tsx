import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PayoutBatchPage } from '../pages/PayoutBatchPage';
import { mockApi, renderAt, waitForCall } from './harness';

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
    const api = mockApi({
      'GET /api/v1/admin/payments/payout-batches/batch-1': { body: BATCH },
      'POST /api/v1/admin/payments/payouts/payout-1/paid': { body: { payout: {} } },
    });

    const user = userEvent.setup({ delay: null });
    renderAt(<PayoutBatchPage />, {
      path: '/money/batches/:batchId',
      route: '/money/batches/batch-1',
    });

    // The amount is in the dialog title so ops confirm the number, not the row.
    await user.click(await screen.findByRole('button', { name: 'Mark paid' }));
    expect(screen.getByRole('dialog', { name: /₹1,250.50/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record as paid' }));

    /**
     * A database CHECK refuses a paid payout with no bank reference. The dialog
     * has to refuse it first — otherwise the failure arrives as an opaque 500
     * after ops have already believed the money moved.
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
    const api = mockApi({
      'GET /api/v1/admin/payments/payout-batches/batch-1': { body: BATCH },
      'POST /api/v1/admin/payments/payouts/payout-1/failed': { body: { payout: {} } },
    });

    const user = userEvent.setup({ delay: null });
    renderAt(<PayoutBatchPage />, {
      path: '/money/batches/:batchId',
      route: '/money/batches/batch-1',
    });

    await user.click(await screen.findByRole('button', { name: 'Mark failed' }));
    await user.type(screen.getByLabelText('Note'), 'Account number rejected by the bank.');
    await user.click(screen.getByRole('button', { name: 'Record as failed' }));

    const call = await waitForCall(api, 'POST /api/v1/admin/payments/payouts/payout-1/failed');
    expect(call.body).toEqual({ note: 'Account number rejected by the bank.' });
  });
});
