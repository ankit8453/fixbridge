import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import VerificationCasePage from '../pages/VerificationCasePage';
import { mockApi, testQueryClient, waitForCall } from '@/test/harness';

/**
 * Ported from `legacy-next-src/components/admin/__tests__/verification-decide.test.tsx`.
 * The component under test and every assertion are unchanged; only the
 * routing plumbing differs — `caseId` now comes from a real `MemoryRouter`
 * route match (`useParams` via `react-router-dom`) rather than a mocked
 * `next/navigation`.
 */

const CASE_DETAIL = {
  case: {
    id: 'case-1',
    level: 1,
    levelName: 'Identity',
    status: 'in_review',
    openedAt: '2026-08-15T09:00:00.000Z',
    closedAt: null,
    events: [
      {
        id: 'e1',
        eventType: 'submitted',
        actorType: 'provider',
        notes: null,
        payload: { idLast4: '4321' },
        createdAt: '2026-08-15T09:00:00.000Z',
      },
    ],
  },
  provider: { id: 'p1', displayName: 'Ramesh Vishwakarma', cityId: 1 },
  documents: [
    {
      id: 'd1',
      docType: 'id_front',
      status: 'uploaded',
      contentType: 'image/jpeg',
      sizeBytes: 204800,
      uploadedAt: '2026-08-15T09:01:00.000Z',
      createdAt: '2026-08-15T09:00:30.000Z',
      downloadUrl: 'https://storage.example/signed/d1',
    },
  ],
  summary: { badge: 'NONE', badgeSince: null, levelsPassed: [0], levelsRemaining: [1, 2, 3] },
};

function renderCasePage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={['/admin/verification/case-1']}>
        <Routes>
          <Route path="/admin/verification/:caseId" element={<VerificationCasePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('deciding a verification case', () => {
  it('sends the decision and the notes to the decide endpoint', async () => {
    const api = mockApi({
      'GET /api/v1/admin/verification/cases/case-1': { body: CASE_DETAIL },
      'POST /api/v1/admin/verification/cases/case-1/decide': { body: { case: CASE_DETAIL.case } },
    });

    const user = userEvent.setup({ delay: null });
    renderCasePage();

    await user.click(await screen.findByRole('button', { name: 'Fail' }));

    // A failure downgrades the badge immediately, so the API refuses one without
    // notes. The dialog must refuse it first, by name.
    await user.click(screen.getByRole('button', { name: 'Record fail' }));
    expect(await screen.findByText('Notes is required.')).toBeInTheDocument();
    expect(api.lastCall('POST /api/v1/admin/verification/cases/case-1/decide')).toBeUndefined();

    await user.type(screen.getByLabelText('Notes'), 'The selfie does not match the ID card.');
    await user.click(screen.getByRole('button', { name: 'Record fail' }));

    const call = await waitForCall(api, 'POST /api/v1/admin/verification/cases/case-1/decide');

    expect(call.body).toEqual({
      decision: 'fail',
      notes: 'The selfie does not match the ID card.',
    });
  });

  it('renders an image document inline and never auto-downloads it', async () => {
    mockApi({ 'GET /api/v1/admin/verification/cases/case-1': { body: CASE_DETAIL } });

    renderCasePage();

    const image = await screen.findByAltText('id_front document');
    expect(image).toHaveAttribute('src', 'https://storage.example/signed/d1');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});
