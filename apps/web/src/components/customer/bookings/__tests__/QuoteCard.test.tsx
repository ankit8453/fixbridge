import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderWithQuery, waitForCall } from '@/test/harness';
import { mockNav } from '@/test/navigation-mock';
import { QuoteCard } from '../QuoteCard';
import type { QuotationView } from '@/components/customer/data/types';

vi.mock('next/navigation', () => ({
  useParams: () => mockNav.params,
  usePathname: () => mockNav.pathname,
  useSearchParams: () => new URLSearchParams(mockNav.search),
  useRouter: () => mockNav.router,
}));

// English for deterministic, greppable assertions below — the Hindi/English
// toggle is exercised by the i18n test suite, not by re-testing every string
// here in both scripts.
beforeEach(() => {
  mockNav.params = { locale: 'en' };
});

/**
 * ₹500 labour + (1 × ₹850 + 2 × ₹120) parts = ₹500 + ₹1,090 = ₹1,590 —
 * matches the worked example in `docs/API.md`'s quotations section, so a
 * reader who already knows that example recognises this fixture.
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
    renderWithQuery(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending={false} />);

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
    renderWithQuery(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending={false} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('approving posts to /api/v1/quotations/:id/approve — never re-deriving the total client-side', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/quotations/quote-1/approve': {
        status: 200,
        body: { quotation: { ...QUOTATION, status: 'approved' } },
      },
    });

    renderWithQuery(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

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

    renderWithQuery(<QuoteCard bookingId="booking-1" quotation={QUOTATION} isPending />);

    // First tap only opens the reason field — nothing is sent yet.
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(api.calls).toHaveLength(0);

    await user.type(screen.getByRole('textbox'), 'too expensive');
    await user.click(screen.getByRole('button', { name: 'Reject quote' }));

    const call = await waitForCall(api, 'POST /api/v1/quotations/quote-1/reject');
    expect(call.body).toEqual({ reason: 'too expensive' });
  });
});
