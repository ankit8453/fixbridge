import { useState, type ReactNode } from 'react';
import { Wallet, Star, TrendingUp } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Pagination,
  QueryState,
  Select,
  Sheet,
  SkeletonText,
  Spinner,
  StatTile,
  StatusPill,
  Table,
  Tabs,
  TextArea,
  TextInput,
  useToast,
  type TableColumn,
  type Tone,
} from '../../components/ui';
import { ApiError } from '../../lib/api';

/**
 * `/design` — every primitive in every state, on one page.
 *
 * This is the foundation's own proof of work: nothing here is wired to the
 * real API (a couple of components use local component state to demonstrate
 * an interaction — the tabs, the pagination, the modal/sheet triggers), and
 * nothing on this page ships to an end user. It exists so the palette,
 * type scale and every hand-rolled control can be reviewed at a glance
 * before four other agents start building real screens on top of them, and
 * so a future regression ("did the Button loading state break?") is a
 * one-page visual check instead of a hunt through real app flows.
 */

const TONES: Tone[] = ['neutral', 'success', 'warning', 'danger', 'info'];

interface SampleRow {
  id: string;
  provider: string;
  category: string;
  amount: number;
  status: 'accepted' | 'in_progress' | 'done';
}

const SAMPLE_ROWS: SampleRow[] = [
  {
    id: 'BK-1042',
    provider: 'Ramesh Electricals',
    category: 'Electrician',
    amount: 45000,
    status: 'in_progress',
  },
  {
    id: 'BK-1041',
    provider: 'Suresh Plumbing',
    category: 'Plumber',
    amount: 12000,
    status: 'accepted',
  },
  {
    id: 'BK-1039',
    provider: 'City AC Repair',
    category: 'AC Repair',
    amount: 89000,
    status: 'done',
  },
];

const STATUS_TONE: Record<SampleRow['status'], Tone> = {
  accepted: 'info',
  in_progress: 'warning',
  done: 'success',
};

const columns: TableColumn<SampleRow>[] = [
  { key: 'id', header: 'Booking', render: (row) => row.id },
  { key: 'provider', header: 'Provider', render: (row) => row.provider },
  { key: 'category', header: 'Category', render: (row) => row.category, hideOnMobile: true },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    render: (row) => `₹${(row.amount / 100).toLocaleString('en-IN')}`,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <StatusPill tone={STATUS_TONE[row.status]}>{row.status.replace('_', ' ')}</StatusPill>
    ),
  },
];

export default function DesignSystemShowcase() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Design system</h1>
        <p className="mt-1 text-sm text-muted">
          Every primitive in `src/components/ui`, in every state. Not a real screen — see the file's
          own comment.
        </p>
      </header>

      <TypographySection />
      <ColorSection />
      <ButtonSection />
      <CardSection />
      <BadgeSection />
      <FieldSection />
      <TableSection />
      <PaginationSection />
      <TabsSection />
      <OverlaySection />
      <ToastSection />
      <LoadingSection />
      <AvatarSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-2 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function TypographySection() {
  return (
    <Section title="Typography">
      <div className="flex flex-col gap-3">
        <p className="text-2xl font-semibold text-slate-900">
          The quick brown fox — text-2xl semibold
        </p>
        <p className="text-lg font-semibold text-slate-900">
          The quick brown fox — text-lg semibold
        </p>
        <p className="text-base text-slate-900">
          The quick brown fox — text-base (body copy floor)
        </p>
        <p className="text-sm text-muted">The quick brown fox — text-sm muted</p>
        <p className="text-xs uppercase tracking-wide text-muted">
          Eyebrow label — text-xs uppercase
        </p>
        <div className="rounded-xl border border-border bg-slate-50 p-4" lang="hi">
          <p className="text-lg font-semibold text-slate-900">
            सत्यापित कारीगर, तय कीमत, भरोसे के साथ।
          </p>
          <p className="mt-1 text-base text-slate-700">
            अपने शहर में सत्यापित इलेक्ट्रीशियन, प्लंबर और अन्य कारीगर बुक करें — कीमत काम शुरू होने
            से पहले तय होती है।
          </p>
        </div>
      </div>
    </Section>
  );
}

