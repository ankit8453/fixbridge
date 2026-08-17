import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderWithQuery, waitForCall } from '@/test/harness';
import { QuoteBuilder } from './QuoteBuilder';

/**
 * The running total is the whole point of the line-item builder
 * (PHASE12_PROMPT.md §C.3: "description/qty/unit price, running total,
 * send") — this exercises it the way a technician would: type labour, add a
 * part line, watch the number on screen, then send and check the exact
 * paise the API receives matches what was shown.
 *
 * `useT()` resolves the locale through `useParams()` (see `i18n/useT.ts`),
 * which has no App Router context in a plain RTL render — mocked to `en`
 * here, same approach `src/test/i18n-toggle.test.tsx` uses, so the test
 * asserts against real rendered copy rather than raw i18n keys.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  usePathname: () => '/en/partner/jobs/booking-1',
}));

describe('QuoteBuilder', () => {
  it('shows no total until an amount is entered', () => {
    renderWithQuery(<QuoteBuilder bookingId="booking-1" />);
    expect(screen.getByTestId('quote-total')).toHaveTextContent('—');
  });

  it('computes the running total from labour plus every line, and sends the same figure', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/bookings/booking-1/quotations': {
        status: 201,
        body: { quotation: { id: 'q1', bookingId: 'booking-1', version: 1 } },
      },
    });

    renderWithQuery(<QuoteBuilder bookingId="booking-1" />);

    // ₹100 labour.
    await user.type(screen.getByLabelText('Labour charge (₹)'), '100');

    // One part line: 2 × ₹250 = ₹500.
    await user.click(screen.getByRole('button', { name: '+ Add a part' }));
    await user.type(screen.getByLabelText('Description'), 'Door gasket');
    const qtyInput = screen.getByLabelText('Qty');
    await user.clear(qtyInput);
    await user.type(qtyInput, '2');
    await user.type(screen.getByLabelText('Unit price (₹)'), '250');

    // ₹100 + (2 × ₹250) = ₹600.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹600');

    await user.click(screen.getByRole('button', { name: 'Send quotation' }));

    const call = await waitForCall(api, 'POST /api/v1/bookings/booking-1/quotations');
    expect(call.body).toEqual({
      labourPaise: 10000,
      items: [{ kind: 'part', description: 'Door gasket', qty: 2, unitPaise: 25000 }],
      note: undefined,
    });
  });

  it('adds a second, labour-only line and folds it into the same running total', async () => {
    const user = userEvent.setup();
    renderWithQuery(<QuoteBuilder bookingId="booking-1" />);

    await user.click(screen.getByRole('button', { name: '+ Add extra labour' }));
    await user.type(screen.getByLabelText('Description'), 'Extra hour on site');
    const qtyInput = screen.getByLabelText('Qty');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.type(screen.getByLabelText('Unit price (₹)'), '150');

    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹150');

    await user.click(screen.getByRole('button', { name: '+ Add a part' }));
    const [, secondDescription] = screen.getAllByLabelText('Description');
    await user.type(secondDescription!, 'Sealant tube');
    const [, secondQty] = screen.getAllByLabelText('Qty');
    await user.clear(secondQty!);
    await user.type(secondQty!, '2');
    const [, secondUnit] = screen.getAllByLabelText('Unit price (₹)');
    await user.type(secondUnit!, '120');

    // ₹150 (labour-extra line) + 2 × ₹120 (part line) = ₹390.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹390');
  });

  it('refuses to send once a line total blows past the per-line cap', async () => {
    const user = userEvent.setup();
    renderWithQuery(<QuoteBuilder bookingId="booking-1" />);

    await user.click(screen.getByRole('button', { name: '+ Add a part' }));
    await user.type(screen.getByLabelText('Description'), 'Motor');
    const qtyInput = screen.getByLabelText('Qty');
    await user.clear(qtyInput);
    await user.type(qtyInput, '999');
    // 999 × ₹50,000 = ₹4,99,50,000 — comfortably over the ₹2,00,000 per-line cap.
    await user.type(screen.getByLabelText('Unit price (₹)'), '50000');

    expect(screen.getByRole('alert')).toHaveTextContent('A single line cannot exceed ₹2,00,000');
    expect(screen.getByRole('button', { name: 'Send quotation' })).toBeDisabled();
  });
});
