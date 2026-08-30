import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../components/ui/Toast';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ComplaintDetailPage from '../pages/ComplaintDetailPage';
import { mockApi, testQueryClient, waitForCall } from '@/test/harness';

/** Ported from `legacy-next-src/components/admin/__tests__/complaint-resolve.test.tsx`, unchanged. */

const COMPLAINT = {
  complaint: {
    id: 'complaint-1',
    bookingId: 'booking-1',
    category: 'quality',
    description: 'It stopped working again after two days.',
    status: 'in_review',
    raisedByUserId: 'customer-1',
    againstUserId: 'provider-1',
    resolutionNote: null,
    severity: null,
    createdAt: '2026-08-14T11:00:00.000Z',
  },
};

const TIMELINE = {
  booking: {
    id: 'booking-1',
    status: 'WORK_DONE',
    startsAt: '2026-08-12T05:00:00.000Z',
    endsAt: '2026-08-12T06:00:00.000Z',
    problemNote: 'Fan not running',
    addressSnapshot: null,
    visitFeePaise: 4900,
    payablePaise: 120000,
    payableBreakdown: null,
    priceCardAmountPaise: null,
    createdAt: '2026-08-11T09:00:00.000Z',
    customer: { id: 'customer-1', name: 'Priya', phone: '+9198765*****' },
    provider: { userId: 'provider-1', displayName: 'Ramesh', user: { phone: '+9198111*****' } },
    category: { nameKey: 'categories.applianceRepair' },
    events: [
      {
        id: 'ev1',
        eventType: 'created',
        actorType: 'customer',
        createdAt: '2026-08-11T09:00:00.000Z',
      },
    ],
    quotations: [],
    payments: [],
    reviews: [],
    complaints: [],
  },
  notifications: [],
  otpLocked: false,
};

function renderComplaintPage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/admin/complaints/complaint-1']}>
          <Routes>
            <Route path="/admin/complaints/:complaintId" element={<ComplaintDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('resolving a complaint', () => {
  it('requires both a severity and a note, then sends them together', async () => {
    const api = mockApi({
      'GET /api/v1/complaints/complaint-1': { body: COMPLAINT },
      'GET /api/v1/admin/bookings/booking-1/timeline': { body: TIMELINE },
      'POST /api/v1/admin/complaints/complaint-1/resolve': { body: { complaint: {} } },
    });

    const user = userEvent.setup({ delay: null });
    renderComplaintPage();

    await user.click(await screen.findByRole('button', { name: 'Uphold' }));

    /**
     * Both fields are mandatory server-side and both matter for a different
     * reason: the severity is what the trust engine acts on (severe
     * suspends somebody), and the note is what an appeal is answered from.
     */
    await user.click(screen.getByRole('button', { name: 'Uphold complaint' }));
    expect(await screen.findByText('Severity is required.')).toBeInTheDocument();
    expect(screen.getByText('Note is required.')).toBeInTheDocument();
    expect(api.lastCall('POST /api/v1/admin/complaints/complaint-1/resolve')).toBeUndefined();

    await user.selectOptions(screen.getByLabelText('Severity'), 'major');
    await user.type(screen.getByLabelText('Note'), 'Return visit confirmed the same fault.');
    await user.click(screen.getByRole('button', { name: 'Uphold complaint' }));

    const call = await waitForCall(api, 'POST /api/v1/admin/complaints/complaint-1/resolve');

    expect(call.body).toEqual({
      severity: 'major',
      note: 'Return visit confirmed the same fault.',
    });
  });

  it('embeds the booking timeline so the decision is not made on one account alone', async () => {
    mockApi({
      'GET /api/v1/complaints/complaint-1': { body: COMPLAINT },
      'GET /api/v1/admin/bookings/booking-1/timeline': { body: TIMELINE },
    });

    renderComplaintPage();

    expect(await screen.findByText('created')).toBeInTheDocument();
    expect(screen.getByText('The booking this is about')).toBeInTheDocument();
  });
});
