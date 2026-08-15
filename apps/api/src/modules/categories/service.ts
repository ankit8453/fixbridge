import type { Category } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { Translator } from '../../core/i18n';
import { findActiveByCity, findById } from './repository';
import type { CategoryNode, CategoryTreeResponse } from './types';

/**
 * Builds the two-level tree from a flat, pre-sorted row set.
 *
 * A row whose parent is missing from the set — inactive parent, or a parent in
 * another city — is dropped rather than promoted to a root, so deactivating a
 * cluster hides everything beneath it without touching the children.
 */
export function buildCategoryTree(rows: Category[], t: Translator): CategoryNode[] {
  const toNode = (row: Category): CategoryNode => ({
    id: row.id,
    slug: row.slug,
    name: t(row.nameKey),
    nameKey: row.nameKey,
    icon: row.icon,
    sortOrder: row.sortOrder,
    children: [],
  });

  const roots: CategoryNode[] = [];
  const byId = new Map<number, CategoryNode>();

  for (const row of rows) {
    if (row.parentId === null) {
      const node = toNode(row);
      byId.set(row.id, node);
      roots.push(node);
    }
  }

  for (const row of rows) {
    if (row.parentId === null) continue;
    byId.get(row.parentId)?.children.push(toNode(row));
  }

  return roots;
}

export async function getCategoryTree(
  context: AppContext,
  t: Translator,
  cityId: number | undefined,
): Promise<CategoryTreeResponse> {
  const resolvedCityId = cityId ?? context.config.DEFAULT_CITY_ID;
  const rows = await findActiveByCity(context.prisma, resolvedCityId);

  return { cityId: resolvedCityId, categories: buildCategoryTree(rows, t) };
}

/** True for a service (leaf), false for a cluster (root). */
export function isLeaf(category: Category): boolean {
  return category.parentId !== null;
}

/**
 * Resolves a category id for provider skills and price cards, rejecting anything
 * that would attach a technician to a cluster ("Electrical") rather than a
 * service ("Motor rewinding").
 */
export async function requireLeafCategory(
  context: AppContext,
  categoryId: number,
  cityId: number,
): Promise<Category> {
  const category = await findById(context.prisma, categoryId);

  if (!category || !category.isActive) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', `Category ${categoryId} not found or inactive`, {
      messageKey: 'errors.categories.notFound',
      details: { categoryId },
    });
  }

  if (category.cityId !== cityId) {
    throw new AppError(
      400,
      'CATEGORY_WRONG_CITY',
      `Category ${categoryId} belongs to city ${category.cityId}, not ${cityId}`,
      { messageKey: 'errors.categories.wrongCity', details: { categoryId, cityId } },
    );
  }

  if (!isLeaf(category)) {
    throw new AppError(
      400,
      'CATEGORY_NOT_A_SERVICE',
      `Category ${categoryId} is a cluster; pick one of its services`,
      { messageKey: 'errors.categories.clusterNotAllowed', details: { categoryId } },
    );
  }

  return category;
}
