# BusinessVault Architecture

This document is the deeper companion to the top-level [README](../README.md). It walks
through the four things you must understand before touching the write path: the storage
model, the event journal, the hash chain, and the restore protocol. Every section
references the concrete source file that implements it.

## 1. Storage model

Three layers, strictly separated.

### Layer A — Local operational database

- Implementation: Dexie 4 over IndexedDB.
- Schema: [`src/db/schema.ts`](../src/db/schema.ts).
- Bootstrap + open: [`src/db/database.ts`](../src/db/database.ts),
  [`src/db/db.ts`](../src/db/db.ts).
- Migrations: [`src/db/migrations.ts`](../src/db/migrations.ts) and
  [`src/db/migrations/`](../src/db/migrations/) — versioned upgrades, never in-place
  schema mutation.
- Repositories: [`src/db/repos/`](../src/db/repos/) — thin readers/writers. Business
  rules stay in `src/domain/`.

This layer is the source of truth for reads and writes at runtime. All screens read
from here. All POS speed comes from here. Reports, receivables aging, inventory
recalculation — all here.

### Layer B — Immutable synchronization journal

Every committed business op emits exactly one event.

- Event shape: [`src/events/types.ts`](../src/events/types.ts),
  [`src/journal/event.ts`](../src/journal/event.ts).
- Event types (allow-list): [`src/domain/eventTypes.ts`](../src/domain/eventTypes.ts).
- Append (in the same Dexie transaction as the business write):
  [`src/events/journal.ts`](../src/events/journal.ts),
  [`src/journal/journalWriter.ts`](../src/journal/journalWriter.ts).
- JSONL month-partitioned files land at `journal/YYYY/YYYY-MM.events.jsonl` on Drive.
- Emit hook wired into services: [`src/domain/eventEmitter.ts`](../src/domain/eventEmitter.ts).
- Sync-event bookkeeping in the local DB: [`src/domain/syncEventLog.ts`](../src/domain/syncEventLog.ts).

Every event carries: `event_id` (ULID, monotonic per device), `business_id`, `device_id`,
`entity_type`, `entity_id`, `operation`, `entity_version`, `timestamp` (ISO-8601 UTC),
`payload` (JSON), `payload_hash` (SHA-256 hex over canonical JSON of payload),
`previous_hash` (payload_hash of the previous event, or the zero hash for the first),
and a `sync_status` from
`LOCAL_ONLY | QUEUED | SYNCING | SYNCED | CONFLICT | FAILED`.

Events are **idempotent**. Replay applies by `(event_id)` primary key; if the event has
already been applied, the handler is a no-op. Every per-entity-type replay handler is in
[`src/restore/eventHandlers.ts`](../src/restore/eventHandlers.ts) and must be safe under
double-apply.

### Layer C — Customer's Google Drive (drive.file)

Provider interface: [`src/storage/CustomerStorageProvider.ts`](../src/storage/CustomerStorageProvider.ts).
Google implementation: [`src/drive/GoogleDriveStorageProvider.ts`](../src/drive/GoogleDriveStorageProvider.ts).
Local-folder implementation (used in tests + dev):
[`src/storage/LocalFolderStorageProvider.ts`](../src/storage/LocalFolderStorageProvider.ts).
Fake provider for unit tests: [`src/test/fakeDriveProvider.ts`](../src/test/fakeDriveProvider.ts).

Drive layout (mirrors spec §4):

```
BusinessVault/<BusinessName>/
  README.txt                       src/drive/readmeTemplate.ts
  metadata/
    manifest.json                  src/sync/manifest.ts
    schema.json                    src/drive/schemaDoc.ts
    sync-state.json                src/sync/status.ts
    checksums.json                 src/sync/manifest.ts
  current/*.csv                    src/csv/snapshot.ts + src/csv/schemas.ts
  journal/YYYY/YYYY-MM.events.jsonl  src/journal/journalWriter.ts
  invoices/YYYY-YY/INV-*.pdf
  attachments/{purchases,expenses,products}/
  reports/
  snapshots/{daily,monthly,annual}/  src/sync/snapshotScheduler.ts
```

Guarantees enforced in code:

- OAuth scope is exactly `https://www.googleapis.com/auth/drive.file`. See
  [`src/drive/oauth.ts`](../src/drive/oauth.ts) — the scope string is a single constant.
- Refresh tokens never touch a user-visible file. They live encrypted in IndexedDB via
  [`src/drive/tokenStore.ts`](../src/drive/tokenStore.ts).
