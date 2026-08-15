import type { Category } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../core/i18n';
import { buildCategoryTree, isLeaf } from './service';

const t = createTranslator('en');

let nextId = 1;
function category(overrides: Partial<Category> = {}): Category {
  return {
    id: nextId++,
    cityId: 1,
    parentId: null,
    nameKey: 'categories.electrical',
    slug: `slug-${nextId}`,
    icon: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Category;
}

describe('buildCategoryTree', () => {
  it('returns nothing for no rows', () => {
    expect(buildCategoryTree([], t)).toEqual([]);
  });

  it('nests services under their cluster', () => {
    const cluster = category({ id: 1, slug: 'electrical', nameKey: 'categories.electrical' });
    const child = category({
      id: 2,
      parentId: 1,
      slug: 'earthing',
      nameKey: 'categories.earthing',
    });

    const tree = buildCategoryTree([cluster, child], t);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.slug).toBe('electrical');
    expect(tree[0]?.children.map((node) => node.slug)).toEqual(['earthing']);
  });

  it('localises names through i18n and echoes the key', () => {
    const cluster = category({ id: 1, nameKey: 'categories.plumbing', slug: 'plumbing' });

    const [node] = buildCategoryTree([cluster], t);

    expect(node?.name).toBe('Plumbing');
    expect(node?.nameKey).toBe('categories.plumbing');
  });

  it('renders the same rows in Hindi', () => {
    const cluster = category({ id: 1, nameKey: 'categories.plumbing', slug: 'plumbing' });

    const [node] = buildCategoryTree([cluster], createTranslator('hi'));

    expect(node?.name).toBe('प्लंबिंग');
  });

  it('preserves the order it was given, for both roots and children', () => {
    const rows = [
      category({ id: 1, slug: 'a', sortOrder: 1 }),
      category({ id: 2, slug: 'b', sortOrder: 2 }),
      category({ id: 3, parentId: 1, slug: 'a1', sortOrder: 1 }),
      category({ id: 4, parentId: 1, slug: 'a2', sortOrder: 2 }),
    ];

    const tree = buildCategoryTree(rows, t);

    expect(tree.map((node) => node.slug)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((node) => node.slug)).toEqual(['a1', 'a2']);
  });

  it('gives leaves an empty children array rather than omitting the key', () => {
    const rows = [category({ id: 1, slug: 'a' }), category({ id: 2, parentId: 1, slug: 'a1' })];

    expect(buildCategoryTree(rows, t)[0]?.children[0]?.children).toEqual([]);
  });

  /**
   * Deactivating a cluster must hide everything under it. Since the query only
   * returns active rows, the orphaned children must be dropped — promoting them
   * to roots would leak a category that was deliberately switched off.
   */
  it('drops orphans instead of promoting them to roots', () => {
    const orphan = category({ id: 5, parentId: 99, slug: 'orphan' });

    expect(buildCategoryTree([orphan], t)).toEqual([]);
  });

  it('keeps sibling clusters independent', () => {
    const rows = [
      category({ id: 1, slug: 'electrical' }),
      category({ id: 2, slug: 'plumbing' }),
      category({ id: 3, parentId: 1, slug: 'earthing' }),
      category({ id: 4, parentId: 2, slug: 'leakage' }),
    ];

    const tree = buildCategoryTree(rows, t);

    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[1]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.slug).toBe('earthing');
  });
});

describe('isLeaf', () => {
  it('treats a row with a parent as a service and one without as a cluster', () => {
    expect(isLeaf(category({ parentId: 1 }))).toBe(true);
    expect(isLeaf(category({ parentId: null }))).toBe(false);
  });
});
