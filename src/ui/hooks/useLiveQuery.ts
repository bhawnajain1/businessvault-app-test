import { useLiveQuery as dexieUseLiveQuery } from 'dexie-react-hooks';

export function useLiveQuery<T>(
  fn: () => T | Promise<T>,
  deps: unknown[] = [],
  defaultValue?: T,
): T | undefined {
  if (defaultValue !== undefined) {
    return dexieUseLiveQuery(fn, deps, defaultValue) as T;
  }
  return dexieUseLiveQuery(fn, deps) as T | undefined;
}
