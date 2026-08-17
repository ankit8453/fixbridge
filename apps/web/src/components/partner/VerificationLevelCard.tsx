'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { DocumentUploader } from './DocumentUploader';
import { provideInfo, submitLevel } from './lib/api';
import { partnerKeys } from './lib/query-keys';
import type { VerificationCaseResponse, VerificationCaseStatus } from './lib/types';

const STATUS_TONE: Record<VerificationCaseStatus, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  submitted: 'info',
  in_review: 'info',
  needs_info: 'warn',
  passed: 'good',
  failed: 'bad',
};

const ID_TYPES = ['aadhaar', 'pan', 'dl', 'voter'] as const;
const REFERENCE_RELATIONSHIPS = [
  'past_employer',
  'shop_owner',
  'senior_technician',
  'other',
] as const;

function Level0Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>('aadhaar');
  const [idLast4, setIdLast4] = useState('');
  const [idProofDocumentId, setIdProofDocumentId] = useState<string | null>(null);
  const [selfieDocumentId, setSelfieDocumentId] = useState<string | null>(null);

  const canSubmit =
    /^\d{4}$/.test(idLast4) && idProofDocumentId !== null && selfieDocumentId !== null;

  return (
    <div className="flex flex-col gap-3">
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
          />
        )}
      </Field>
      <DocumentUploader
        docType="id_proof"
        label={t('partner.verification.idProofUpload')}
        onUploaded={(doc) => setIdProofDocumentId(doc.id)}
      />
      <DocumentUploader
        docType="other"
        label={t('partner.verification.selfieUpload')}
        onUploaded={(doc) => setSelfieDocumentId(doc.id)}
      />
      <Button
        variant="primary"
        disabled={!canSubmit}
        onClick={() => onSubmitted({ idType, idLast4, idProofDocumentId, selfieDocumentId })}
      >
        {t('partner.verification.submitLevel')}
      </Button>
    </div>
  );
}

function Level1Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [consent, setConsent] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        {t('partner.verification.consentText')}
      </label>
      <Button variant="primary" disabled={!consent} onClick={() => onSubmitted({ consent: true })}>
        {t('partner.verification.submitLevel')}
      </Button>
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
    <div className="flex flex-col gap-3">
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          )}
        </Field>
      )}

      <Button variant="primary" disabled={!canSubmit} onClick={submit}>
        {t('partner.verification.submitLevel')}
      </Button>
    </div>
  );
}

interface ReferenceDraft {
  name: string;
  phone: string;
  relationship: (typeof REFERENCE_RELATIONSHIPS)[number];
}

function Level3Form({ onSubmitted }: { onSubmitted: (payload: unknown) => void }) {
  const t = useT();
  const [refs, setRefs] = useState<[ReferenceDraft, ReferenceDraft]>([
    { name: '', phone: '', relationship: 'past_employer' },
    { name: '', phone: '', relationship: 'past_employer' },
  ]);

  function update(index: 0 | 1, patch: Partial<ReferenceDraft>) {
    setRefs((prev) => {
      const next = [...prev] as [ReferenceDraft, ReferenceDraft];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  const canSubmit = refs.every((r) => r.name.trim().length >= 2 && r.phone.trim().length >= 10);

  return (
    <div className="flex flex-col gap-4">
      {refs.map((ref, index) => (
        <div key={index} className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            {t('partner.verification.referenceN', { n: index + 1 })}
          </p>
          <div className="flex flex-col gap-2">
            <TextInput
              aria-label={t('partner.verification.referenceName')}
              placeholder={t('partner.verification.referenceName')}
              value={ref.name}
              onChange={(e) => update(index as 0 | 1, { name: e.target.value })}
            />
            <TextInput
              aria-label={t('partner.verification.referencePhone')}
              placeholder={t('partner.verification.referencePhone')}
              inputMode="tel"
              value={ref.phone}
              onChange={(e) => update(index as 0 | 1, { phone: e.target.value })}
            />
            <Select
              aria-label={t('partner.verification.referenceRelationship')}
              value={ref.relationship}
              onChange={(e) =>
                update(index as 0 | 1, {
                  relationship: e.target.value as ReferenceDraft['relationship'],
                })
              }
            >
              {REFERENCE_RELATIONSHIPS.map((rel) => (
                <option key={rel} value={rel}>
                  {t(`partner.verification.relationship.${rel}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ))}
      <Button
        variant="primary"
        disabled={!canSubmit}
        onClick={() => onSubmitted({ references: refs })}
      >
        {t('partner.verification.submitLevel')}
      </Button>
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
    <div className="flex flex-col gap-3 rounded-lg bg-amber-50 p-3">
      <Field label={t('partner.verification.replyLabel')}>
        {(id) => (
          <TextArea
            id={id}
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
      <Button
        variant="primary"
        disabled={notes.trim().length === 0}
        onClick={() => onSubmitted(notes.trim(), docIds)}
      >
        {t('partner.verification.replySubmit')}
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
      provideInfo(caseData!.id, notes, documentIds.length > 0 ? documentIds : undefined),
    onSuccess: invalidate,
  });

  const status = caseData?.status;
  const canResubmit = !caseData || status === 'failed';

  return (
    <Card
      title={t('partner.verification.levelTitle', { n: level, name: levelName })}
      actions={
        <Badge tone={status ? STATUS_TONE[status] : 'neutral'}>
          {status
            ? t(`partner.verification.status.${status}`)
            : t('partner.verification.status.notStarted')}
        </Badge>
      }
    >
      {submit.isError ? <ErrorState error={submit.error} onRetry={() => submit.reset()} /> : null}
      {reply.isError ? <ErrorState error={reply.error} onRetry={() => reply.reset()} /> : null}

      {status === 'needs_info' ? (
        <NeedsInfoForm onSubmitted={(notes, documentIds) => reply.mutate({ notes, documentIds })} />
      ) : canResubmit ? (
        <>
          {level === 0 ? <Level0Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
          {level === 1 ? <Level1Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
          {level === 2 ? <Level2Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
          {level === 3 ? <Level3Form onSubmitted={(payload) => submit.mutate(payload)} /> : null}
        </>
      ) : (
        <p className="text-sm text-slate-600">
          {status === 'passed'
            ? t('partner.verification.passedHint')
            : t('partner.verification.pendingHint')}
        </p>
      )}

      {caseData && caseData.events.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="min-h-touch text-sm font-medium text-slate-600 underline"
          >
            {showHistory
              ? t('partner.verification.hideHistory')
              : t('partner.verification.showHistory')}
          </button>
          {showHistory ? (
            <ul className="mt-2 flex flex-col gap-1">
              {caseData.events.map((event) => (
                <li key={event.id} className="text-xs text-slate-500">
                  {new Date(event.createdAt).toLocaleString('hi-IN')} —{' '}
                  {t(`partner.verification.event.${event.eventType}`)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
