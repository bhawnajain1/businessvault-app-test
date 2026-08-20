// Poke channel — kept in its own module so both database.ts (creating hook)
// and syncWorker.ts can import it without a cycle (db → syncWorker → db).
// Dynamic import used to work here but deferred the poke past
// startSyncWorker registration in tests, causing an extra tick.

type PokeListener = () => void;

const pokeListeners = new Set<PokeListener>();

export function addPokeListener(l: PokeListener): void {
  pokeListeners.add(l);
}

export function removePokeListener(l: PokeListener): void {
  pokeListeners.delete(l);
}

export function pokeSyncWorker(): void {
  for (const l of pokeListeners) {
    try {
      l();
    } catch {
      // A single misbehaving listener must not block the others.
    }
  }
}

// Test-only. If a test throws before its worker's `stop()` runs, the listener
// leaks into the next test and (because the creating-hook fires synchronously
// on commit) a bulkAdd in the next test re-enters the stale listener.
export function __resetPokeChannelForTests(): void {
  pokeListeners.clear();
}
