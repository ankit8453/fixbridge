import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  CircleHelp,
  Eye,
  FileText,
  History,
  Image as ImageIcon,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { decideVerificationCase, fetchVerificationCase, reviewVerificationCase } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { VerificationCaseDetail, VerificationDocument } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { BadgeLevel } from '../components/StatusBadge';
import { AdminButton, Card, DetailRow, EmptyState, Pill, type Tone } from '../components/ui';
import { caseTone } from './VerificationQueuePage';
import { QueryState } from '@/components/ui';

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin/verification"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-admin hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          Back to the queue
        </Link>

        {/* Not a warning about a risk — a statement of a fact that has already
            happened by the time this renders. Opening the page wrote the row. */}
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Eye className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" strokeWidth={2} />
          Opening this page wrote a KYC access log row naming you and the documents you were shown.
        </p>
      </div>

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

            <div className="grid gap-4 xl:grid-cols-5">
              <div className="xl:col-span-3">
                <Documents documents={detail.documents} />
              </div>
              <div className="xl:col-span-2">
                <EventTimeline detail={detail} />
              </div>
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
    </div>
  );
}

/**
 * A ring showing how far through the four levels this technician is.
 *
 * The badge is the outcome, but "which levels are already passed" is what
 * tells a reviewer whether this case is somebody's first step or their last.
 * The levels are printed as text underneath, so the ring is decorative.
 */
function LevelProgress({ passed, current }: { passed: number[]; current: number }) {
  const total = 4;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const done = passed.length;
  const length = (Math.min(done, total) / total) * circumference;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[68px] w-[68px] shrink-0">
        <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="34"
            cy="34"
            r={radius}
            fill="none"
            className="stroke-slate-100"
            strokeWidth="7"
          />
          <circle
            cx="34"
            cy="34"
            r={radius}
            fill="none"
            className="stroke-admin"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${length} ${circumference - length}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[15px] font-semibold tabular-nums leading-none text-slate-900">
            {done}/{total}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Levels passed
        </p>
        <p className="mt-0.5 text-[13px] text-slate-900">
          {passed.length ? passed.join(', ') : 'none yet'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">Deciding level {current} now</p>
      </div>
    </div>
  );
}

