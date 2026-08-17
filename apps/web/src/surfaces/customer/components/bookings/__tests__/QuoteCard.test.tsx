import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { mockApi, testQueryClient, waitForCall } from '@/test/harness';
import { QuoteCard } from '../QuoteCard';
import type { QuotationView } from '@/surfaces/customer/data/types';

/**
 * `useT()`/`useLocale()` read the locale off `useLocation()` (see
 * `src/i18n/useT.ts`), so every component test that renders copy needs a
 * router context — `renderWithQuery` alone (no `MemoryRouter`) is not
 * enough here, unlike a component that renders no `t()` calls.
 */
function renderQuoteCard(ui: ReactNode) {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * ₹500 labour + (1 × ₹850 + 2 × ₹120) parts = ₹500 + ₹1,090 = ₹1,590 —
 * matches the worked example in `docs/API.md`'s quotations section, so a
 * reader who already knows that example recognises this fixture. Ported
 * from `legacy-next-src/components/customer/bookings/__tests__/QuoteCard.test.tsx`.
 */
const QUOTATION: QuotationView = {
  id: 'quote-1',
  bookingId: 'booking-1',
  version: 2,
  status: 'sent',
  labourPaise: 50_000,
  partsTotalPaise: 109_000,
  totalPaise: 159_000,
  totalDisplay: '₹1,590',
  note: 'Gasket perished; door not sealing.',
  decisionNote: null,
  items: [
    {
      id: 'item-1',
      kind: 'part',
      description: 'Door gasket',
      qty: 1,
      unitPaise: 85_000,
      lineTotalPaise: 85_000,
    },
    {
      id: 'item-2',
      kind: 'part',
      description: 'Sealant tube',
      qty: 2,
      unitPaise: 12_000,
      lineTotalPaise: 24_000,
    },
  ],
  decidedAt: null,
  createdAt: '2026-08-16T10:00:00.000Z',
};

describe('<QuoteCard />', () => {
  it('renders every line item and the labour/parts/total math from the API response, never recomputed', () => {
    mockApi({});
    renderQuoteCard(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending={false} />);

    expect(screen.getByText('Door gasket')).toBeInTheDocument();
    expect(screen.getByText(/1 × ₹850/)).toBeInTheDocument();
    expect(screen.getByText('₹850')).toBeInTheDocument(); // Door gasket line total

    expect(screen.getByText('Sealant tube')).toBeInTheDocument();
    expect(screen.getByText(/2 × ₹120/)).toBeInTheDocument();
    expect(screen.getByText('₹240')).toBeInTheDocument(); // Sealant tube line total (2 × ₹120)

    expect(screen.getByText('₹500')).toBeInTheDocument(); // labour
    expect(screen.getByText('₹1,090')).toBeInTheDocument(); // parts total
    expect(screen.getByText('₹1,590')).toBeInTheDocument(); // grand total, from totalDisplay verbatim
  });

  it('hides approve/reject for a quotation that is not the one awaiting decision', () => {
    mockApi({});
    renderQuoteCard(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending={false} />);
    expect(screen.queryByRole('button', { name: /Approve|मंज़ूर करें/ })).not.toBeInTheDocument();
  });

  it('approving posts to /api/v1/quotations/:id/approve — never re-deriving the total client-side', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/quotations/quote-1/approve': {
        status: 200,
        body: { quotation: { ...QUOTATION, status: 'approved' } },
      },
    });

    renderQuoteCard(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending />);

    await user.click(screen.getByRole('button', { name: /Approve|मंज़ूर करें/ }));

    const call = await waitForCall(api, 'POST /api/v1/quotations/quote-1/approve');
    expect(call.path).toBe('/api/v1/quotations/quote-1/approve');
  });

  it('rejecting requires an explicit confirm step and posts an optional reason', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/quotations/quote-1/reject': {
        status: 200,
        body: { quotation: { ...QUOTATION, status: 'rejected' } },
      },
    });

    renderQuoteCard(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending />);

    // First tap only opens the reason field — nothing is sent yet.
    await user.click(screen.getByRole('button', { name: /Reject|मंज़ूर नहीं/ }));
    expect(api.calls).toHaveLength(0);

    await user.type(screen.getByRole('textbox'), 'too expensive');
    await user.click(screen.getByRole('button', { name: /Reject quote|मना करें/ }));

    const call = await waitForCall(api, 'POST /api/v1/quotations/quote-1/reject');
    expect(call.body).toEqual({ reason: 'too expensive' });
  });
});
