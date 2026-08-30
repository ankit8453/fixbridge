import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { useActionToast } from '../../../lib/use-action-toast';
import { Button, ErrorState, Field, Select, TextInput } from '../../../components/ui';
import { createAvailability, deleteAvailability } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import {
  parseTimeOfDay,
  validateWindow,
  type AvailabilityWindow,
} from '../lib/availability-overlap';
import type { ProviderAvailabilityResponse } from '../lib/types';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * "Weekday evenings + Sunday" in one tap — the part-timer's whole use case.
 * Monday–Friday evenings plus a full Sunday is the shape almost every
 * part-time mistri actually works; typing six windows by hand on a phone
 * keyboard is the thing this button exists to skip.
 */
const WEEKDAY_EVENINGS_PRESET: AvailabilityWindow[] = [
  { dayOfWeek: 1, startMinute: 18 * 60, endMinute: 22 * 60 },
  { dayOfWeek: 2, startMinute: 18 * 60, endMinute: 22 * 60 },
  { dayOfWeek: 3, startMinute: 18 * 60, endMinute: 22 * 60 },
  { dayOfWeek: 4, startMinute: 18 * 60, endMinute: 22 * 60 },
  { dayOfWeek: 5, startMinute: 18 * 60, endMinute: 22 * 60 },
  { dayOfWeek: 0, startMinute: 9 * 60, endMinute: 18 * 60 },
];

function toActiveWindows(rows: ProviderAvailabilityResponse[]): AvailabilityWindow[] {
  return rows
    .filter((row) => row.isActive)
    .map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startMinute: parseTimeOfDay(row.startTime) ?? 0,
      endMinute: parseTimeOfDay(row.endTime) ?? 0,
    }));
}

/**
 * The recurring weekly hours editor.
 *
 * Renders as a seven-column week from `lg` up and a stacked list below, so
 * the same component serves a technician thumbing it in on a phone and one
 * reviewing the whole week at a desk. It stays a bare fragment with no outer
 * card of its own — `Onboarding` mounts it inside a `Card`, and a panel
 * inside a panel reads as a bug.
 */
export function AvailabilityEditor({
  availability,
}: {
  availability: ProviderAvailabilityResponse[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useActionToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile });

  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('22:00');
  const [formError, setFormError] = useState<string | null>(null);

  const existing = useMemo(() => toActiveWindows(availability), [availability]);

  const addWindow = useMutation({
    mutationFn: (window: { dayOfWeek: number; startTime: string; endTime: string }) =>
      createAvailability(window),
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      invalidate();
    },
  });

  const addPreset = useMutation({
    mutationFn: async () => {
      // Skip anything the preset would clash with instead of failing the
      // whole tap — a technician who already has Tuesday evening covered
      // should still get the other five windows in one go.
      const toCreate = WEEKDAY_EVENINGS_PRESET.filter(
        (candidate) => validateWindow(candidate, existing) === null,
      );
      await Promise.all(
        toCreate.map((window) =>
          createAvailability({
            dayOfWeek: window.dayOfWeek,
            startTime: `${String(Math.floor(window.startMinute / 60)).padStart(2, '0')}:${String(window.startMinute % 60).padStart(2, '0')}`,
            endTime: `${String(Math.floor(window.endMinute / 60)).padStart(2, '0')}:${String(window.endMinute % 60).padStart(2, '0')}`,
          }),
        ),
      );
    },
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAvailability(id),
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      invalidate();
    },
  });

  function reasonMessage(
    reason: 'invalid_day' | 'out_of_range' | 'end_before_start' | 'overlap',
  ): string {
    if (reason === 'end_before_start') return t('partner.availability.errorEndBeforeStart');
    if (reason === 'overlap') return t('partner.availability.errorOverlap');
    return t('partner.availability.errorInvalid');
  }

  function handleAdd() {
    setFormError(null);
    const startMinute = parseTimeOfDay(startTime);
    const endMinute = parseTimeOfDay(endTime);

    if (startMinute === null || endMinute === null) {
      setFormError(t('partner.availability.errorInvalid'));
      return;
    }

    const problem = validateWindow({ dayOfWeek, startMinute, endMinute }, existing);
    if (problem) {
      setFormError(reasonMessage(problem.kind));
      return;
    }

    addWindow.mutate({ dayOfWeek, startTime, endTime });
  }

  const byDay = DAY_KEYS.map((key, dayIndex) => ({
    key,
    windows: availability.filter((row) => row.dayOfWeek === dayIndex),
  }));

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------- One-tap preset ---------------- */}
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {t('partner.availability.presetTitle')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {t('partner.availability.presetHint')}
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={addPreset.isPending}
            onClick={() => addPreset.mutate()}
            className="w-full sm:w-auto"
          >
            {addPreset.isPending
              ? t('partner.availability.presetApplying')
              : t('partner.availability.presetButton')}
          </Button>
        </div>
      </div>

      {/* ---------------- The week ---------------- */}
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3 xl:grid-cols-7">
        {byDay.map(({ key, windows }) => (
          <li
            key={key}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t(`partner.availability.day.${key}`)}
            </p>

            <div className="flex-1 p-2">
              {windows.length === 0 ? (
                <p className="px-1 py-2 text-xs text-slate-400">
                  {t('partner.availability.dayEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {windows.map((window) => (
                    <li
                      key={window.id}
                      className={`flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 ${
                        window.isActive
                          ? 'border-success/20 bg-success/5'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0 text-xs">
                        <span
                          className={`block font-semibold tabular-nums ${
                            window.isActive ? 'text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          {window.startTime}–{window.endTime}
                        </span>
                        {!window.isActive ? (
                          <span className="block text-[11px] text-slate-400">
                            {t('partner.availability.inactive')}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove.mutate(window.id)}
                        disabled={remove.isPending}
                        aria-label={t('partner.common.delete')}
                        title={t('partner.common.delete')}
                        className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* ---------------- Add one window ---------------- */}
      <div className="rounded-xl border border-dashed border-slate-300 p-4">
        <p className="text-sm font-semibold text-slate-900">{t('partner.availability.addOne')}</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label={t('partner.availability.dayLabel')}>
            {(id) => (
              <Select
                id={id}
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {DAY_KEYS.map((key, index) => (
                  <option key={key} value={index}>
                    {t(`partner.availability.day.${key}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('partner.availability.startLabel')}>
            {(id) => (
              <TextInput
                id={id}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('partner.availability.endLabel')}>
            {(id) => (
              <TextInput
                id={id}
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            )}
          </Field>

          <Button
            variant="secondary"
            onClick={handleAdd}
            disabled={addWindow.isPending}
            className="w-full"
          >
            <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            {addWindow.isPending ? t('partner.availability.adding') : t('partner.availability.add')}
          </Button>
        </div>

        {formError ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {formError}
          </p>
        ) : null}
        {addWindow.isError ? (
          <div className="mt-3">
            <ErrorState error={addWindow.error} onRetry={() => addWindow.reset()} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
