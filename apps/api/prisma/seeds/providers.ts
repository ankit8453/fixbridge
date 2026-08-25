import type { PriceType, PrismaClient } from '@prisma/client';
import { computeCompleteness, isListable } from '../../src/modules/providers/completeness';
import { deterministicUuid } from './deterministic-id';
import { localityByName } from './localities';

/* -------------------------------------------------------------------------- */
/* Availability patterns                                                      */
/* -------------------------------------------------------------------------- */

interface Window {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

const daily = (days: number[], from: number, to: number): Window[] =>
  days.map((dayOfWeek) => ({ dayOfWeek, startMinute: from, endMinute: to }));

/**
 * The supply mix this marketplace is built for: full-timers who work shop hours
 * and part-timers with a day job who take evening and Sunday work.
 */
const AVAILABILITY_PATTERNS = {
  /** Mon–Sat, 09:00–19:00. */
  fullTime: daily([1, 2, 3, 4, 5, 6], at(9), at(19)),
  /** Every day, 08:00–20:00. */
  allWeek: daily([0, 1, 2, 3, 4, 5, 6], at(8), at(20)),
  /** Weekday evenings after a day job, plus all of Sunday. */
  weekdayEvenings: [...daily([1, 2, 3, 4, 5], at(18), at(22)), ...daily([0], at(9), at(18))],
  /** Morning and evening shifts with the afternoon off. */
  splitShift: [
    ...daily([1, 2, 3, 4, 5, 6], at(8), at(12)),
    ...daily([1, 2, 3, 4, 5, 6], at(16), at(20)),
  ],
  /** Saturday and Sunday only. */
  weekendOnly: daily([0, 6], at(9), at(19)),
  none: [] as Window[],
} satisfies Record<string, Window[]>;

type AvailabilityPattern = keyof typeof AVAILABILITY_PATTERNS;

/* -------------------------------------------------------------------------- */
/* The 20 technicians                                                         */
/* -------------------------------------------------------------------------- */

interface PriceCardSeed {
  categorySlug: string;
  title: string;
  priceType: PriceType;
  amountPaise: number | null;
}

interface ProviderSeed {
  phone: string;
  displayName: string;
  locality: string;
  yearsExperience: number | null;
  serviceRadiusKm: number;
  skills: string[];
  priceCards: PriceCardSeed[];
  availability: AvailabilityPattern;
  withPhoto: boolean;
  withLocation: boolean;
}

/** ₹ → paise, so no float ever reaches the database. */
const rupees = (amount: number): number => amount * 100;

/**
 * 17 complete (and therefore listed) + 3 deliberately incomplete. Phase 5's
 * search tests depend on that split, and each incomplete one is missing a
 * *different* required item so the gating can be tested from three angles.
 */
export const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    phone: '+919000000001',
    displayName: 'Ramesh Vishwakarma',
    locality: 'Wright Town',
    yearsExperience: 18,
    serviceRadiusKm: 8,
    skills: ['house-wiring', 'switchboard-mcb', 'earthing'],
    priceCards: [
      {
        categorySlug: 'house-wiring',
        title: 'House wiring per point',
        priceType: 'fixed',
        amountPaise: rupees(180),
      },
      {
        categorySlug: 'switchboard-mcb',
        title: 'Switchboard replacement',
        priceType: 'starting_from',
        amountPaise: rupees(450),
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000002',
    displayName: 'Sunil Kushwaha',
    locality: 'Napier Town',
    yearsExperience: 7,
    serviceRadiusKm: 5,
    skills: ['inverter-ups', 'stabilizers'],
    priceCards: [
      {
        categorySlug: 'inverter-ups',
        title: 'Inverter installation',
        priceType: 'fixed',
        amountPaise: rupees(600),
      },
      {
        categorySlug: 'stabilizers',
        title: 'Stabilizer check-up',
        priceType: 'starting_from',
        amountPaise: rupees(250),
      },
    ],
    availability: 'weekdayEvenings',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000003',
    displayName: 'Imran Ansari',
    locality: 'Adhartal',
    yearsExperience: 25,
    serviceRadiusKm: 15,
    skills: ['motor-rewinding', 'pump-borewell-repair'],
    priceCards: [
      {
        categorySlug: 'motor-rewinding',
        title: 'Single-phase motor rewinding',
        priceType: 'starting_from',
        amountPaise: rupees(1200),
      },
      {
        categorySlug: 'pump-borewell-repair',
        title: 'Borewell pump inspection',
        priceType: 'inspection_based',
        amountPaise: null,
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000004',
    displayName: 'Deepak Patel',
    locality: 'Vijay Nagar',
    yearsExperience: 12,
    serviceRadiusKm: 10,
    skills: ['genset-servicing', 'motor-rewinding'],
    priceCards: [
      {
        categorySlug: 'genset-servicing',
        title: 'Genset routine service',
        priceType: 'fixed',
        amountPaise: rupees(1500),
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000005',
    displayName: 'Mohd Faiz Khan',
    locality: 'Madan Mahal',
    yearsExperience: 4,
    serviceRadiusKm: 4,
    skills: ['leakage-repair', 'fittings-fixtures'],
    priceCards: [
      {
        categorySlug: 'leakage-repair',
        title: 'Tap and pipe leakage',
        priceType: 'starting_from',
        amountPaise: rupees(200),
      },
      {
        categorySlug: 'fittings-fixtures',
        title: 'Basin or sink fitting',
        priceType: 'fixed',
        amountPaise: rupees(400),
      },
    ],
    availability: 'weekdayEvenings',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000006',
    displayName: 'Santosh Yadav',
    locality: 'Gorakhpur',
    yearsExperience: 9,
    serviceRadiusKm: 7,
    skills: ['tank-cleaning', 'ro-service'],
    priceCards: [
      {
        categorySlug: 'tank-cleaning',
        title: '500–1000 litre tank cleaning',
        priceType: 'fixed',
        amountPaise: rupees(700),
      },
      {
        categorySlug: 'ro-service',
        title: 'RO filter change',
        priceType: 'starting_from',
        amountPaise: rupees(350),
      },
    ],
    availability: 'splitShift',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000007',
    displayName: 'Arvind Chaurasia',
    locality: 'Ranjhi',
    yearsExperience: 15,
    serviceRadiusKm: 12,
    skills: ['ac-service-gas-refill', 'fridge-repair'],
    priceCards: [
      {
        categorySlug: 'ac-service-gas-refill',
        title: 'Split AC service',
        priceType: 'fixed',
        amountPaise: rupees(550),
      },
      {
        categorySlug: 'ac-service-gas-refill',
        title: 'Gas refill',
        priceType: 'starting_from',
        amountPaise: rupees(1800),
      },
      {
        categorySlug: 'fridge-repair',
        title: 'Fridge diagnosis',
        priceType: 'inspection_based',
        amountPaise: null,
      },
    ],
    availability: 'allWeek',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000008',
    displayName: 'Pooja Sahu',
    locality: 'Garha',
    yearsExperience: 6,
    serviceRadiusKm: 6,
    skills: ['washing-machine-repair', 'microwave-repair'],
    priceCards: [
      {
        categorySlug: 'washing-machine-repair',
        title: 'Washing machine service',
        priceType: 'fixed',
        amountPaise: rupees(500),
      },
      {
        categorySlug: 'microwave-repair',
        title: 'Microwave repair',
        priceType: 'inspection_based',
        amountPaise: null,
      },
    ],
    availability: 'weekdayEvenings',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000009',
    displayName: 'Rakesh Tiwari',
    locality: 'Civil Lines',
    yearsExperience: 20,
    serviceRadiusKm: 10,
    skills: ['two-wheeler-doorstep', 'car-battery-jumpstart'],
    priceCards: [
      {
        categorySlug: 'two-wheeler-doorstep',
        title: 'Bike doorstep service',
        priceType: 'fixed',
        amountPaise: rupees(450),
      },
      {
        categorySlug: 'car-battery-jumpstart',
        title: 'Battery jumpstart',
        priceType: 'fixed',
        amountPaise: rupees(300),
      },
    ],
    availability: 'allWeek',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000010',
    displayName: 'Golu Rajak',
    locality: 'Sadar',
    yearsExperience: 3,
    serviceRadiusKm: 3,
    skills: ['cycle-repair'],
    priceCards: [
      {
        categorySlug: 'cycle-repair',
        title: 'Cycle full service',
        priceType: 'fixed',
        amountPaise: rupees(150),
      },
    ],
    availability: 'weekendOnly',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000011',
    displayName: 'Naveen Soni',
    locality: 'Wright Town',
    yearsExperience: 11,
    serviceRadiusKm: 9,
    skills: ['fan-geyser-motor-installation', 'house-wiring'],
    priceCards: [
      {
        categorySlug: 'fan-geyser-motor-installation',
        title: 'Ceiling fan installation',
        priceType: 'fixed',
        amountPaise: rupees(250),
      },
      {
        categorySlug: 'fan-geyser-motor-installation',
        title: 'Geyser installation',
        priceType: 'fixed',
        amountPaise: rupees(500),
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000012',
    displayName: 'Shabana Bano',
    locality: 'Napier Town',
    yearsExperience: 5,
    serviceRadiusKm: 5,
    skills: ['ro-service', 'microwave-repair'],
    priceCards: [
      {
        categorySlug: 'ro-service',
        title: 'RO annual maintenance',
        priceType: 'starting_from',
        amountPaise: rupees(1200),
      },
    ],
    availability: 'weekdayEvenings',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000013',
    displayName: 'Jitendra Lodhi',
    locality: 'Adhartal',
    yearsExperience: 14,
    serviceRadiusKm: 13,
    skills: ['pump-borewell-repair', 'stabilizers', 'earthing'],
    priceCards: [
      {
        categorySlug: 'pump-borewell-repair',
        title: 'Submersible pump repair',
        priceType: 'inspection_based',
        amountPaise: null,
      },
      {
        categorySlug: 'earthing',
        title: 'Earthing pit installation',
        priceType: 'starting_from',
        amountPaise: rupees(2500),
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000014',
    displayName: 'Anil Barman',
    locality: 'Vijay Nagar',
    yearsExperience: 8,
    serviceRadiusKm: 7,
    skills: ['leakage-repair', 'tank-cleaning'],
    priceCards: [
      {
        categorySlug: 'leakage-repair',
        title: 'Bathroom leakage repair',
        priceType: 'starting_from',
        amountPaise: rupees(350),
      },
    ],
    availability: 'splitShift',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000015',
    displayName: 'Vikas Namdeo',
    locality: 'Madan Mahal',
    yearsExperience: 2,
    serviceRadiusKm: 4,
    skills: ['two-wheeler-doorstep'],
    priceCards: [
      {
        categorySlug: 'two-wheeler-doorstep',
        title: 'Scooter oil change',
        priceType: 'fixed',
        amountPaise: rupees(300),
      },
    ],
    availability: 'weekdayEvenings',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000016',
    displayName: 'Harish Gupta',
    locality: 'Gorakhpur',
    yearsExperience: 22,
    serviceRadiusKm: 14,
    skills: ['ac-service-gas-refill', 'genset-servicing', 'motor-rewinding'],
    priceCards: [
      {
        categorySlug: 'ac-service-gas-refill',
        title: 'Window AC service',
        priceType: 'fixed',
        amountPaise: rupees(450),
      },
      {
        categorySlug: 'genset-servicing',
        title: 'Genset overhaul',
        priceType: 'inspection_based',
        amountPaise: null,
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    phone: '+919000000017',
    displayName: 'Praveen Kori',
    locality: 'Ranjhi',
    yearsExperience: 10,
    serviceRadiusKm: 11,
    skills: ['switchboard-mcb', 'inverter-ups', 'fan-geyser-motor-installation'],
    priceCards: [
      {
        categorySlug: 'switchboard-mcb',
        title: 'MCB replacement',
        priceType: 'fixed',
        amountPaise: rupees(350),
      },
      {
        categorySlug: 'inverter-ups',
        title: 'Battery replacement',
        priceType: 'starting_from',
        amountPaise: rupees(900),
      },
    ],
    availability: 'allWeek',
    withPhoto: true,
    withLocation: true,
  },

  /* ---- deliberately incomplete: each missing one different required item ---- */

  {
    // Missing availability → 79, below the 80 threshold.
    phone: '+919000000018',
    displayName: 'Suresh Bind',
    locality: 'Garha',
    yearsExperience: 6,
    serviceRadiusKm: 5,
    skills: ['fittings-fixtures'],
    priceCards: [
      {
        categorySlug: 'fittings-fixtures',
        title: 'Tap fitting',
        priceType: 'fixed',
        amountPaise: rupees(200),
      },
    ],
    availability: 'none',
    withPhoto: true,
    withLocation: true,
  },
  {
    // Missing any price card → 79.
    phone: '+919000000019',
    displayName: 'Manoj Ahirwar',
    locality: 'Civil Lines',
    yearsExperience: 13,
    serviceRadiusKm: 8,
    skills: ['fridge-repair', 'washing-machine-repair'],
    priceCards: [],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: true,
  },
  {
    // Missing a base location → 79, and unfindable by any geo query anyway.
    phone: '+919000000020',
    displayName: 'Bharat Singh Thakur',
    locality: 'Sadar',
    yearsExperience: 16,
    serviceRadiusKm: 9,
    skills: ['earthing', 'house-wiring'],
    priceCards: [
      {
        categorySlug: 'earthing',
        title: 'Earthing check',
        priceType: 'starting_from',
        amountPaise: rupees(400),
      },
    ],
    availability: 'fullTime',
    withPhoto: true,
    withLocation: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

export interface ProviderSeedSummary {
  total: number;
  listed: number;
  unlisted: number;
}

export async function seedProviders(
  prisma: PrismaClient,
  cityId: number,
  categoryIdBySlug: Map<string, number>,
  listingThreshold: number,
): Promise<ProviderSeedSummary> {
  let listed = 0;

  for (const seed of PROVIDER_SEEDS) {
    const locality = localityByName(seed.locality);

    const user = await prisma.user.upsert({
      where: { phone: seed.phone },
      update: {},
      create: { phone: seed.phone, name: seed.displayName, defaultCityId: cityId },
    });

    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: 'technician' } },
      update: {},
      create: { userId: user.id, role: 'technician' },
    });

    await prisma.providerProfile.upsert({
      where: { userId: user.id },
      update: {
        displayName: seed.displayName,
        yearsExperience: seed.yearsExperience,
        cityId,
        serviceRadiusKm: seed.serviceRadiusKm,
      },
      create: {
        userId: user.id,
        displayName: seed.displayName,
        yearsExperience: seed.yearsExperience,
        cityId,
        serviceRadiusKm: seed.serviceRadiusKm,
      },
    });

    // Plain doubles now, so an ordinary Prisma update does it. This used to be
    // a raw statement only because the column was a PostGIS geography that
    // Prisma could not write.
    if (seed.withLocation) {
      await prisma.providerProfile.update({
        where: { userId: user.id },
        data: { baseLat: locality.lat, baseLng: locality.lng },
      });
    }

    for (const slug of seed.skills) {
      const categoryId = categoryIdBySlug.get(slug);
      if (categoryId === undefined) throw new Error(`seed refers to unknown category: ${slug}`);

      await prisma.providerSkill.upsert({
        where: { providerId_categoryId: { providerId: user.id, categoryId } },
        update: {},
        create: { providerId: user.id, categoryId },
      });
    }

    // Deterministic ids keep these upsertable, so a rerun neither duplicates
    // rows nor churns primary keys.
    for (const [index, card] of seed.priceCards.entries()) {
      const categoryId = categoryIdBySlug.get(card.categorySlug);
      if (categoryId === undefined) {
        throw new Error(`seed refers to unknown category: ${card.categorySlug}`);
      }

      const id = deterministicUuid(`price-card:${seed.phone}:${index}`);

      await prisma.providerPriceCard.upsert({
        where: { id },
        update: { title: card.title, priceType: card.priceType, amountPaise: card.amountPaise },
        create: {
          id,
          providerId: user.id,
          categoryId,
          title: card.title,
          priceType: card.priceType,
          amountPaise: card.amountPaise,
        },
      });
    }

    for (const [index, window] of AVAILABILITY_PATTERNS[seed.availability].entries()) {
      const id = deterministicUuid(`availability:${seed.phone}:${index}`);

      await prisma.providerAvailabilityTemplate.upsert({
        where: { id },
        update: { ...window, isActive: true },
        create: { id, providerId: user.id, ...window, isActive: true },
      });
    }

    if (seed.withPhoto) {
      const id = deterministicUuid(`document:${seed.phone}:photo`);

      // Seeded documents are marked uploaded without an object behind them:
      // these are fixtures for local development, not real KYC material. The
      // ops case-detail endpoint will still issue a signed URL, which simply
      // 404s at storage — correct, and better than pretending otherwise.
      await prisma.providerDocument.upsert({
        where: { id },
        update: {},
        create: {
          id,
          providerId: user.id,
          docType: 'photo',
          storageKey: `seed/providers/${user.id}/photo.jpg`,
          status: 'uploaded',
          contentType: 'image/jpeg',
          sizeBytes: 128_000,
          uploadedAt: new Date(),
        },
      });
    }

    // Scored with the same pure functions the API uses, so seeded profiles and
    // API-built profiles can never disagree about what "complete" means.
    const completeness = computeCompleteness({
      hasDisplayName: true,
      hasBaseLocation: seed.withLocation,
      hasSkill: seed.skills.length > 0,
      hasActivePriceCard: seed.priceCards.length > 0,
      hasActiveAvailability: AVAILABILITY_PATTERNS[seed.availability].length > 0,
      hasBio: false,
      hasYearsExperience: seed.yearsExperience !== null,
      hasPhotoDocument: seed.withPhoto,
    });

    const isListed = isListable(completeness, listingThreshold, true);
    if (isListed) listed += 1;

    await prisma.providerProfile.update({
      where: { userId: user.id },
      data: { completenessScore: completeness.score, isListed },
    });
  }

  const total = PROVIDER_SEEDS.length;
  console.log(
    `providers ready: ${total} technicians (${listed} listed, ${total - listed} unlisted)`,
  );

  return { total, listed, unlisted: total - listed };
}
