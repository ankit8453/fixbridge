import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Paperclip, UploadCloud } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { ErrorState } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { confirmUpload, requestUploadUrl } from '../lib/api';
import type { ProviderDocumentType, VerificationDocumentResponse } from '../lib/types';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * The three-step signed-URL flow (docs/API.md, Verification › Documents), as
 * one control: request a URL → `PUT` straight to storage → confirm.
 *
 * The API never sees file bytes, so a client is the only place this
 * sequence can live. `requiredHeaders` must go on the `PUT` **verbatim** —
 * `sizeBytes` is signed into the URL, so a mismatched `Content-Length`
 * (e.g. from a browser that recomputes it) makes storage reject the
 * signature, not just the size.
 *
 * Visually it is a dashed drop-zone-shaped button rather than a bare "Choose
 * file": the whole box is the target, which is a far easier thing to hit with
 * a thumb than a text-width control, and it leaves room to show the chosen
 * file, the in-flight state and the failure in the same place the file went
 * in. The native `<input type="file">` stays the only picker — it is what
 * opens the camera on Android, which is how most of these documents arrive.
 */
export function DocumentUploader({
  docType,
  label,
  onUploaded,
}: {
  docType: ProviderDocumentType;
  label: string;
  onUploaded: (document: VerificationDocumentResponse) => void;
}) {
  const t = useT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
        throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', t('partner.upload.badType'), null);
      }

      const { document, upload } = await requestUploadUrl({
        docType,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const putResponse = await fetch(upload.url, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: file,
      });

      if (!putResponse.ok) {
        throw new ApiError(
          putResponse.status,
          'UPLOAD_FAILED',
          t('partner.upload.putFailed'),
          null,
        );
      }

      const { document: confirmed } = await confirmUpload(document.id);
      return confirmed;
    },
    onSuccess: (document) => onUploaded(document),
  });

  const uploaded = mutation.isSuccess;

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ALLOWED_CONTENT_TYPES.join(',')}
        className="sr-only"
        disabled={mutation.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          // catch every call site — an ordinary upload failure (bad type,
          // storage PUT rejected) must not crash the page (see phase brief:
          // "mutateAsync rejects").
          mutation.mutate(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        className={`flex w-full min-h-touch items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${
          uploaded
            ? 'border-success/40 bg-success/5'
            : mutation.isError
              ? 'border-danger/40 bg-danger/5'
              : 'border-slate-300 bg-slate-50 hover:border-brand/50 hover:bg-brand/5'
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            uploaded ? 'bg-success/10 text-success' : 'bg-white text-brand ring-1 ring-slate-200'
          }`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.25} />
          ) : uploaded ? (
            <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.25} />
          ) : (
            <UploadCloud className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">
            {mutation.isPending
              ? t('partner.upload.uploading')
              : uploaded
                ? t('partner.upload.done')
                : fileName
                  ? t('partner.upload.chooseAnother')
                  : t('partner.upload.choose')}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {fileName ?? t('partner.upload.acceptedTypes')}
          </span>
        </span>
      </button>

      {/* An indeterminate bar, not a percentage: the `PUT` goes straight to
          storage via `fetch`, which reports no progress events, so a number
          here would be a fiction. */}
      {mutation.isPending ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
        </div>
      ) : null}

      {fileName && !mutation.isPending && !mutation.isError ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2} />
          <span className="truncate">{fileName}</span>
        </p>
      ) : null}

      {mutation.isError ? (
        <div className="mt-2">
          <ErrorState error={mutation.error} onRetry={() => mutation.reset()} />
        </div>
      ) : null}
    </div>
  );
}