function ColorSection() {
  const swatches: { label: string; className: string }[] = [
    { label: 'brand', className: 'bg-brand' },
    { label: 'brand-accent', className: 'bg-brand-accent' },
    { label: 'success', className: 'bg-success' },
    { label: 'warning', className: 'bg-warning' },
    { label: 'danger', className: 'bg-danger' },
    { label: 'muted', className: 'bg-muted' },
    { label: 'surface', className: 'bg-surface border border-border' },
    { label: 'border', className: 'bg-border' },
  ];

  return (
    <Section title="Colour tokens">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {swatches.map((swatch) => (
          <div key={swatch.label} className="flex flex-col gap-1.5">
            <div className={`h-12 rounded-lg ${swatch.className}`} />
            <span className="text-xs text-muted">{swatch.label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ButtonSection() {
  return (
    <Section title="Button">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="md">
            Medium
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" fullWidth className="max-w-xs">
            Full width
          </Button>
        </div>
      </div>
    </Section>
  );
}

function CardSection() {
  return (
    <Section title="Card, StatTile, DetailRow">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active bookings" value={12} delta={3} icon={TrendingUp} />
        <StatTile
          label="Wallet balance"
          value="₹4,250"
          delta={-2}
          hint="vs last week"
          icon={Wallet}
        />
        <StatTile label="Avg rating" value="4.7" icon={Star} />
      </div>
      <Card>
        <CardHeader
          title="Booking BK-1042"
          subtitle="Electrician · Ramesh Electricals"
          actions={<Badge tone="info">In progress</Badge>}
        />
        <div className="p-4">
          <DetailRow label="Customer">Anita Sharma</DetailRow>
          <DetailRow label="Address">12, Napier Town, Jabalpur</DetailRow>
          <DetailRow label="Amount">₹450</DetailRow>
        </div>
      </Card>
    </Section>
  );
}

function BadgeSection() {
  return (
    <Section title="Badge / StatusPill">
      <div className="flex flex-wrap gap-2">
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {TONES.map((tone) => (
          <StatusPill key={tone} tone={tone}>
            {tone}
          </StatusPill>
        ))}
      </div>
    </Section>
  );
}

function FieldSection() {
  const [value, setValue] = useState('');

  return (
    <Section title="Field, Input, Select, Textarea">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As it appears on your profile">
          {(id) => (
            <TextInput
              id={id}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Anita Sharma"
            />
          )}
        </Field>
        <Field label="Phone number" error="Enter a valid 10-digit number">
          {(id) => <TextInput id={id} defaultValue="98765" />}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} defaultValue="">
              <option value="" disabled>
                Choose a category
              </option>
              <option>Electrician</option>
              <option>Plumber</option>
            </Select>
          )}
        </Field>
        <Field label="Problem note" hint="Optional — helps the technician prepare">
          {(id) => <TextArea id={id} placeholder="Ceiling fan not working" />}
        </Field>
      </div>
    </Section>
  );
}

function TableSection() {
  return (
    <Section title="Table (responsive → cards on mobile)">
      <Table
        columns={columns}
        rows={SAMPLE_ROWS}
        rowKey={(row) => row.id}
        cardTitle={(row) => row.id}
      />
      <div>
        <p className="mb-2 text-sm text-muted">Empty state:</p>
        <Table
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          empty={{ title: 'No bookings yet' }}
        />
      </div>
    </Section>
  );
}

function PaginationSection() {
  const [page, setPage] = useState(1);
  return (
    <Section title="Pagination">
      <Pagination page={page} pageSize={10} total={42} onChange={setPage} />
    </Section>
  );
}

function TabsSection() {
  const [value, setValue] = useState('active');
  return (
    <Section title="Tabs">
      <Tabs
        value={value}
        onChange={setValue}
        tabs={[
          { value: 'active', label: 'Active', badge: 3 },
          { value: 'past', label: 'Past' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      <p className="text-sm text-muted">Selected: {value}</p>
    </Section>
  );
}

function OverlaySection() {
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <Section title="Modal, Sheet">
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          Open modal
        </Button>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
      </div>
      {modalOpen ? (
        <Modal title="Cancel booking" onClose={() => setModalOpen(false)}>
          <div className="flex flex-col gap-4 p-4">
            <p className="text-sm text-slate-700">
              Centred on desktop, a bottom sheet on a phone-width screen.
            </p>
            <Button variant="danger" onClick={() => setModalOpen(false)}>
              Confirm
            </Button>
          </div>
        </Modal>
      ) : null}
      <Sheet open={sheetOpen} title="Cash collected?" onClose={() => setSheetOpen(false)}>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-slate-700">Always a bottom sheet, on every breakpoint.</p>
          <Button variant="primary" fullWidth onClick={() => setSheetOpen(false)}>
            Confirm ₹450 collected
          </Button>
        </div>
      </Sheet>
    </Section>
  );
}

function ToastSection() {
  const toast = useToast();

  return (
    <Section title="Toast">
      <div className="flex flex-wrap gap-3">
        {TONES.map((tone) => (
          <Button
            key={tone}
            variant="secondary"
            size="sm"
            onClick={() =>
              toast.show({ title: `${tone} toast`, description: 'Auto-dismisses in 5s.', tone })
            }
          >
            Show {tone}
          </Button>
        ))}
      </div>
    </Section>
  );
}

function LoadingSection() {
  return (
    <Section title="Skeleton, Spinner, EmptyState, ErrorState">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Skeleton">
          <SkeletonText lines={3} />
        </Card>
        <Card title="Spinner">
          <Spinner label="Loading bookings…" />
        </Card>
        <Card title="EmptyState">
          <EmptyState
            title="No bookings yet"
            hint="Once you book a technician, it shows up here."
          />
        </Card>
        <Card title="ErrorState">
          <ErrorState
            error={
              new ApiError(500, 'INTERNAL', 'Something went wrong on our end.', 'req-demo-123')
            }
            onRetry={() => undefined}
          />
        </Card>
      </div>
      <Card title="QueryState (pending / error / success)">
        <div className="flex flex-col gap-4">
          <QueryState status="pending" error={null} data={undefined}>
            {() => null}
          </QueryState>
          <QueryState
            status="success"
            error={null}
            data={SAMPLE_ROWS}
            empty={{ title: 'No rows' }}
            isEmpty={(rows) => rows.length === 0}
          >
            {(rows) => <p className="text-sm text-slate-700">{rows.length} rows loaded.</p>}
          </QueryState>
        </div>
      </Card>
    </Section>
  );
}

function AvatarSection() {
  return (
    <Section title="Avatar">
      <div className="flex items-center gap-3">
        <Avatar name="Anita Sharma" size={32} />
        <Avatar name="Ramesh Kumar" size={48} />
        <Avatar name={null} size={40} />
      </div>
    </Section>
  );
}
