import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Camera, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Avatar, ErrorState } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { confirmPhotoUpload, fetchMyPhoto, requestPhotoUploadUrl } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { ProfilePhotoStatus } from '../lib/types';

/**
 * The technician's public-facing profile photo — the one a customer sees once
 * they have a booking with this person.
 *
 * ## Why this is not `DocumentUploader`
 *
 * The flow is the same three signed-URL steps, but three things differ and all
 * three are visible to the technician:
 *
 *   - **A different store.** This is not a KYC document. It goes to
 *     `/providers/me/photo/*`, not `/verification/documents/*`, because a KYC
 *     document is private evidence and this is the one file a customer is meant
 *     to see. Reusing the document uploader would have meant reusing the
 *     endpoint, and that is the thing that must not happen.
 *   - **Images only.** No PDF. A photograph of a face is the whole point, and an
 *     SVG is refused server-side too — it can carry script, and this is the one
 *     object served inline rather than as a download.
 *   - **It has a moderation state, and that state is the interface.** A
 *     technician who uploads a photo and sees only "Uploaded" will assume
 *     customers can see it. They cannot, until a human approves it. Showing
 *     `pending` / `approved` / `rejected` — with the rejection reason — is the
 *     difference between a technician who knows where they stand and one who
 *     thinks the app is broken.
 *
 * A replacement always re-enters review, including a replacement for an already
 * approved photo, and the copy says so before the picker opens.
 */

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** The visual treatment for each moderation state. */
const STATUS_STYLES: Record<
  ProfilePhotoStatus,
  { icon: typeof CheckCircle2; className: string; labelKey: string; hintKey: string }
> = {
  pending: {
    icon: Clock,
    className: 'text-warning',
    labelKey: 'partner.photo.statusPending',
    hintKey: 'partner.photo.statusPendingHint',
  },
  approved: {
    icon: CheckCircle2,
    className: 'text-success',
    labelKey: 'partner.photo.statusApproved',
    hintKey: 'partner.photo.statusApprovedHint',
  },
  rejected: {
    icon: AlertCircle,
    className: 'text-danger',
    labelKey: 'partner.photo.statusRejected',
    hintKey: 'partner.photo.statusRejectedHint',
  },
};

export function ProfilePhotoUploader({ displayName }: { displayName?: string | null }) {
  const t = useT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);

  const photoQuery = useQuery({
    queryKey: partnerKeys.profilePhoto,
    queryFn: fetchMyPhoto,
  });

  const photo = photoQuery.data?.photo ?? null;

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
        throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', t('partner.photo.badType'), null);
      }

      const { photoId, upload } = await requestPhotoUploadUrl({
        contentType: file.type,
        sizeBytes: file.size,
      });

      // `requiredHeaders` go on verbatim — the size is signed into the URL, so a
      // recomputed `Content-Length` breaks the signature, not just the limit.
      const putResponse = await fetch(upload.url, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: file,
      });

      if (!putResponse.ok) {
        throw new ApiError(putResponse.status, 'UPLOAD_FAILED', t('partner.upload.putFailed'), null);
      }

      return confirmPhotoUpload(photoId);
    },
    onSuccess: () => {
      // The confirm response carries the new photo, but re-fetching keeps the
      // signed URL's lifetime owned by one place rather than two.
      void queryClient.invalidateQueries({ queryKey: partnerKeys.profilePhoto });
      // The photo is not scored by completeness today, but the profile card
      // shows the technician's identity and should not go stale beside it.
      void queryClient.invalidateQueries({ queryKey: partnerKeys.profile });
    },
  });

  const status = photo?.status;
  const style = status ? STATUS_STYLES[status] : null;
  const StatusIcon = style?.icon;

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-4">
        {/*
          The technician sees their own photo in every state, including pending
          and rejected — they cannot judge what to replace without seeing what
          ops saw. Only the *customer* view is gated on approval.
        */}
        <Avatar name={displayName} src={photo?.url ?? null} size={72} />

        <div className="min-w-0 flex-1">
          {style && StatusIcon ? (
            <>
              <p className={`inline-flex items-center gap-1.5 text-sm font-medium ${style.className}`}>
                <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2.25} />
                {t(style.labelKey)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{t(style.hintKey)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">{t('partner.photo.none')}</p>
          )}
        </div>
      </div>

      {/*
        Ops' reason, verbatim and prominent. A rejection the technician cannot
        read is one they can only answer by guessing — they re-upload the same
        photo, it is refused again, and both sides conclude the other is being
        difficult.
      */}
      {photo?.status === 'rejected' && photo.rejectionNote ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-slate-700"
        >
          <span className="font-medium">{t('partner.photo.rejectionReason')}</span>{' '}
          {photo.rejectionNote}
        </p>
      ) : null}

      <label htmlFor={inputId} className="sr-only">
        {t('partner.photo.uploadLabel')}
      </label>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        // `capture` is absent on purpose: this opens the gallery *and* the
        // camera on Android, and a technician often already has a decent photo
        // of themselves. Forcing the camera would throw that away.
        accept={ALLOWED_CONTENT_TYPES.join(',')}
        className="sr-only"
        disabled={mutation.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          // `mutate`, not `mutateAsync` — an ordinary upload failure must not
          // reject an unhandled promise and crash the page.
          mutation.mutate(file);
          // Clear the input so choosing the *same* file again still fires
          // `change`, which is what a retry after a failure looks like.
          event.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        className={`flex w-full min-h-touch items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${
          mutation.isError
            ? 'border-danger/40 bg-danger/5'
            : 'border-slate-300 bg-slate-50 hover:border-brand/50 hover:bg-brand/5'
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand ring-1 ring-slate-200"
        >
          {mutation.isPending ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.25} />
          ) : (
            <Camera className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">
            {mutation.isPending
              ? t('partner.photo.uploading')
              : photo
                ? t('partner.photo.replace')
                : t('partner.photo.choose')}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {/* Said before the picker opens, not after: replacing an approved
                photo sends it back for review, and a technician who discovers
                that afterwards has been surprised by their own app. */}
            {fileName ?? (photo ? t('partner.photo.replaceHint') : t('partner.photo.acceptedTypes'))}
          </span>
        </span>
      </button>

      {/* Indeterminate: the `PUT` goes straight to storage via `fetch`, which
          reports no progress events, so a percentage would be a fiction. */}
      {mutation.isPending ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
        </div>
      ) : null}

      {mutation.isError ? <ErrorState error={mutation.error} onRetry={() => mutation.reset()} /> : null}
    </div>
  );
}
