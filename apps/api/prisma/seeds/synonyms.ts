import type { PrismaClient } from '@prisma/client';
import { normalizeSearchTerm } from '../../src/modules/search/normalize';

/**
 * How people in Jabalpur actually describe a problem, in both scripts.
 *
 * Nobody types "motor rewinding". They type "motor jal gayi", or "मोटर जल गई",
 * or "moter jal gai" on a cracked screen. Every row here is a phrase somebody
 * would plausibly type, mapped to the service that fixes it.
 *
 * Weights break ties when one phrase points at more than one category: "bijli"
 * is vague and points at the cluster; "current nahi hai" is specific enough to
 * mean wiring.
 *
 * Terms are normalised through the same function the query path uses, so the
 * two can never drift apart.
 */
interface SynonymSeed {
  /** Category slug — resolved to an id at seed time. */
  slug: string;
  terms: string[];
  weight?: number;
}

export const SYNONYM_SEEDS: SynonymSeed[] = [
  /* ---- Electrical ---- */
  {
    slug: 'electrical',
    terms: ['bijli', 'बिजली', 'electric', 'बिजली का काम', 'light nahi aa rahi'],
  },
  {
    slug: 'house-wiring',
    terms: [
      'current nahi hai',
      'करंट नहीं आ रहा',
      'wiring',
      'वायरिंग',
      'short circuit',
      'ghar ki wiring',
    ],
    weight: 2,
  },
  {
    slug: 'switchboard-mcb',
    terms: ['switch board', 'स्विच बोर्ड', 'mcb gir gaya', 'एमसीबी', 'fuse ud gaya'],
    weight: 2,
  },
  {
    slug: 'earthing',
    terms: ['earthing', 'अर्थिंग', 'current lag raha hai', 'करंट लग रहा है'],
    weight: 2,
  },
  {
    slug: 'fan-geyser-motor-installation',
    terms: ['pankha', 'पंखा', 'fan lagwana', 'geyser', 'गीजर', 'geyser lagwana', 'पंखा लगवाना'],
    weight: 2,
  },
  {
    slug: 'inverter-ups',
    terms: ['inverter', 'इन्वर्टर', 'inverter battery', 'ups', 'inverter kharab', 'बैटरी'],
    weight: 2,
  },

  /* ---- Motors & Generators ---- */
  {
    slug: 'motor-rewinding',
    terms: [
      'motor jal gayi',
      'मोटर जल गई',
      'motor rewinding',
      'मोटर रीवाइंडिंग',
      'motor jal gaya',
      'motor band ho gayi',
    ],
    weight: 3,
  },
  {
    slug: 'pump-borewell-repair',
    terms: ['pump kharab', 'पंप खराब', 'borewell', 'बोरवेल', 'paani nahi aa raha', 'submersible'],
    weight: 2,
  },
  {
    slug: 'genset-servicing',
    terms: ['generator', 'जनरेटर', 'genset', 'generator service', 'dg set'],
    weight: 2,
  },
  {
    slug: 'stabilizers',
    terms: ['stabilizer', 'स्टेबलाइज़र', 'voltage problem'],
    weight: 2,
  },

  /* ---- Plumbing ---- */
  {
    slug: 'plumbing',
    terms: ['plumber', 'प्लंबर', 'plumbing', 'नल का काम'],
  },
  {
    slug: 'leakage-repair',
    terms: [
      'nal tapak raha',
      'नल टपक रहा है',
      'leakage',
      'लीकेज',
      'nal',
      'नल',
      'pani tapak raha hai',
      'pipe leak',
    ],
    weight: 3,
  },
  {
    slug: 'fittings-fixtures',
    terms: ['nal lagwana', 'basin fitting', 'बेसिन', 'toti badalna', 'टोंटी'],
    weight: 2,
  },
  {
    slug: 'tank-cleaning',
    terms: ['paani ki tanki', 'पानी की टंकी', 'tanki safai', 'टंकी की सफाई', 'tank cleaning'],
    weight: 3,
  },
  {
    slug: 'ro-service',
    terms: ['ro', 'आरओ', 'water purifier', 'ro service', 'पानी का फिल्टर'],
    weight: 2,
  },

  /* ---- Cooling & Appliances ---- */
  {
    slug: 'ac-service-gas-refill',
    terms: [
      'ac thanda nahi',
      'एसी ठंडा नहीं कर रहा',
      'gas bharna',
      'गैस भरना',
      'ac service',
      'एसी सर्विस',
      'ac repair',
    ],
    weight: 3,
  },
  {
    slug: 'fridge-repair',
    terms: ['fridge', 'फ्रिज', 'fridge thanda nahi', 'refrigerator'],
    weight: 2,
  },
  {
    slug: 'washing-machine-repair',
    terms: ['washing machine', 'वॉशिंग मशीन', 'machine kharab', 'kapde dhone wali machine'],
    weight: 2,
  },
  {
    slug: 'microwave-repair',
    terms: ['microwave', 'माइक्रोवेव', 'oven'],
    weight: 2,
  },

  /* ---- Mechanics ---- */
  {
    slug: 'two-wheeler-doorstep',
    terms: ['bike kharab', 'बाइक खराब', 'scooty', 'स्कूटी', 'bike service', 'दोपहिया', 'gaadi'],
    weight: 3,
  },
  {
    slug: 'car-battery-jumpstart',
    terms: ['car battery', 'कार बैटरी', 'gaadi start nahi ho rahi', 'jumpstart'],
    weight: 2,
  },
  {
    slug: 'cycle-repair',
    terms: ['cycle', 'साइकिल', 'cycle puncture'],
    weight: 2,
  },
];

export async function seedSynonyms(
  prisma: PrismaClient,
  categoryIdBySlug: Map<string, number>,
): Promise<number> {
  let count = 0;

  for (const seed of SYNONYM_SEEDS) {
    const categoryId = categoryIdBySlug.get(seed.slug);
    if (categoryId === undefined) {
      throw new Error(`synonym seed refers to unknown category: ${seed.slug}`);
    }

    for (const raw of seed.terms) {
      // Normalised here with exactly the function the query path uses.
      const term = normalizeSearchTerm(raw);
      if (term.length === 0) continue;

      await prisma.hinglishSynonym.upsert({
        where: { term_categoryId: { term, categoryId } },
        update: { weight: seed.weight ?? 1, isActive: true },
        create: { term, categoryId, weight: seed.weight ?? 1 },
      });

      count += 1;
    }
  }

  console.log(`synonyms ready: ${count} terms across ${SYNONYM_SEEDS.length} categories`);

  return count;
}
