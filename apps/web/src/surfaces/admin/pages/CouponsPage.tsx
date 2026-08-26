import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, TicketPercent } from 'lucide-react';
import {
  createCoupon,
  fetchCouponStats,
  fetchCoupons,
  pauseCoupon,
  resumeCoupon,
  updateCoupon,
  type CreateCouponInput,
  type UpdateCouponInput,
} from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { useFilters } from '../lib/filters';
import type { CouponRow, CouponStatus } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { absoluteTime } from '../lib/time';
import { Pill, SkeletonRows, StatTile, EmptyState as AdminEmptyState } from '../components/ui';
import { useAuth } from '@/lib/auth/useAuth';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Modal,
  Pagination,
  Select,
  Table,
  TextArea,
  TextInput,
  type TableColumn,
} from '@/components/ui';
import { formatPaise, parseRupeesToPaise } from '@/lib/money';

/**
 * `/admin/coupons` — the console's view of the discount campaigns.
 *
 * Two rules from `apps/api/src/modules/coupons/discount.ts` decide almost
 * everything on this screen, and both are stated in the UI rather than left
 * as tribal knowledge:
 *
 *   1. **A coupon is funded by the platform's commission.** The technician is
 *      always paid on the pre-discount amount. Every rupee a campaign gives
 *      away is a rupee off our own cut, which is why the "given away" figure
 *      sits in the stat row next to the counts rather than buried in a detail
 *      panel — an ops user creating a coupon should see the cost before they
 *      see the code.
 *   2. **Online payments only.** On cash the technician collects the
 *      discounted amount in their hand while commission is computed on the
 *      full price, so the discount would come out of *their* pocket — rule 1
 *      inverted. The server refuses it outright; this screen says so.
 *
 * The mutations are admin-only (`ADMIN_ONLY_ROUTES` in
 * `apps/api/src/core/audit.ts` covers create/update/pause/resume). Following
 * the same convention as MoneyPage's dues settlement, those controls are
 * **hidden** for an ops token rather than disabled: a button that exists only
 * to 403 teaches nobody anything.
 */

const STATUS_TONE: Record<CouponStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  expired: 'neutral',
};

/** Mirrors the API's `MAX_CAP_PAISE` — ₹2,00,000, the blast radius on one job. */
const MAX_CAP_PAISE = 200_00_000;

