'use client';

import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { confirmUpload, requestUploadUrl } from './lib/api';
import type { ProviderDocumentType, VerificationDocumentResponse } from './lib/types';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * The three-step signed-URL flow (docs/API.md §Verification › Documents),
 * as one control: request a URL → `PUT` straight to storage → confirm.
 *
 * The API never sees file bytes, so a client is the only place this
 * sequence can live. `requiredHeaders` must go on the `PUT` **verbatim** —
 * `sizeBytes` is signed into the URL, so a mismatched `Content-Length`
 * (e.g. from a browser that recomputes it) makes storage reject the
 * signature, not just the size.
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

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
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
          mutation.mutate(file);
        }}
      />

      <Button
        type="button"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
      >
        {t('partner.upload.choose')}
      </Button>

      {fileName ? <p className="text-xs text-slate-500">{fileName}</p> : null}

      {mutation.isPending ? (
        <p className="text-sm text-slate-500">{t('partner.upload.uploading')}</p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="text-sm font-medium text-green-700">{t('partner.upload.done')}</p>
      ) : null}

      {mutation.isError ? (
        <ErrorState error={mutation.error} onRetry={() => mutation.reset()} />
      ) : null}
    </div>
  );
}
