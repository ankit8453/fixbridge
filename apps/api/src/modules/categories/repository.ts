// All Prisma access for the categories domain.
import type { Category, PrismaClient } from '@prisma/client';

/** Active categories for a city, ordered so the service can build the tree in one pass. */
export function findActiveByCity(prisma: PrismaClient, cityId: number): Promise<Category[]> {
  return prisma.category.findMany({
    where: { cityId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

export function findById(prisma: PrismaClient, id: number): Promise<Category | null> {
  return prisma.category.findUnique({ where: { id } });
}

export function findManyByIds(prisma: PrismaClient, ids: number[]): Promise<Category[]> {
  return prisma.category.findMany({ where: { id: { in: ids } } });
}

export function findBySlug(
  prisma: PrismaClient,
  cityId: number,
  slug: string,
): Promise<Category | null> {
  return prisma.category.findUnique({ where: { cityId_slug: { cityId, slug } } });
}
