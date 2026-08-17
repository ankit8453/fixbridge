import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { decideVerificationCase, fetchVerificationCase, reviewVerificationCase } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { VerificationCaseDetail, VerificationDocument } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { BadgeLevel, StatusBadge } from '../components/StatusBadge';
import { Button, Card, DetailRow, QueryState } from '@/components/ui';

type Decision = 'pass' | 'fail' | 'request_info';

const DECISION_COPY: Record<Decision, { title: string; confirm: string; blurb: string }> = {
  pass: {
    title: 'Pass this level',
    confirm: 'Record pass',
    blurb: 'Terminal. The badge is recomputed immediately.',
  },
  fail: {
    title: 'Fail this level',
    confirm: 'Record fail',
    blurb:
      'Terminal, and it downgrades the badge immediately — this technician stops appearing in search. The note is what they will be told and what an auditor will read.',
  },
  request_info: {
    title: 'Request more information',
    confirm: 'Request information',
    blurb: 'Moves the case to needs_info. Say exactly what is missing — they only see this note.',
  },
};

/** Ported from `legacy-next-src/app/[locale]/admin/verification/[caseId]/page.tsx`. */
export default function VerificationCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId ?? '';
  const [decision, setDecision] = useState<Decision | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'verification', 'case', caseId],
    queryFn: () => fetchVerificationCase(caseId),
  });

  const invalidate = [
    ['admin', 'verification'],
    ['admin', 'summary'],
  ];

  const takeUp = useAdminMutation(() => reviewVerificationCase(caseId), { invalidate });

  const decide = useAdminMutation(
    (input: { decision: Decision; notes?: string }) => decideVerificationCase(caseId, input),
    { invalidate, onDone: () => setDecision(null) },
  );

  return (
    <>
      <PageHeader
        title="Verification case"
        subtitle="Opening this page writes a KYC access log row naming you and the documents you were shown."
        actions={
          <Link className="text-sm text-brand hover:underline" to="/admin/verification">
            ← Back to the queue
          </Link>
        }
      />

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the case, its events and signed document links…"
        onRetry={() => void query.refetch()}
      >
        {(detail) => (
          <div className="space-y-4">
            <CaseHeader
              detail={detail}
              onTakeUp={() => takeUp.mutate(undefined)}
              takingUp={takeUp.isPending}
              onDecide={setDecision}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <Documents documents={detail.documents} />
              <EventTimeline detail={detail} />
            </div>

            {decision ? (
              <ConfirmDialog
                title={DECISION_COPY[decision].title}
                description={DECISION_COPY[decision].blurb}
                confirmLabel={DECISION_COPY[decision].confirm}
                tone={decision === 'pass' ? 'primary' : 'danger'}
                pending={decide.isPending}
                error={decide.error}
                fields={[
                  {
                    name: 'notes',
                    label: 'Notes',
                    type: 'textarea',
                    // The API requires notes for fail and request_info and takes
                    // them as optional for pass. Mirrored exactly so the dialog
                    // never disagrees with the server about what is mandatory.
                    required: decision !== 'pass',
                    minLength: decision === 'pass' ? undefined : 3,
                    hint:
                      decision === 'pass'
                        ? 'Optional. Anything worth knowing next time this technician is reviewed.'
                        : 'Required. Recorded in the audit log and shown to the technician.',
                  },
                ]}
                onClose={() => setDecision(null)}
                onConfirm={(values) =>
                  decide.mutate({
                    decision,
                    notes: values.notes ? values.notes : undefined,
                  })
                }
              />
            ) : null}
          </div>
        )}
      </QueryState>
    </>
  );
}