- Drive file IDs are cached locally to avoid filename search — see
  [`src/drive/driveApiClient.ts`](../src/drive/driveApiClient.ts) and the file-id map
  written by the sync worker.

## 2. Event journal

The journal is the durable incremental log between full snapshots. It is append-only,
month-partitioned on disk, and hash-chained.

Write path per business op (all in one Dexie transaction, `rw` on all touched tables +
`sync_events`):

1. Domain service performs the business writes (create invoice, decrement stock, create
   receivable, post journal lines, etc.).
2. Domain service calls `journal.append(event)` — see
   [`src/events/journal.ts`](../src/events/journal.ts). This:
   - Assigns a ULID `event_id` — [`src/lib/id.ts`](../src/lib/id.ts).
   - Stamps `device_id` from [`src/lib/device.ts`](../src/lib/device.ts).
   - Reads the previous event's `payload_hash` for this business (indexed lookup) and
     sets `previous_hash`.
   - Canonicalises the payload (stable key order, no whitespace) and computes
     `payload_hash` via SHA-256 over UTF-8 bytes — [`src/lib/crypto.ts`](../src/lib/crypto.ts).
   - Inserts into `sync_events` with `sync_status = QUEUED`.
3. Transaction commits. The cashier UI shows "Invoice saved" — it never waits for Drive.

Upload path (background):

- [`src/sync/syncWorker.ts`](../src/sync/syncWorker.ts) drains the queue.
- [`src/sync/syncQueue.ts`](../src/sync/syncQueue.ts) persists retry state across
  reloads.
- [`src/sync/journalUploader.ts`](../src/sync/journalUploader.ts) batches events into
  the month-partition JSONL file on Drive, using a resumable append pattern (read tail
  metadata, append new lines, verify).
- [`src/lib/backoff.ts`](../src/lib/backoff.ts) implements exponential backoff with
  jitter. `sync_status` cycles through `QUEUED -> SYNCING -> SYNCED | FAILED` and, on
  external-edit detection, `CONFLICT`.

Snapshots (spec §13, §19):

- Scheduler: [`src/sync/snapshotScheduler.ts`](../src/sync/snapshotScheduler.ts) — daily
  after activity, monthly at month-end, annual at FY-end.
- Builder: [`src/csv/snapshot.ts`](../src/csv/snapshot.ts) streams from Dexie to CSV
  without loading full tables into RAM (see [`src/csv/streamCsvExport.ts`](../src/csv/streamCsvExport.ts)).
- Uploader: [`src/sync/snapshotUploader.ts`](../src/sync/snapshotUploader.ts) performs
  the atomic dance: temp path -> per-file checksum -> resumable upload -> re-read and
  verify checksum on Drive -> update `manifest.json` and `checksums.json` -> flip the
  `current/` pointer. If any step fails, the previous snapshot is left intact.

## 3. Hash chain

The hash chain is what makes "your Drive folder alone is enough to prove nothing was
tampered with" real.

- Chain implementation: [`src/journal/hashChain.ts`](../src/journal/hashChain.ts).
- Tests: [`src/journal/hashChain.test.ts`](../src/journal/hashChain.test.ts),
  [`tests/hashchain.spec.ts`](../tests/hashchain.spec.ts).
- Verification: [`src/events/verify.ts`](../src/events/verify.ts).

Rules:

- `payload_hash = SHA-256(canonical_json(payload))`. Canonicalisation: keys sorted, no
  insignificant whitespace, integers not floats for money/qty (see
  [`src/lib/money.ts`](../src/lib/money.ts) and [`src/lib/qty.ts`](../src/lib/qty.ts)).
- `previous_hash` on the first event of a business is `"0".repeat(64)`.
- On restore we recompute the chain end-to-end. Any mismatch causes the restore to halt
  with `INTEGRITY_FAILURE` and produce a diagnostic report — see
  [`src/restore/diagnosticReport.ts`](../src/restore/diagnosticReport.ts). We never
  silently import a broken chain.
- Snapshot files carry their own SHA-256 in `metadata/checksums.json`. A snapshot whose
  content hash does not match is rejected in favour of the previous known-good snapshot.

Multi-device note: the chain is per-business, not per-device. When events from two
devices arrive out of order, `previous_hash` is resolved against the last-known-server
ordering during upload, and conflicts are surfaced via
[`src/sync/conflicts.ts`](../src/sync/conflicts.ts). Financial-write conflicts NEVER
last-write-wins — they surface to the user for reconciliation (spec §22–§24). See
[`src/accounting/reversal.ts`](../src/accounting/reversal.ts) for the append-only
correction pattern.

## 4. Restore protocol