export default function CouponsPage() {
  const { roles } = useAuth();
  const canManage = roles.includes('admin');
  const filters = useFilters();

  /** `undefined` = the create form; a row = editing that row. */
  const [editing, setEditing] = useState<CouponRow | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [toggling, setToggling] = useState<CouponRow | null>(null);

  const params = {
    status: filters.get('status'),
    q: filters.get('q'),
    city_id: filters.get('city_id'),
    page: filters.page,
  };

  const query = useQuery({
    queryKey: ['admin', 'coupons', params],
    queryFn: () => fetchCoupons(params),
  });

  const toggle = useAdminMutation(
    (input: { couponId: string; to: 'paused' | 'active' }) =>
      input.to === 'paused' ? pauseCoupon(input.couponId) : resumeCoupon(input.couponId),
    { invalidate: [['admin', 'coupons']], onDone: () => setToggling(null) },
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditing(undefined);
  };

  const columns: TableColumn<CouponRow>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (row) => (
        <div className="min-w-0">
          <div className="font-semibold tracking-wide text-slate-900">{row.code}</div>
          <div className="max-w-xs truncate text-xs text-muted" title={row.description}>
            {row.description}
          </div>
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      render: (row) => (
        <span className="font-medium">
          {row.discountType === 'percent' ? `${row.value}%` : formatPaise(row.value)}
          <span className="ml-1 text-xs text-muted">{row.discountType}</span>
        </span>
      ),
    },
    {
      key: 'cap',
      header: 'Cap',
      align: 'right',
      // The cap is never optional, so it never renders as a dash — a blank
      // here would read as "uncapped", which this system cannot produce.
      render: (row) => formatPaise(row.maxDiscountPaise),
    },
    {
      key: 'minOrder',
      header: 'Min order',
      align: 'right',
      render: (row) =>
        row.minOrderPaise > 0 ? (
          formatPaise(row.minOrderPaise)
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'window',
      header: 'Window',
      render: (row) => (
        <span
          className="whitespace-nowrap text-xs"
          title={`${absoluteTime(row.validFrom)} → ${absoluteTime(row.validUntil)}`}
        >
          <Timestamp value={row.validFrom} /> → <Timestamp value={row.validUntil} />
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Used',
      align: 'right',
      render: (row) => (
        <span>
          {row.redemptionCount}
          <span className="text-muted"> / {row.totalUsageLimit ?? '∞'}</span>
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Cost to us',
      align: 'right',
      render: (row) => formatPaise(row.discountedPaise),
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-muted">
          {row.cityId === null ? 'All cities' : `City ${row.cityId}`}
          {' · '}
          {row.categoryId === null ? 'all services' : `service ${row.categoryId}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Pill tone={STATUS_TONE[row.status]}>{row.status}</Pill>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canManage ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(row);
                setFormOpen(true);
              }}
            >
              Edit
            </Button>
            {/* An expired coupon has nothing to pause or resume — its window
                closed, and resuming it would not make it apply. Editing the
                dates is the only way back, so only Edit is offered. */}
            {row.status === 'expired' ? null : (
              <Button variant="secondary" size="sm" onClick={() => setToggling(row)}>
                {row.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Coupons"
        subtitle="Discount campaigns. Every rupee here comes out of the platform's commission — the technician is always paid on the full, pre-discount amount."
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              New coupon
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        <FundingNotice canManage={canManage} />

        <CouponStats />

        <Card
          title="Campaigns"
          actions={
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Code or description">
                {(id) => (
                  <TextInput
                    id={id}
                    defaultValue={params.q ?? ''}
                    placeholder="DIWALI50"
                    // Applied on blur or Enter, not per keystroke — each change
                    // is a request, and a code typed a character at a time is
                    // eight of them.
                    onBlur={(event) => filters.set('q', event.target.value.trim() || undefined)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        filters.set('q', event.currentTarget.value.trim() || undefined);
                      }
                    }}
                  />
                )}
              </Field>
              <Field label="Status">
                {(id) => (
                  <Select
                    id={id}
                    value={params.status ?? ''}
                    onChange={(event) => filters.set('status', event.target.value || undefined)}
                  >
                    <option value="">Any</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="expired">Expired</option>
                  </Select>
                )}
              </Field>
              <Field label="City id">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    defaultValue={params.city_id ?? ''}
                    onBlur={(event) =>
                      filters.set('city_id', event.target.value.trim() || undefined)
                    }
                  />
                )}
              </Field>
            </div>
          }
        >
          {/* Not `QueryState`: this screen wants the console's own skeleton and
              empty state (the ones that carry the teal vocabulary and can hold
              an action), so the three states are spelled out here. */}
          {query.status === 'pending' ? (
            <SkeletonRows rows={6} />
          ) : query.status === 'error' || query.data === undefined ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            <AdminEmptyState
              icon={TicketPercent}
              title="No coupons match those filters."
              description={
                canManage
                  ? 'A campaign needs a code, a window and a discount cap — the cap is required, because an uncapped percentage on a large quotation is an unbounded loss.'
                  : 'Only an admin account can create a campaign.'
              }
              action={
                canManage ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setEditing(undefined);
                      setFormOpen(true);
                    }}
                  >
                    New coupon
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <Table columns={columns} rows={query.data.items} rowKey={(row) => row.id} />
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={filters.setPage}
              />
            </>
          )}
        </Card>
      </div>

      {formOpen && canManage ? <CouponForm coupon={editing} onClose={closeForm} /> : null}

      {toggling && canManage ? (
        <ConfirmDialog
          title={
            toggling.status === 'paused' ? `Resume ${toggling.code}` : `Pause ${toggling.code}`
          }
          description={
            toggling.status === 'paused'
              ? 'Customers will be able to redeem this code again immediately, within its existing window. The platform funds every redemption out of its commission.'
              : 'Customers who try this code will be refused from the next request onward. Bookings that already carry it are untouched — the discount was priced into them when it was applied.'
          }
          confirmLabel={toggling.status === 'paused' ? 'Resume coupon' : 'Pause coupon'}
          tone={toggling.status === 'paused' ? 'primary' : 'danger'}
          pending={toggle.isPending}
          error={toggle.error}
          onClose={() => setToggling(null)}
          onConfirm={() =>
            toggle.mutate({
              couponId: toggling.id,
              to: toggling.status === 'paused' ? 'active' : 'paused',
            })
          }
        />
      ) : null}
    </>
  );
}

/**
 * The two domain rules, stated where somebody about to spend money reads them.
 *
 * Not a tooltip and not in the modal only: an ops user scanning this page to
 * answer "why is our commission down this month" needs the same sentence as
 * the admin creating the campaign.
 */
function FundingNotice({ canManage }: { canManage: boolean }) {
  return (
    <div className="flex gap-3 rounded-xl border border-admin/20 bg-admin-soft px-4 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-admin" aria-hidden="true" strokeWidth={2} />
      <div className="text-[13px] leading-relaxed text-admin-deep">
        <p>
          <strong>Coupons are platform-funded.</strong> The discount comes out of our commission,
          never the technician&apos;s earnings — they are paid on the pre-discount amount whatever
          the customer ends up paying.
        </p>
        <p className="mt-1">
          <strong>Online payments only.</strong> On a cash job the technician collects the
          discounted amount in their own hand while commission is charged on the full price, so the
          discount would land on them. The API refuses a coupon on a cash booking outright.
        </p>
        {canManage ? null : (
          <p className="mt-1">
            Only an admin account can create, edit, pause or resume a campaign.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The stat row, read from the platform-wide stats endpoint.
 *
 * These deliberately do NOT sum the rows on screen. "How much have coupons
 * cost us" is the question this screen exists to answer, and a figure that
 * changes when somebody pages or filters is not that answer — it is the kind
 * of quiet wrongness a money screen cannot afford.
 *
 * `GET /admin/coupons/stats` counts every coupon and every redemption, so the
 * numbers hold whatever the table below is showing.
 */
function CouponStats() {
  const query = useQuery({
    queryKey: ['admin', 'coupons', 'stats'],
    queryFn: fetchCouponStats,
  });

  const totals = query.data;
  const value = (shown: string): string => (query.status === 'pending' ? '—' : shown);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Coupons"
        value={value(String(totals?.totalCoupons ?? 0))}
        hint="Every coupon, not just this page."
        icon={TicketPercent}
        tone="admin"
      />
      <StatTile
        label="Active"
        value={value(String(totals?.activeCoupons ?? 0))}
        hint="Inside their window and not paused."
        tone="success"
      />
      <StatTile
        label="Redemptions"
        value={value(String(totals?.redemptionCount ?? 0))}
        hint="Counted from redemption rows, not a counter column."
        tone="info"
      />
      <StatTile
        label="Given away"
        value={value(formatPaise(totals?.discountedPaise ?? 0))}
        hint="Paid out of the platform's commission, never the technician's."
        tone="warning"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create / edit                                                              */
/* -------------------------------------------------------------------------- */

interface FormValues {
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  /** Percent as a whole number; flat as rupees typed by a human. */
  value: string;
  maxDiscountRupees: string;
  minOrderRupees: string;
  validFrom: string;
  validUntil: string;
  totalUsageLimit: string;
  perCustomerLimit: string;
  cityId: string;
  categoryId: string;
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local time. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The API's `validFrom`/`validUntil` are `z.string().datetime()` — a UTC ISO
 * instant with a `Z`, which `toISOString()` produces and a bare
 * `datetime-local` value does not. Converting through `Date` here is what makes
 * "9am on the 3rd" mean 9am to the person who typed it.
 */
function toIsoInstant(local: string): string | null {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const initialValues = (coupon: CouponRow | undefined): FormValues =>
  coupon
    ? {
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        value:
          coupon.discountType === 'percent'
            ? String(coupon.value)
            : (coupon.value / 100).toFixed(2),
        maxDiscountRupees: (coupon.maxDiscountPaise / 100).toFixed(2),
        minOrderRupees: (coupon.minOrderPaise / 100).toFixed(2),
        validFrom: toLocalInput(coupon.validFrom),
        validUntil: toLocalInput(coupon.validUntil),
        totalUsageLimit: coupon.totalUsageLimit === null ? '' : String(coupon.totalUsageLimit),
        perCustomerLimit: String(coupon.perCustomerLimit),
        cityId: coupon.cityId === null ? '' : String(coupon.cityId),
        categoryId: coupon.categoryId === null ? '' : String(coupon.categoryId),
      }
    : {
        code: '',
        description: '',
        discountType: 'percent',
        value: '',
        maxDiscountRupees: '',
        minOrderRupees: '0',
        validFrom: '',
        validUntil: '',
        totalUsageLimit: '',
        perCustomerLimit: '1',
        cityId: '',
        categoryId: '',
      };

/**
 * Client-side validation, mirroring `createCouponSchema` and `assertValidTerms`.
 *
 * A courtesy, not a control — the server validates the same things three times
 * over (Zod, `assertValidTerms`, then database CHECKs). What it buys is naming
 * the offending field instead of surfacing one envelope-level message, on a form
 * with twelve inputs.
 */
function validate(values: FormValues, isEdit: boolean): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!isEdit) {
    const code = values.code.trim();
    if (code.length < 3 || code.length > 40) {
      errors.code = 'A code is 3 to 40 characters.';
    } else if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      errors.code =
        'Letters, digits, dashes and underscores only — it has to survive a phone call.';
    }
  }

  const description = values.description.trim();
  if (description.length < 3 || description.length > 200) {
    errors.description = 'A description is 3 to 200 characters.';
  }

  if (values.discountType === 'percent') {
    const percent = Number(values.value);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      errors.value = 'A percent coupon is a whole number from 1 to 100.';
    }
  } else {
    const paise = parseRupeesToPaise(values.value);
    if (paise === null || paise < 1 || paise > MAX_CAP_PAISE) {
      errors.value = `A flat discount is a positive rupee amount up to ${formatPaise(MAX_CAP_PAISE)}.`;
    }
  }

  // Required, always: an uncapped percentage on a commercial quotation is an
  // unbounded loss, which is why the API has no "leave blank for unlimited".
  const cap = parseRupeesToPaise(values.maxDiscountRupees);
  if (cap === null || cap < 1) {
    errors.maxDiscountRupees = 'Every coupon needs a cap, and it must be more than zero.';
  } else if (cap > MAX_CAP_PAISE) {
    errors.maxDiscountRupees = `The cap cannot exceed ${formatPaise(MAX_CAP_PAISE)} on one job.`;
  }

  const minOrder = parseRupeesToPaise(values.minOrderRupees || '0');
  if (minOrder === null || minOrder > MAX_CAP_PAISE) {
    errors.minOrderRupees = 'Enter a rupee amount, zero or more.';
  }

  const from = values.validFrom ? toIsoInstant(values.validFrom) : null;
  const until = values.validUntil ? toIsoInstant(values.validUntil) : null;

  if (!from) errors.validFrom = 'A start date and time is required.';
  if (!until) errors.validUntil = 'An end date and time is required.';
  if (from && until && new Date(until).getTime() <= new Date(from).getTime()) {
    errors.validUntil = 'A coupon must expire after it starts.';
  }

  if (values.totalUsageLimit.trim() !== '') {
    const limit = Number(values.totalUsageLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
      errors.totalUsageLimit = 'A whole number from 1 to 1,000,000, or leave blank for no limit.';
    }
  }

  const perCustomer = Number(values.perCustomerLimit);
  if (!Number.isInteger(perCustomer) || perCustomer < 1 || perCustomer > 100) {
    errors.perCustomerLimit = 'A whole number from 1 to 100.';
  }

  for (const [key, label] of [
    ['cityId', 'city id'],
    ['categoryId', 'service category id'],
  ] as const) {
    const raw = values[key].trim();
    if (raw === '') continue;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors[key] = `Enter a whole ${label}, or leave blank for all.`;
    }
  }

  return errors;
}

function CouponForm({ coupon, onClose }: { coupon?: CouponRow; onClose: () => void }) {
  const isEdit = coupon !== undefined;
  const [values, setValues] = useState<FormValues>(() => initialValues(coupon));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useAdminMutation(
    (input: { create?: CreateCouponInput; update?: UpdateCouponInput }) =>
      input.create
        ? createCoupon(input.create)
        : updateCoupon(coupon?.id ?? '', input.update ?? {}),
    { invalidate: [['admin', 'coupons']], onDone: onClose },
  );

  const set = (name: keyof FormValues, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = () => {
    const found = validate(values, isEdit);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // Every conversion below has already been proved safe by `validate`, so the
    // `?? 0` fallbacks are unreachable — they exist to keep the types honest
    // without a non-null assertion.
    const valuePaise =
      values.discountType === 'percent'
        ? Number(values.value)
        : (parseRupeesToPaise(values.value) ?? 0);

    const maxDiscountPaise = parseRupeesToPaise(values.maxDiscountRupees) ?? 0;
    const minOrderPaise = parseRupeesToPaise(values.minOrderRupees || '0') ?? 0;
    const validFrom = toIsoInstant(values.validFrom) ?? '';
    const validUntil = toIsoInstant(values.validUntil) ?? '';
    const totalUsageLimit =
      values.totalUsageLimit.trim() === '' ? null : Number(values.totalUsageLimit);
    const cityId = values.cityId.trim() === '' ? null : Number(values.cityId);
    const categoryId = values.categoryId.trim() === '' ? null : Number(values.categoryId);

    if (isEdit) {
      /**
       * The full set of editable fields is sent every time, including explicit
       * nulls to clear a limit or a scope. The alternative — diffing against
       * the loaded row and sending only what changed — would silently drop a
       * "make this all-cities again" edit, because that edit *is* a null.
       *
       * `code` and `discountType` are absent: the API's `.strict()` schema
       * rejects them, deliberately.
       */
      save.mutate({
        update: {
          description: values.description.trim(),
          value: valuePaise,
          maxDiscountPaise,
          minOrderPaise,
          validFrom,
          validUntil,
          totalUsageLimit,
          perCustomerLimit: Number(values.perCustomerLimit),
          cityId,
          categoryId,
        },
      });
      return;
    }

    save.mutate({
      create: {
        code: values.code.trim(),
        description: values.description.trim(),
        discountType: values.discountType,
        value: valuePaise,
        maxDiscountPaise,
        minOrderPaise,
        validFrom,
        validUntil,
        // Create takes optionals, not nulls — `undefined` means "no limit" /
        // "every city" there, where the edit schema wants an explicit null.
        ...(totalUsageLimit === null ? {} : { totalUsageLimit }),
        perCustomerLimit: Number(values.perCustomerLimit),
        ...(cityId === null ? {} : { cityId }),
        ...(categoryId === null ? {} : { categoryId }),
      },
    });
  };

  const percent = values.discountType === 'percent';

  return (
    <Modal
      title={isEdit ? `Edit ${coupon.code}` : 'New coupon'}
      onClose={onClose}
      width="max-w-2xl"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-lg border border-admin/20 bg-admin-soft px-3 py-2 text-[13px] leading-relaxed text-admin-deep">
            This discount is paid by the platform out of its commission. The technician is still
            paid on the full pre-discount amount, and the code will only apply to bookings paid
            online.
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Code"
              hint={
                isEdit
                  ? 'A code is printed on posters and sent in messages, so it cannot be changed. A new code is a new coupon.'
                  : 'Stored uppercase. Letters, digits, dashes and underscores.'
              }
              error={errors.code ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={values.code}
                  disabled={isEdit}
                  placeholder="DIWALI50"
                  onChange={(event) => set('code', event.target.value.toUpperCase())}
                />
              )}
            </Field>

            <Field
              label="Discount type"
              hint={
                isEdit
                  ? 'Fixed after creation — changing it would reinterpret the value on a live campaign.'
                  : undefined
              }
              error={null}
            >
              {(id) => (
                <Select
                  id={id}
                  value={values.discountType}
                  disabled={isEdit}
                  onChange={(event) =>
                    set('discountType', event.target.value === 'flat' ? 'flat' : 'percent')
                  }
                >
                  <option value="percent">Percent off</option>
                  <option value="flat">Flat amount off</option>
                </Select>
              )}
            </Field>
          </div>

          <Field label="Description" error={errors.description ?? null}>
            {(id) => (
              <TextArea
                id={id}
                value={values.description}
                placeholder="Diwali 2026 — 50% off the first appliance repair"
                onChange={(event) => set('description', event.target.value)}
              />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={percent ? 'Percent off' : 'Flat discount in rupees'}
              hint={percent ? 'A whole number, 1 to 100.' : 'For example 250 or 250.50.'}
              error={errors.value ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={values.value}
                  placeholder={percent ? '20' : '250'}
                  onChange={(event) => set('value', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Maximum discount in rupees"
              hint="Required. The most this coupon can take off a single job — our ceiling on what one redemption costs."
              error={errors.maxDiscountRupees ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={values.maxDiscountRupees}
                  placeholder="500"
                  onChange={(event) => set('maxDiscountRupees', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Minimum order in rupees"
              hint="Zero for no minimum."
              error={errors.minOrderRupees ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={values.minOrderRupees}
                  placeholder="0"
                  onChange={(event) => set('minOrderRupees', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Uses per customer"
              hint="How many times one customer may redeem this code."
              error={errors.perCustomerLimit ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={values.perCustomerLimit}
                  onChange={(event) => set('perCustomerLimit', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Valid from"
              hint="Entered and shown in your own timezone."
              error={errors.validFrom ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="datetime-local"
                  value={values.validFrom}
                  onChange={(event) => set('validFrom', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Valid until"
              hint="The instant it stops working — the window is half-open."
              error={errors.validUntil ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="datetime-local"
                  value={values.validUntil}
                  onChange={(event) => set('validUntil', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Total redemptions"
              hint="Blank for no ceiling across all customers."
              error={errors.totalUsageLimit ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={values.totalUsageLimit}
                  placeholder="No limit"
                  onChange={(event) => set('totalUsageLimit', event.target.value)}
                />
              )}
            </Field>

            <Field label="City id" hint="Blank for every city." error={errors.cityId ?? null}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={values.cityId}
                  placeholder="All cities"
                  onChange={(event) => set('cityId', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Service category id"
              hint="Blank for every service."
              error={errors.categoryId ?? null}
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={values.categoryId}
                  placeholder="All services"
                  onChange={(event) => set('categoryId', event.target.value)}
                />
              )}
            </Field>
          </div>

          {/* The server's answer, verbatim — including the per-field details of
              a VALIDATION_ERROR and the request id, which is what makes a
              failure traceable to a log line. */}
          {save.error ? <ErrorState error={save.error} /> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create coupon'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