/**
 * The case's state, the technician it belongs to, and the three decisions.
 *
 * The decision controls sit in their own bordered block, separated from the
 * facts above them, because this is the click that decides whether somebody
 * can earn — it must never be reachable by a misaimed scan of the detail rows.
 */
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
  const tone = caseTone(record.status);

  const STATE_ICON: Partial<Record<Tone, typeof ShieldCheck>> = {
    success: ShieldCheck,
    danger: ShieldAlert,
    warning: CircleHelp,
  };
  const StateIcon = STATE_ICON[tone] ?? ShieldCheck;

  return (
    <Card padded={false}>
      {/* The state banner. Its tint is the first thing read on this page —
          whether this case is still live is the question every other fact on
          the screen is conditioned on. */}
      <div
        className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 ${
          closed
            ? 'border-slate-200 bg-slate-50'
            : tone === 'danger'
              ? 'border-danger/20 bg-danger/5'
              : tone === 'warning'
                ? 'border-warning/20 bg-warning/5'
                : 'border-admin/20 bg-admin-soft'
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            closed ? 'bg-slate-200 text-slate-600' : 'bg-white text-admin shadow-sm'
          }`}
        >
          {closed ? (
            <Lock className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          ) : (
            <StateIcon className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
              {detail.provider.displayName ?? detail.provider.id}
            </h2>
            <Pill tone={tone}>{record.status}</Pill>
            {closed ? <Pill tone="neutral">closed</Pill> : <Pill tone="admin">live</Pill>}
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            Level {record.level} — {record.levelName} · opened <Timestamp value={record.openedAt} />
          </p>
        </div>

        <BadgeLevel badge={detail.summary.badge} />
      </div>

      {/* ------------------------------ Decision ----------------------------- */}
      <div className="border-b border-slate-100 px-4 py-3">
        {closed ? (
          <p className="flex items-center gap-2 text-[13px] text-slate-600">
            <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" strokeWidth={2} />
            Decided <Timestamp value={record.closedAt} /> — this case is closed and cannot be
            decided again.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Decision
            </span>
            <AdminButton variant="primary" onClick={() => onDecide('pass')}>
              <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              Pass
            </AdminButton>
            <AdminButton variant="danger" onClick={() => onDecide('fail')}>
              <X className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              Fail
            </AdminButton>
            <AdminButton variant="secondary" onClick={() => onDecide('request_info')}>
              <CircleHelp className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Request info
            </AdminButton>

            {record.status === 'submitted' ? (
              <AdminButton
                variant="ghost"
                disabled={takingUp}
                onClick={onTakeUp}
                className="ml-auto"
              >
                {takingUp ? 'Taking up…' : 'Take up for review'}
              </AdminButton>
            ) : null}
          </div>
        )}
      </div>

      {/* -------------------------------- Facts ------------------------------ */}
      <div className="grid gap-4 px-4 py-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <dl>
            <DetailRow label="Case status">
              <Pill tone={tone}>{record.status}</Pill>
            </DetailRow>
            <DetailRow label="Opened">
              <Timestamp value={record.openedAt} />
            </DetailRow>
            <DetailRow label="Closed">
              <Timestamp value={record.closedAt} />
            </DetailRow>
            <DetailRow label="Current badge">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <BadgeLevel badge={detail.summary.badge} />
                <span className="text-slate-500">
                  since <Timestamp value={detail.summary.badgeSince} />
                </span>
              </span>
            </DetailRow>
            <DetailRow label="Technician">
              <Link
                to={`/admin/providers/${detail.provider.id}`}
                className="inline-flex items-center gap-1.5 font-semibold text-admin hover:underline"
              >
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
                Open the full technician page
              </Link>
            </DetailRow>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <LevelProgress passed={detail.summary.levelsPassed} current={detail.case.level} />
        </div>
      </div>
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
    <Card
      title="Evidence"
      description="Signed links expire five minutes after this page loaded; reload to get fresh ones."
      action={<Pill tone={documents.length > 0 ? 'admin' : 'warning'}>{documents.length}</Pill>}
      padded={documents.length === 0}
    >
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nothing uploaded yet."
          description="This technician has submitted no documents for this level, so there is nothing to check a decision against."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {documents.map((doc) => {
            const isImage = doc.contentType.startsWith('image/');
            return (
              <li key={doc.id} className="p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    {isImage ? (
                      <ImageIcon
                        className="h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                        strokeWidth={2}
                      />
                    ) : (
                      <FileText
                        className="h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                        strokeWidth={2}
                      />
                    )}
                    <span className="text-[13px] font-semibold text-slate-900">{doc.docType}</span>
                    <Pill tone="neutral">{doc.status}</Pill>
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {doc.contentType} · {Math.round(doc.sizeBytes / 1024)} KB ·{' '}
                    <Timestamp value={doc.uploadedAt} />
                  </span>
                </div>

                {isImage ? (
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
                    className="max-h-[26rem] w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
                  />
                ) : (
                  <a
                    href={doc.downloadUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-touch items-center gap-1.5 text-[13px] font-semibold text-admin hover:underline"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                    Open {doc.docType} in a new tab
                  </a>
                )}
              </li>
            );
          })}
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
  const events = detail.case.events;

  return (
    <Card
      title="Event log"
      description="Append-only. The database refuses an UPDATE on these rows."
      action={<Pill tone="neutral">{events.length}</Pill>}
      padded={events.length === 0}
    >
      {events.length === 0 ? (
        <EmptyState
          icon={History}
          title="No events on this case."
          description="Nothing has happened since it was created — not even a submission."
        />
      ) : (
        <ol className="space-y-0 p-4">
          {events.map((event, index) => (
            <li key={event.id} className="relative pb-4 pl-6 last:pb-0">
              {/* The spine, stopping at the last event rather than trailing off. */}
              {index < events.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[5px] top-4 w-px bg-slate-200"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-white bg-admin ring-1 ring-admin/30"
              />

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[13px] font-semibold text-slate-900">{event.eventType}</span>
                <span className="text-xs text-slate-500">by {event.actorType}</span>
                <span className="text-xs text-slate-400">
                  <Timestamp value={event.createdAt} />
                </span>
              </div>

              {event.notes ? (
                <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{event.notes}</p>
              ) : null}

              {event.payload !== null && event.payload !== undefined ? (
                <pre className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
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
