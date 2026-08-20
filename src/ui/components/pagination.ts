import type { Collection } from 'dexie';

export interface PageResult<T> {
  rows: T[];
  total: number;
}

/**
 * Paginate a Dexie Collection using offset+limit. Dexie internally uses cursor
 * iteration and skips rows without materializing them into memory, so this
 * stays memory-safe for the 1M row targets in spec §40.
 *
 * Runs count() and the offset/limit fetch in parallel — one cursor scan for
 * the count and one for the fetch.
 */
export async function paginateCollection<T>(
  makeCollection: () => Collection<T, string>,
  offset: number,
  limit: number,
): Promise<PageResult<T>> {
  const [rows, total] = await Promise.all([
    makeCollection().offset(offset).limit(limit).toArray(),
    makeCollection().count(),
  ]);
  return { rows, total };
}

export function matchesText(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
