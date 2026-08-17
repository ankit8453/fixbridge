import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { otpDisplayFor } from '../otp-display';
import { OtpDisplay } from '../OtpDisplay';
import { BOOKING_STATUSES, type BookingStatus } from '@/surfaces/customer/data/types';

const START = '1234';
const END = '5678';

/**
 * The one matrix that matters for this component: for every booking status,
 * which code (if either) is the one shown. Getting this wrong in either
 * direction is a real-world failure the phase brief names explicitly — the
 * end code showing while a technician is still en route would leak the
 * job-completion code before any work happened, and the start code lingering
 * into IN_PROGRESS would have a customer read out a code the technician can
 * no longer use. Ported from
 * `legacy-next-src/components/customer/bookings/__tests__/OtpDisplay.test.tsx`.
 */
const EXPECTED: Record<BookingStatus, 'start' | 'end' | 'none'> = {
  REQUESTED: 'none',
  ACCEPTED: 'start',
  EN_ROUTE: 'start',
  ARRIVED: 'start',
  IN_PROGRESS: 'end',
  WORK_DONE: 'none',
  REJECTED: 'none',
  EXPIRED: 'none',
  CANCELLED_BY_CUSTOMER: 'none',
  CANCELLED_BY_PROVIDER: 'none',
  CLOSED_QUOTE_DECLINED: 'none',
};

describe('otpDisplayFor (pure)', () => {
  it.each(BOOKING_STATUSES)('resolves %s to the expected kind', (status) => {
    const result = otpDisplayFor(status, START, END);
    expect(result.kind).toBe(EXPECTED[status]);
    expect(result.code).toBe(
      EXPECTED[status] === 'start' ? START : EXPECTED[status] === 'end' ? END : null,
    );
  });

  it('shows nothing if the expected code has not been issued yet, even in the right status', () => {
    // Defensive: a null code (e.g. codes expired server-side) must never render
    // as an empty box that still claims to be a real code.
    expect(otpDisplayFor('ACCEPTED', null, END)).toEqual({ kind: 'start', code: null });
    expect(otpDisplayFor('IN_PROGRESS', START, null)).toEqual({ kind: 'end', code: null });
  });
});

function renderOtp(status: BookingStatus, startOtp: string | null, endOtp: string | null) {
  return render(
    <MemoryRouter>
      <OtpDisplay status={status} startOtp={startOtp} endOtp={endOtp} />
    </MemoryRouter>,
  );
}

describe('<OtpDisplay />', () => {
  it('shows the start code, not the end code, when ACCEPTED', () => {
    renderOtp('ACCEPTED', START, END);
    expect(screen.getByText(START)).toBeInTheDocument();
    expect(screen.queryByText(END)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-otp-kind', 'start');
  });

  it('shows the end code, not the start code, when IN_PROGRESS', () => {
    renderOtp('IN_PROGRESS', START, END);
    expect(screen.getByText(END)).toBeInTheDocument();
    expect(screen.queryByText(START)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-otp-kind', 'end');
  });

  it('renders nothing once the job is WORK_DONE, even though both codes are still on the object', () => {
    const { container } = renderOtp('WORK_DONE', START, END);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before acceptance', () => {
    const { container } = renderOtp('REQUESTED', null, null);
    expect(container).toBeEmptyDOMElement();
  });
});
