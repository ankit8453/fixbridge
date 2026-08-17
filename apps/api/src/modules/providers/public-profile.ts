import type { PrismaClient } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { Badge } from '../verification/badge';
import { formatPaise } from '../search/service';

/**
 * One technician's public profile, for somebody who arrived without searching.
 *
 * ## Why this exists
 *
 * Until Phase 12 the only way to see a technician was to find them: every field
 * a customer reads came back on a search result card. That was fine for an app
 * where browsing is the only entry point, and wrong the moment there is a URL —
 * the pilot's whole distribution story is a link forwarded on WhatsApp, and the
 * page it lands on has to stand up on its own. A profile that renders blanks
 * because the visitor did not run a search first is the worst possible first
 * impression of a marketplace selling trust.
 *
 * ## What it deliberately does not return
 *
 * The Phase 5 rules hold here exactly as they do in search, and for the same
 * reasons — this endpoint is public and unauthenticated, so it is the easiest
 * thing in the system to scrape:
 *
 *   - **No coordinates.** The city, never a point — and not even search's
 *     "locality", which is really a distance band from the caller and so has no
 *     meaning on a page nobody searched to reach.
 *   - **No phone number.** Unmasking happens on an accepted booking, nowhere else.
 *   - **No completeness internals.** How close somebody is to being listed is
 *     between them and us.
 *   - **Nobody who is not listed, verified and unsuspended.** The same four gates
 *     search applies, because a profile page that renders someone search refuses
 *     to show would be a way around the gates.
 */

export interface PublicProviderProfile {
  providerId: string;
  displayName: string | null;
  badge: Badge;
  bio: string | null;
  yearsExperience: number | null;
  /**
   * The city, and nothing finer.
   *
   * Search shows a 'locality' that is really a distance band from the caller —
   * meaningless here, because a public profile has no caller to be near. The
   * city is the honest answer at this granularity, and a real locality needs a
   * real geocoder (see the note in search/service.ts).
   */
  city: { id: number; name: string } | null;
  rating: { average: number; count: number } | null;
  jobsCompleted: number;
  /** What people said about them most, as counts. Phase 9's tag aggregate. */
  tagCounts: Record<string, number>;
  skills: { categoryId: number; nameKey: string; slug: string }[];
  priceCards: {
    id: string;
    categoryId: number;
    title: string;
    priceType: string;
    amountPaise: number | null;
    display: string | null;
  }[];
  memberSince: string;
}

/**
 * The gates, expressed once.
 *
 * Identical in meaning to the four in `search/repository.ts`. They are repeated
 * rather than shared because that query is a hand-written PostGIS statement and
 * this is a Prisma read — the honest options were a duplicated predicate or a
 * contrived abstraction over two very different queries, and there is a test
 * asserting the two agree on the seeded dataset.
 */
export async function findPublicProfile(
  prisma: PrismaClient,
  providerId: string,
): Promise<PublicProviderProfile | null> {
  const profile = await prisma.providerProfile.findFirst({
    where: {
      userId: providerId,
      isListed: true,
      user: { status: 'active' },
      verification: { badge: { in: ['VERIFIED', 'SILVER', 'GOLD'] } },
      OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
    },
    select: {
      userId: true,
      displayName: true,
      bio: true,
      yearsExperience: true,
      city: { select: { id: true, name: true } },
      createdAt: true,
      verification: { select: { badge: true } },
      stats: {
        select: { avgStars: true, reviewCount: true, settledJobsCount: true, tagCounts: true },
      },
      skills: {
        select: { category: { select: { id: true, nameKey: true, slug: true } } },
      },
      priceCards: {
        where: { isActive: true },
        select: {
          id: true,
          categoryId: true,
          title: true,
          priceType: true,
          amountPaise: true,
        },
        orderBy: { amountPaise: 'asc' },
      },
    },
  });

  if (!profile) return null;

  const stats = profile.stats;

  return {
    providerId: profile.userId,
    displayName: profile.displayName,
    badge: (profile.verification?.badge ?? 'NONE') as Badge,
    bio: profile.bio,
    yearsExperience: profile.yearsExperience,
    city: profile.city ? { id: profile.city.id, name: profile.city.name } : null,
    // Null until somebody has actually rated them — never a fabricated default,
    // exactly as the search card does it.
    rating:
      stats?.avgStars === null || stats?.avgStars === undefined
        ? null
        : { average: stats.avgStars, count: stats.reviewCount },
    jobsCompleted: stats?.settledJobsCount ?? 0,
    tagCounts: (stats?.tagCounts as Record<string, number> | null) ?? {},
    skills: profile.skills.map((skill) => ({
      categoryId: skill.category.id,
      nameKey: skill.category.nameKey,
      slug: skill.category.slug,
    })),
    priceCards: profile.priceCards.map((card) => ({
      id: card.id,
      categoryId: card.categoryId,
      title: card.title,
      priceType: card.priceType,
      amountPaise: card.amountPaise,
      display: card.amountPaise === null ? null : formatPaise(card.amountPaise),
    })),
    memberSince: profile.createdAt.toISOString(),
  };
}

export async function getPublicProfile(
  context: AppContext,
  providerId: string,
): Promise<PublicProviderProfile> {
  const profile = await findPublicProfile(context.prisma, providerId);

  if (!profile) {
    /**
     * 404 for "does not exist", "not listed" and "suspended" alike.
     *
     * Distinguishing them would turn this endpoint into an oracle: anybody could
     * discover that a particular technician had been suspended, which is a fact
     * about a person's livelihood that strangers have no business learning from
     * an HTTP status code.
     */
    throw new AppError(404, 'PROVIDER_NOT_FOUND', `No public profile for ${providerId}`, {
      messageKey: 'errors.providers.profileNotFound',
    });
  }

  return profile;
}
