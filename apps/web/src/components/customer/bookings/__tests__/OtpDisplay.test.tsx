import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockNav } from '@/test/navigation-mock';
import { otpDisplayFor } from '../otp-display';
import { OtpDisplay } from '../OtpDisplay';
import { BOOKING_STATUSES, type BookingStatus } from '@/components/customer/data/types';

vi.mock('next/navigation', () => ({
  useParams: () => mockNav.params,
  usePathname: () => mockNav.pathname,
  useSearchParams: () => new URLSearchParams(mockNav.search),
  useRouter: () => mockNav.router,
}));

const START = '1234';
const END = '5678';

/**
 * The one matrix that matters for this component: for every booking status,
 * which code (if either) is the one shown. Getting this wrong in either
 * direction is a real-world failure the phase brief names explicitly — the
 * end code showing while a technician is still en route would leak the
 * job-completion code before any work happened, and the start code lingering
 * into IN_PROGRESS would have a customer read out a code the technician can
 * no longer use.
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

describe('<OtpDisplay />', () => {
  it('shows the start code, not the end code, when ACCEPTED', () => {
    render(<OtpDisplay status="ACCEPTED" startOtp={START} endOtp={END} />);
    expect(screen.getByText(START)).toBeInTheDocument();
    expect(screen.queryByText(END)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-otp-kind', 'start');
  });

  it('shows the end code, not the start code, when IN_PROGRESS', () => {
    render(<OtpDisplay status="IN_PROGRESS" startOtp={START} endOtp={END} />);
    expect(screen.getByText(END)).toBeInTheDocument();
    expect(screen.queryByText(START)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-otp-kind', 'end');
  });

  it('renders nothing once the job is WORK_DONE, even though both codes are still on the object', () => {
    const { container } = render(<OtpDisplay status="WORK_DONE" startOtp={START} endOtp={END} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before acceptance', () => {
    const { container } = render(<OtpDisplay status="REQUESTED" startOtp={null} endOtp={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
