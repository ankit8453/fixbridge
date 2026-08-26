import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  ChevronDown,
  Clock,
  MessageSquareWarning,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, Select, TextArea, TextInput } from '../../../components/ui';
import { DocumentUploader } from './DocumentUploader';
import { StatusPill, type Tone } from './ui';
import { provideInfo, submitLevel } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { VerificationCaseResponse, VerificationCaseStatus } from '../lib/types';

/**
 * Status → tone, in the partner surface's `Tone` vocabulary.
 *
 * This screen decides whether somebody can earn, so the mapping is
 * deliberately blunt: anything still moving is `brand`, anything asking
 * something of the technician is `warning`, and only a genuine pass is
 * `success`. `submitted` and `in_review` share a tone because from this side
 * of the queue they are the same fact — it is with ops, wait.
 */
const STATUS_TONE: Record<VerificationCaseStatus, Tone> = {
  submitted: 'brand',
  in_review: 'brand',
  needs_info: 'warning',
  passed: 'success',
  failed: 'danger',
};

const STATUS_ICON: Record<VerificationCaseStatus, ComponentType<LucideProps>> = {
  submitted: Clock,
  in_review: Clock,
  needs_info: MessageSquareWarning,
  passed: BadgeCheck,
  failed: XCircle,
};

const ID_TYPES = ['aadhaar', 'pan', 'dl', 'voter'] as const;
function Level0Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>('aadhaar');
  const [idLast4, setIdLast4] = useState('');
  const [idProofDocumentId, setIdProofDocumentId] = useState<string | null>(null);
  const [selfieDocumentId, setSelfieDocumentId] = useState<string | null>(null);

  const canSubmit =
    /^\d{4}$/.test(idLast4) && idProofDocumentId !== null && selfieDocumentId !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('partner.verification.idTypeLabel')}>
          {(id) => (
            <Select
              id={id}
              value={idType}
              onChange={(e) => setIdType(e.target.value as typeof idType)}
            >
              {ID_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`partner.verification.idType.${type}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Four digits only, enforced at the input: `maxLength` plus the
            non-digit strip below mean a full Aadhaar number cannot be held in
            this state, let alone sent. Never widen this field. */}
        <Field
          label={t('partner.verification.idLast4Label')}
          hint={t('partner.verification.idLast4Hint')}
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              maxLength={4}
              value={idLast4}
              onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="tracking-[0.4em] sm:max-w-[10rem]"
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DocumentUploader
          docType="id_proof"
          label={t('partner.verification.idProofUpload')}
          onUploaded={(doc) => setIdProofDocumentId(doc.id)}
        />
        <DocumentUploader
          docType="photo"
          label={t('partner.verification.selfieUpload')}
          onUploaded={(doc) => setSelfieDocumentId(doc.id)}
        />
      </div>

      <SubmitRow
        disabled={!canSubmit}
        label={t('partner.verification.submitLevel')}
        onClick={() => onSubmitted({ idType, idLast4, idProofDocumentId, selfieDocumentId })}
      />
    </div>
  );
}

function Level1Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [consent, setConsent] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3.5 text-sm leading-relaxed text-slate-700 transition-colors hover:border-brand/40 hover:bg-brand/5">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-brand"
        />
        {t('partner.verification.consentText')}
      </label>
      <SubmitRow
        disabled={!consent}
        label={t('partner.verification.submitLevel')}
        onClick={() => onSubmitted({ consent: true })}
      />
    </div>
  );
}

function Level2Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [route, setRoute] = useState<'certificate' | 'tradeTest' | 'fieldAudit'>('certificate');
  const [certificateDocumentId, setCertificateDocumentId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const canSubmit =
    route === 'certificate' ? certificateDocumentId !== null : notes.trim().length > 0;

  function submit() {
    if (route === 'certificate') {
      onSubmitted({ certificateDocumentId });
    } else {
      onSubmitted({ [route]: true, notes: notes.trim() });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('partner.verification.skillRouteLabel')}>
        {(id) => (
          <Select id={id} value={route} onChange={(e) => setRoute(e.target.value as typeof route)}>
            <option value="certificate">{t('partner.verification.route.certificate')}</option>
            <option value="tradeTest">{t('partner.verification.route.tradeTest')}</option>
            <option value="fieldAudit">{t('partner.verification.route.fieldAudit')}</option>
          </Select>
        )}
      </Field>

      {route === 'certificate' ? (
        <DocumentUploader
          docType="certificate"
          label={t('partner.verification.certificateUpload')}
          onUploaded={(doc) => setCertificateDocumentId(doc.id)}
        />
      ) : (
        <Field
          label={t('partner.verification.notesLabel')}
          hint={t('partner.verification.notesHint')}
        >
          {(id) => (
            <TextArea
              id={id}
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          )}
        </Field>
      )}

      <SubmitRow
        disabled={!canSubmit}
        label={t('partner.verification.submitLevel')}
        onClick={submit}
      />
    </div>
  );
}

function NeedsInfoForm({
  onSubmitted,
}: {
  onSubmitted: (notes: string, documentIds: string[]) => void;
}) {
  const t = useT();
  const [notes, setNotes] = useState('');
  const [docIds, setDocIds] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-warning/5 p-4 ring-1 ring-inset ring-warning/25">
      <p className="flex items-start gap-2.5 text-sm font-medium leading-relaxed text-slate-800">
        <MessageSquareWarning
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          aria-hidden="true"
          strokeWidth={2.25}
        />
        {t('partner.verification.needsInfoHint')}
      </p>
      <Field label={t('partner.verification.replyLabel')}>
        {(id) => (
          <TextArea
            id={id}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        )}
      </Field>
      <DocumentUploader
        docType="other"
        label={t('partner.verification.replyDocUpload')}
        onUploaded={(doc) => setDocIds((prev) => [...prev, doc.id])}
      />
      <SubmitRow
        disabled={notes.trim().length === 0}
        label={t('partner.verification.replySubmit')}
        onClick={() => onSubmitted(notes.trim(), docIds)}
      />
    </div>
  );
}

/** The submit button of every level form, so the ladder reads consistently. */
function SubmitRow({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-end border-t border-slate-100 pt-4">
      <Button variant="primary" disabled={disabled} onClick={onClick} className="sm:min-w-[10rem]">
        {label}
      </Button>
    </div>
  );
}

export function VerificationLevelCard({
  level,
  levelName,
  caseData,
}: {
  level: 0 | 1 | 2 | 3;
  levelName: string;
  caseData: VerificationCaseResponse | undefined;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: partnerKeys.verificationCases });

  const submit = useMutation({
    mutationFn: (payload: unknown) => submitLevel(level, payload),
    onSuccess: invalidate,
  });

  const reply = useMutation({
    mutationFn: ({ notes, documentIds }: { notes: string; documentIds: string[] }) =>
      caseData
        ? provideInfo(caseData.id, notes, documentIds.length > 0 ? documentIds : undefined)
        : Promise.reject(new Error('no case')),
    onSuccess: invalidate,
  });

  const status = caseData?.status;
  const canResubmit = !caseData || status === 'failed';

  const tone: Tone = status ? STATUS_TONE[status] : 'neutral';
  const StatusIcon = status ? STATUS_ICON[status] : ShieldQuestion;

  return (
    <section
      className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
        // The card's own edge carries the state too, so the ladder can be
        // scanned down its left side without reading a single pill.
        status === 'passed'
          ? 'border-success/40'
          : status === 'needs_info'
            ? 'border-warning/50'
            : status === 'failed'
              ? 'border-danger/40'
              : 'border-slate-200'
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 lg:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              tone === 'success'
                ? 'bg-success/10 text-success'
                : tone === 'warning'
                  ? 'bg-warning/10 text-warning'
                  : tone === 'danger'
                    ? 'bg-danger/10 text-danger'
                    : tone === 'brand'
                      ? 'bg-brand/10 text-brand'
                      : 'bg-slate-100 text-slate-500'
            }`}
          >
            <StatusIcon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('partner.verification.levelLabel', { n: level })}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900">
              {levelName}
            </h3>
          </div>
        </div>
        <div className="shrink-0">
          <StatusPill tone={tone}>
            {status
              ? t(`partner.verification.status.${status}`)
              : t('partner.verification.status.notStarted')}
          </StatusPill>
        </div>
      </header>

      <div className="p-4 lg:p-5">
        {submit.isError ? (
          <div className="mb-4">
            <ErrorState error={submit.error} onRetry={() => submit.reset()} />
          </div>
        ) : null}
        {reply.isError ? (
          <div className="mb-4">
            <ErrorState error={reply.error} onRetry={() => reply.reset()} />
          </div>
        ) : null}

        {status === 'needs_info' ? (
          <NeedsInfoForm
            onSubmitted={(notes, documentIds) => reply.mutate({ notes, documentIds })}
          />
        ) : canResubmit ? (
          <>
            {level === 0 ? <Level0Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
            {level === 1 ? <Level1Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
            {level === 2 ? <Level2Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
          </>
        ) : (
          <p
            className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm leading-relaxed ${
              status === 'passed'
                ? 'bg-success/5 text-slate-700 ring-1 ring-inset ring-success/20'
                : 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200'
            }`}
          >
            <StatusIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                status === 'passed' ? 'text-success' : 'text-brand'
              }`}
              aria-hidden="true"
              strokeWidth={2.25}
            />
            {status === 'passed'
              ? t('partner.verification.passedHint')
              : t('partner.verification.pendingHint')}
          </p>
        )}

        {caseData && caseData.events.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="inline-flex min-h-touch items-center gap-1.5 rounded-lg text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-150 ${showHistory ? 'rotate-180' : ''}`}
                aria-hidden="true"
                strokeWidth={2}
              />
              {showHistory
                ? t('partner.verification.hideHistory')
                : t('partner.verification.showHistory')}
            </button>
            {showHistory ? (
              <ol className="mt-2 flex flex-col gap-2.5 border-l border-slate-200 pl-4">
                {caseData.events.map((event) => (
                  <li key={event.id} className="relative text-xs leading-relaxed">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.3125rem] top-1.5 h-1.5 w-1.5 rounded-full bg-slate-300"
                    />
                    <span className="font-medium text-slate-700">
                      {t(`partner.verification.event.${event.eventType}`)}
                    </span>
                    <span className="ml-1.5 text-slate-400">
                      {new Date(event.createdAt).toLocaleString('hi-IN')}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