function CaseHeader({
  detail,
  onTakeUp,
  takingUp,
  onDecide,
}: {
  detail: VerificationCaseDetail;
  onTakeUp: () => void;
  takingUp: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const record = detail.case;
  const closed = record.closedAt !== null;

  return (
    <Card
      title={`${detail.provider.displayName ?? detail.provider.id} — level ${record.level} (${record.levelName})`}
      actions={
        closed ? (
          <span className="text-xs text-muted">Decided — this case is closed.</span>
        ) : (
          <>
            {record.status === 'submitted' ? (
              <Button variant="secondary" disabled={takingUp} onClick={onTakeUp}>
                {takingUp ? 'Taking up…' : 'Take up for review'}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => onDecide('pass')}>
              Pass
            </Button>
            <Button variant="secondary" onClick={() => onDecide('request_info')}>
              Request info
            </Button>
            <Button variant="danger" onClick={() => onDecide('fail')}>
              Fail
            </Button>
          </>
        )
      }
    >
      <dl>
        <DetailRow label="Status">
          <StatusBadge status={record.status} />
        </DetailRow>
        <DetailRow label="Opened">
          <Timestamp value={record.openedAt} />
        </DetailRow>
        <DetailRow label="Closed">
          <Timestamp value={record.closedAt} />
        </DetailRow>
        <DetailRow label="Current badge">
          <BadgeLevel badge={detail.summary.badge} /> since{' '}
          <Timestamp value={detail.summary.badgeSince} />
        </DetailRow>
        <DetailRow label="Levels passed">
          {detail.summary.levelsPassed.length ? detail.summary.levelsPassed.join(', ') : 'none yet'}
        </DetailRow>
        <DetailRow label="Technician">
          <Link
            className="text-brand hover:underline"
            to={`/admin/providers/${detail.provider.id}`}
          >
            Open the full technician page
          </Link>
        </DetailRow>
      </dl>
    </Card>
  );
}

/**
 * The document viewer.
 *
 * Images render inline because a reviewer comparing a selfie to an ID card
 * cannot do it across two browser tabs. Everything else gets a plain link
 * and nothing more — no `download` attribute, no auto-open, no embedding a
 * PDF or an unknown MIME type in a frame. The storage layer already signs
 * these URLs to be served inert, and this screen should not undo that by
 * being helpful.
 */
function Documents({ documents }: { documents: VerificationDocument[] }) {
  return (
    <Card title={`Documents (${documents.length})`}>
      {documents.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing uploaded for this technician yet. Links expire five minutes after this page
          loaded; reload to get fresh ones.
        </p>
      ) : (
        <ul className="space-y-4">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">{doc.docType}</span>
                <span className="text-xs text-muted">
                  {doc.contentType} · {Math.round(doc.sizeBytes / 1024)} KB ·{' '}
                  <Timestamp value={doc.uploadedAt} />
                </span>
              </div>

              {doc.contentType.startsWith('image/') ? (
                // Plain <img>: a signed, expiring, single-use document URL is
                // never worth caching or optimising — it is never requested
                // again.
                <img
                  src={doc.downloadUrl}
                  alt={`${doc.docType} document`}
                  loading="lazy"
                  // No referrer: the signed URL must not leak into anybody's
                  // access logs by way of a Referer header.
                  referrerPolicy="no-referrer"
                  className="max-h-96 w-full rounded-lg border border-border bg-slate-50 object-contain"
                />
              ) : (
                <a
                  href={doc.downloadUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-brand hover:underline"
                >
                  Open {doc.docType} in a new tab
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The append-only event log, exactly as stored.
 *
 * Verification history refuses UPDATE at the database level, so this list
 * is the case — its status is only a projection of it. Payloads are printed
 * raw because a reviewer re-reading a decision needs what was actually
 * submitted, not a prettified summary of it.
 */
function EventTimeline({ detail }: { detail: VerificationCaseDetail }) {
  return (
    <Card title={`Event log (${detail.case.events.length})`}>
      {detail.case.events.length === 0 ? (
        <p className="text-sm text-muted">No events recorded on this case.</p>
      ) : (
        <ol className="space-y-3">
          {detail.case.events.map((event) => (
            <li key={event.id} className="border-l-2 border-slate-200 pl-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{event.eventType}</span>
                <span className="text-xs text-muted">by {event.actorType}</span>
                <span className="text-xs text-slate-400">
                  <Timestamp value={event.createdAt} />
                </span>
              </div>
              {event.notes ? <p className="mt-1 text-sm text-slate-700">{event.notes}</p> : null}
              {event.payload !== null && event.payload !== undefined ? (
                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
