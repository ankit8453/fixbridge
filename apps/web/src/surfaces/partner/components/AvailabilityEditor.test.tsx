import { QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { mockApi, testQueryClient, waitForCall } from '../../../test/harness';
import { AvailabilityEditor } from './AvailabilityEditor';
import type { ProviderAvailabilityResponse } from '../lib/types';

/**
 * The overlap check has to run client-side, before a request goes out
 * (`lib/availability-overlap.ts`, mirroring
 * `apps/api/src/modules/providers/availability.ts`) — a mistri filling this
 * in on a slow connection should see "that clashes" immediately, not after a
 * round trip that ends the same way. This exercises the real component
 * against a real existing window, both for the manual one-window form and
 * for the "weekday evenings + Sunday" preset, which has to skip a clashing
 * day rather than fail outright. Ported from
 * `legacy-next-src/components/partner/AvailabilityEditor.test.tsx`; the
 * `next/navigation` locale mock is replaced with a real `<MemoryRouter>` —
 * this app's `useT()`/`useLocale()` read `useLocation()` directly, no
 * context provider to swap in — so assertions use the default `hi`
 * catalog's copy rather than the legacy suite's English mock.
 */
function renderEditor(availability: ProviderAvailabilityResponse[]) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={testQueryClient()}>
        <AvailabilityEditor availability={availability} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const MONDAY_EVENING: ProviderAvailabilityResponse = {
  id: 'avail-mon',
  dayOfWeek: 1,
  startTime: '18:00',
  endTime: '22:00',
  isActive: true,
};

describe('AvailabilityEditor', () => {
  it('refuses a window that overlaps one already active, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = mockApi({});

    renderEditor([MONDAY_EVENING]);

    // The form defaults to Monday 18:00–22:00 — the exact window already
    // active — so tapping "add" immediately exercises the overlap path.
    await user.click(screen.getByRole('button', { name: 'जोड़ें' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'यह समय आपके पहले से सेट समय से टकरा रहा है',
    );
    expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('accepts a back-to-back window on the same day (adjacent, not overlapping)', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/providers/me/availability': {
        status: 201,
        body: { profile: { availability: [MONDAY_EVENING] } },
      },
    });

    renderEditor([MONDAY_EVENING]);

    fireEvent.change(screen.getByLabelText('शुरू'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('खत्म'), { target: { value: '23:00' } });

    await user.click(screen.getByRole('button', { name: 'जोड़ें' }));

    const call = await waitForCall(api, 'POST /api/v1/providers/me/availability');
    expect(call.body).toEqual({ dayOfWeek: 1, startTime: '22:00', endTime: '23:00' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an end time at or before the start time before any request is made', async () => {
    const user = userEvent.setup();
    const api = mockApi({});

    renderEditor([]);

    fireEvent.change(screen.getByLabelText('शुरू'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('खत्म'), { target: { value: '09:00' } });

    await user.click(screen.getByRole('button', { name: 'जोड़ें' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'खत्म होने का समय शुरू होने के समय के बाद होना चाहिए',
    );
    expect(api.calls).toHaveLength(0);
  });

  it('the weekday-evenings-plus-Sunday preset skips only the day that already clashes', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /api/v1/providers/me/availability': {
        status: 201,
        body: { profile: { availability: [] } },
      },
    });

    renderEditor([MONDAY_EVENING]);

    await user.click(screen.getByRole('button', { name: 'हफ्ते की शामें + पूरा इतवार' }));

    // Six candidate windows, one (Monday) clashes with what's already active.
    let posts: ReturnType<typeof api.calls.filter> = [];
    await waitFor(() => {
      posts = api.calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/providers/me/availability',
      );
      expect(posts).toHaveLength(5);
    });

    expect(posts.some((call) => call.body?.dayOfWeek === 1)).toBe(false);
    expect(posts.some((call) => call.body?.dayOfWeek === 0)).toBe(true);
  });
});