Everything above exists so that this flow works from Drive alone.

Entry point: [`src/restore/rebuildFromDrive.ts`](../src/restore/rebuildFromDrive.ts).
End-to-end test: [`tests/google-drive-disaster-recovery.spec.ts`](../tests/google-drive-disaster-recovery.spec.ts).

Steps (each is a discrete function so failures can be resumed):

1. **Connect Drive** — user signs in, OAuth PKCE flow in
   [`src/drive/oauth.ts`](../src/drive/oauth.ts). Scope: `drive.file`.
2. **Locate BusinessVault folder** — driveApiClient searches for the folder created by
   this app (drive.file gives us access to files we created + files the user picked).
3. **Read `metadata/manifest.json`** — see [`src/sync/manifest.ts`](../src/sync/manifest.ts).
   Contains `schemaVersion`, `journalCheckpoint`, expected record counts, and
   per-file checksums.
4. **Verify schema** against `metadata/schema.json` ([`src/drive/schemaDoc.ts`](../src/drive/schemaDoc.ts)).
   If the schema version is older than this app supports, run forward migrations. If
   newer, refuse to restore and tell the user to update.
5. **Verify checksums** for every file in `current/` against `checksums.json`. Any
   mismatch is reported; the user chooses whether to fall back to the newest snapshot
   under `snapshots/daily|monthly|annual/`.
6. **Load latest valid snapshot** — parse each CSV using
   [`src/csv/parser.ts`](../src/csv/parser.ts) (Unicode/Hindi safe, RFC quoting), insert
   into freshly initialised Dexie tables. Streamed — never buffer whole files in memory.
7. **Replay journal events after `journalCheckpoint`** — read
   `journal/YYYY/YYYY-MM.events.jsonl` files in order, verify the hash chain as we go,
   and apply each event via [`src/restore/eventHandlers.ts`](../src/restore/eventHandlers.ts).
   Handlers are idempotent: re-applying an event that is already reflected in the
   snapshot is a no-op (they key by `event_id` in a `applied_events` table).
8. **Rebuild indexes** — Dexie indexes are regenerated by insertion order; any secondary
   derived tables (aging buckets, running balances) are rebuilt from primary data by
   [`src/restore/eventHandlers.ts`](../src/restore/eventHandlers.ts) / accounting
   recompute in [`src/accounting/postings.ts`](../src/accounting/postings.ts).
9. **Revalidate invariants** ([`src/restore/rebuildFromDrive.ts`](../src/restore/rebuildFromDrive.ts) +
   [`src/accounting/reports.ts`](../src/accounting/reports.ts)):
   - Double-entry: `SUM(debits) == SUM(credits)`.
   - Inventory identity: `opening + purchases + sales_returns
     - sales - purchase_returns ± adjustments == current stock` per item per warehouse.
   - Invoice totals reconcile with allocated payments and receivables.
   - GST totals per rate reconcile with output/input tax accounts.
10. **Emit recovery report** — [`src/restore/diagnosticReport.ts`](../src/restore/diagnosticReport.ts).
    Any invariant break produces `RECOVERY_DIAGNOSTIC_REPORT` and blocks "open business";
    we do **not** silently correct accounting.
11. **Open business** — flip UI state, register device_id (new device gets a new one via
    [`src/lib/device.ts`](../src/lib/device.ts)), start sync worker.

If steps 3–7 discover only a snapshot and no journal (or vice versa), the app restores
what it has and clearly labels the "as-of" timestamp. If nothing is recoverable, we
show the customer where in Drive we looked, and never delete anything.

## Cross-cutting rules (repeat, because they matter)

- **CSV is not a database.** No code path outside `src/csv/` and `src/restore/` should
  parse CSV. Reads go through Dexie.
- **Idempotency is not optional.** Every event handler must be safe to call twice.
  Every uploader must be safe to run twice against the same file (checksum-first
  overwrites of temp paths, atomic pointer flip only after verify).
- **Refresh tokens are secrets.** They live in
  [`src/drive/tokenStore.ts`](../src/drive/tokenStore.ts) encrypted with a
  device-derived key, and never appear in logs, CSVs, JSON exports, or the ZIP export.
- **Accounting is append-only.** [`src/accounting/reversal.ts`](../src/accounting/reversal.ts)
  is the correction path; there is no destructive-update path for posted transactions.
- **The disaster-recovery spec is the acceptance gate.** If
  [`tests/google-drive-disaster-recovery.spec.ts`](../tests/google-drive-disaster-recovery.spec.ts)
  fails, the storage implementation is by definition incomplete (spec §41).
