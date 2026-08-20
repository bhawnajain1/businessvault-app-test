import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { __resetPokeChannelForTests } from '../sync/pokeChannel';

// Poke listeners are module-level. If a test throws before its worker's
// stop() runs, the listener leaks into the next test — and because the
// sync_events creating-hook now fires the poke synchronously on tx commit,
// a bulkAdd in the next test re-enters the stale listener.
afterEach(() => {
  __resetPokeChannelForTests();
});
