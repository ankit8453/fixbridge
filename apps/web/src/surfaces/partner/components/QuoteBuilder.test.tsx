import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { mockApi, testQueryClient, waitForCall } from '../../../test/harness';
import { QuoteBuilder } from './QuoteBuilder';
import type { AgreedLabour } from '../lib/types';

/**
 * These tests exist for the pricing promise, not the arithmetic.
 *
 * The rule the product sells is that the labour a customer agreed to is not
 * something the technician retypes at the door — so the important assertions
 * here are that a `fixed` booking offers no labour input at all, that extra
 * labour cannot be sent without a reason the customer can read, and that the
 * split reaches the API explicitly rather than as one merged figure the server
 * would have to guess at.
 *
 * The `next/navigation` locale mock of the legacy version is replaced with a
 * real `<MemoryRouter>` — this app's `useT()`/`useLocale()` read
 * `useLocation()` directly (`i18n/useT.ts`) — so assertions are against the
 * default `hi` catalog's copy, not English.
 */
const FIXED: AgreedLabour = { priceType: 'fixed', amountPaise: 30000 };
const OPEN: AgreedLabour = { priceType: 'inspection_based', amountPaise: null };

function renderQuoteBuilder(bookingId: string, agreedLabour: AgreedLabour = FIXED) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={testQueryClient()}>
        <QuoteBuilder bookingId={bookingId} agreedLabour={agreedLabour} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('QuoteBuilder', () => {
  it('shows the agreed labour as locked, with no way to retype it', () => {
    renderQuoteBuilder('booking-1');

    expect(screen.getByText('तय मेहनताना')).toBeInTheDocument();
    // The ₹300 the customer booked, shown and already in the total.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹300');
    // The whole point: no labour field exists to type a different number into.
    expect(screen.queryByLabelText('मेहनताना (₹)')).not.toBeInTheDocument();
  });

  it('sends the agreed figure untouched when nothing is added', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/bookings/booking-1/quotations': {
        status: 201,
        body: { quotation: { id: 'q1', bookingId: 'booking-1', version: 1 } },
      },
    });

    renderQuoteBuilder('booking-1');
    await user.click(screen.getByRole('button', { name: 'क्वोटेशन भेजें' }));

    const call = await waitForCall(api, 'POST /api/v1/bookings/booking-1/quotations');
    expect(call.body).toEqual({
      labourPaise: 30000,
      agreedLabourPaise: 30000,
      items: [],
      note: undefined,
    });
  });

  it('will not send extra labour until a reason is written', async () => {
    const user = userEvent.setup();
    renderQuoteBuilder('booking-1');

    await user.click(screen.getByRole('button', { name: '+ अतिरिक्त मेहनताना जोड़ें' }));
    await user.type(screen.getByLabelText('अतिरिक्त रक़म (₹)'), '200');

    // The money is in the total immediately — but the send is barred, because
    // an unexplained increase is exactly what the rules exist to stop.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹500');
    expect(screen.getByRole('button', { name: 'क्वोटेशन भेजें' })).toBeDisabled();

    await user.type(screen.getByLabelText('यह क्यों ज़रूरी है?'), 'Wall wiring had to be replaced');

    expect(screen.getByRole('button', { name: 'क्वोटेशन भेजें' })).toBeEnabled();
  });

  it('sends the labour split explicitly, so the server never has to infer it', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/bookings/booking-1/quotations': {
        status: 201,
        body: { quotation: { id: 'q1', bookingId: 'booking-1', version: 1 } },
      },
    });

    renderQuoteBuilder('booking-1');

    await user.click(screen.getByRole('button', { name: '+ अतिरिक्त मेहनताना जोड़ें' }));
    await user.type(screen.getByLabelText('अतिरिक्त रक़म (₹)'), '200');
    await user.type(screen.getByLabelText('यह क्यों ज़रूरी है?'), 'Wall wiring had to be replaced');

    await user.click(screen.getByRole('button', { name: '+ पार्ट जोड़ें' }));
    await user.type(screen.getByLabelText('विवरण'), 'Door gasket');
    const qty = screen.getByLabelText('मात्रा');
    await user.clear(qty);
    await user.type(qty, '2');
    await user.type(screen.getByLabelText('एक की कीमत (₹)'), '250');

    // ₹300 agreed + ₹200 extra + (2 × ₹250) = ₹1,000.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹1,000');

    await user.click(screen.getByRole('button', { name: 'क्वोटेशन भेजें' }));

    const call = await waitForCall(api, 'POST /api/v1/bookings/booking-1/quotations');
    expect(call.body).toEqual({
      labourPaise: 50000,
      agreedLabourPaise: 30000,
      extraLabourPaise: 20000,
      extraLabourReason: 'Wall wiring had to be replaced',
      items: [{ kind: 'part', description: 'Door gasket', qty: 2, unitPaise: 25000 }],
      note: undefined,
    });
  });

  it('asks for a labour figure only when the booking was left open', async () => {
    const user = userEvent.setup();
    renderQuoteBuilder('booking-1', OPEN);

    // No card was priced, so there is nothing to lock to and the technician
    // sets the figure — the one case where typing labour is correct.
    expect(screen.queryByText('तय मेहनताना')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('मेहनताना (₹)'), '450');

    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹450');
  });

  it('refuses to send once a line total blows past the per-line cap', async () => {
    const user = userEvent.setup();
    renderQuoteBuilder('booking-1');

    await user.click(screen.getByRole('button', { name: '+ पार्ट जोड़ें' }));
    await user.type(screen.getByLabelText('विवरण'), 'Motor');
    const qtyInput = screen.getByLabelText('मात्रा');
    await user.clear(qtyInput);
    await user.type(qtyInput, '999');
    // 999 × ₹50,000 = ₹4,99,50,000 — comfortably over the ₹2,00,000 per-line cap.
    await user.type(screen.getByLabelText('एक की कीमत (₹)'), '50000');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'एक लाइन ₹2,00,000 से ज़्यादा नहीं हो सकती',
    );
    expect(screen.getByRole('button', { name: 'क्वोटेशन भेजें' })).toBeDisabled();
  });
});
