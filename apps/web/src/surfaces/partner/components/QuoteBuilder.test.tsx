import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { mockApi, testQueryClient, waitForCall } from '../../../test/harness';
import { QuoteBuilder } from './QuoteBuilder';

/**
 * The running total is the whole point of the line-item builder
 * (description/qty/unit price, running total, send) — this exercises it the
 * way a technician would: type labour, add a part line, watch the number on
 * screen, then send and check the exact paise the API receives matches what
 * was shown. Ported from
 * `legacy-next-src/components/partner/QuoteBuilder.test.tsx`; the
 * `next/navigation` locale mock is replaced with a real `<MemoryRouter>` —
 * this app's `useT()`/`useLocale()` read `useLocation()` directly
 * (`i18n/useT.ts`), no context provider or router-agnostic mock to swap in —
 * so the test asserts against the default `hi` catalog's copy, not English.
 */
function renderQuoteBuilder(bookingId: string) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={testQueryClient()}>
        <QuoteBuilder bookingId={bookingId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('QuoteBuilder', () => {
  it('shows no total until an amount is entered', () => {
    renderQuoteBuilder('booking-1');
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

    renderQuoteBuilder('booking-1');

    // ₹100 labour.
    await user.type(screen.getByLabelText('मज़दूरी (₹)'), '100');

    // One part line: 2 × ₹250 = ₹500.
    await user.click(screen.getByRole('button', { name: '+ पार्ट जोड़ें' }));
    await user.type(screen.getByLabelText('विवरण'), 'Door gasket');
    const qtyInput = screen.getByLabelText('मात्रा');
    await user.clear(qtyInput);
    await user.type(qtyInput, '2');
    await user.type(screen.getByLabelText('एक की कीमत (₹)'), '250');

    // ₹100 + (2 × ₹250) = ₹600.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹600');

    await user.click(screen.getByRole('button', { name: 'क्वोटेशन भेजें' }));

    const call = await waitForCall(api, 'POST /api/v1/bookings/booking-1/quotations');
    expect(call.body).toEqual({
      labourPaise: 10000,
      items: [{ kind: 'part', description: 'Door gasket', qty: 2, unitPaise: 25000 }],
      note: undefined,
    });
  });

  it('adds a second, labour-only line and folds it into the same running total', async () => {
    const user = userEvent.setup();
    renderQuoteBuilder('booking-1');

    await user.click(screen.getByRole('button', { name: '+ अतिरिक्त मज़दूरी जोड़ें' }));
    await user.type(screen.getByLabelText('विवरण'), 'Extra hour on site');
    const qtyInput = screen.getByLabelText('मात्रा');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.type(screen.getByLabelText('एक की कीमत (₹)'), '150');

    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹150');

    await user.click(screen.getByRole('button', { name: '+ पार्ट जोड़ें' }));
    const [, secondDescription] = screen.getAllByLabelText('विवरण');
    await user.type(secondDescription!, 'Sealant tube');
    const [, secondQty] = screen.getAllByLabelText('मात्रा');
    await user.clear(secondQty!);
    await user.type(secondQty!, '2');
    const [, secondUnit] = screen.getAllByLabelText('एक की कीमत (₹)');
    await user.type(secondUnit!, '120');

    // ₹150 (labour-extra line) + 2 × ₹120 (part line) = ₹390.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('₹390');
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
