import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
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

export function AvailabilityEditor({
  availability,
}: {
  availability: ProviderAvailabilityResponse[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile });

  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('22:00');
  const [formError, setFormError] = useState<string | null>(null);

  const existing = useMemo(() => toActiveWindows(availability), [availability]);

  const addWindow = useMutation({
    mutationFn: (window: { dayOfWeek: number; startTime: string; endTime: string }) =>
      createAvailability(window),
    onSuccess: invalidate,
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
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAvailability(id),
    onSuccess: invalidate,
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
    <div className="flex flex-col gap-4">
      <Button
        variant="primary"
        fullWidth
        disabled={addPreset.isPending}
        onClick={() => addPreset.mutate()}
      >
        {addPreset.isPending
          ? t('partner.availability.presetApplying')
          : t('partner.availability.presetButton')}
      </Button>
      <p className="text-xs text-muted">{t('partner.availability.presetHint')}</p>

      <ul className="flex flex-col gap-2">
        {byDay.map(({ key, windows }) => (
          <li key={key} className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-sm font-semibold text-slate-700">
              {t(`partner.availability.day.${key}`)}
            </p>
            {windows.length === 0 ? (
              <p className="text-xs text-slate-400">{t('partner.availability.dayEmpty')}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {windows.map((window) => (
                  <li
                    key={window.id}
                    className="flex items-center justify-between text-sm text-slate-800"
                  >
                    <span>
                      {window.startTime}–{window.endTime}
                      {!window.isActive ? ` (${t('partner.availability.inactive')})` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove.mutate(window.id)}
                      disabled={remove.isPending}
                      className="min-h-touch px-2 text-sm font-medium text-danger"
                    >
                      {t('partner.common.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 p-3">
        <p className="text-sm font-medium text-slate-700">{t('partner.availability.addOne')}</p>
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
        <div className="grid grid-cols-2 gap-3">
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
        </div>

        {formError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {formError}
          </p>
        ) : null}
        {addWindow.isError ? (
          <ErrorState error={addWindow.error} onRetry={() => addWindow.reset()} />
        ) : null}

        <Button variant="secondary" onClick={handleAdd} disabled={addWindow.isPending}>
          {addWindow.isPending ? t('partner.availability.adding') : t('partner.availability.add')}
        </Button>
      </div>
    </div>
  );
}
