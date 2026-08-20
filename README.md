# BusinessVault

Local-first Indian SMB billing and accounting PWA. Data lives in IndexedDB on the device;
durable copies (event journal + CSV snapshots + PDFs + attachments) are mirrored to the
user's **own** Google Drive under `BusinessVault/<BusinessName>/`. The customer owns the
data end-to-end — if our servers vanish, their business is still recoverable from Drive alone.

BusinessVault is designed for small-shop reality in India: intermittent connectivity, one
laptop plus a tablet plus an owner's phone, GST invoices, Hindi/Unicode customer names,
and the occasional accountant who wants everything in Excel. The system is built around a
strict rule: **Google Drive is not a database.** The local IndexedDB is the source of truth
for reads and writes; every business operation emits one immutable, hash-chained event to
a sync journal that streams to Drive in the background; CSV/XLSX are portable snapshots.

## Architecture

```
   +---------------------+       +----------------------+       +----------------------+
   |  UI (React 18 SPA)  | <---> | Domain services      | <---> | Local DB (Dexie /    |
   |  Tailwind, RRv6     |       | Invoice / POS /      |       | IndexedDB)           |
   |                     |       | Payment / Purchase / |       | operational source   |
   |                     |       | Inventory / Ledger   |       | of truth             |
   +---------------------+       +----------+-----------+       +----------+-----------+
                                            |                              |
                                            v                              |
                                 +----------+-----------+                  |
                                 | Sync Journal         |<-----------------+
                                 | append-only          |  one event per op
                                 | ULID event_id        |  (idempotent)
                                 | SHA-256 hash chain   |
                                 | payload/previous     |
                                 +----------+-----------+
                                            |
                                            v
                                 +----------+-----------+
                                 | Sync Worker          |
                                 | queue + backoff+jit  |
                                 | resumable uploads    |
                                 | file-id cache        |
                                 +----------+-----------+
                                            |
                                            v
             +------------------------------+-------------------------------+
             |             Customer's Google Drive (drive.file)             |
             |                                                              |
             |  BusinessVault/<BusinessName>/                               |
             |    README.txt                                                |
             |    metadata/  manifest.json | schema.json | sync-state.json  |
             |               checksums.json                                 |
             |    current/   *.csv        (portable snapshot)               |
             |    journal/YYYY/YYYY-MM.events.jsonl                         |
             |    invoices/  PDFs                                           |
             |    attachments/ purchases/ expenses/ products/               |
             |    reports/                                                  |
             |    snapshots/ daily/ monthly/ annual/                        |
             +--------------------------------------------------------------+
```

CSV files are **not queried**. They are regenerated periodically from the local DB and
uploaded atomically (temp -> checksum -> upload -> verify -> update manifest -> mark current).
The last known-good snapshot is never overwritten until the new one has verified.

## Quick start

```bash
git clone <this repo>
cd BusinessVaultApp
npm install
cp .env.example .env.local
# edit .env.local: fill in VITE_GOOGLE_CLIENT_ID (see Google Cloud setup below)
npm run dev
# open http://localhost:5173
```

`.env.local` variables:

```
VITE_GOOGLE_CLIENT_ID=<your-oauth-client-id>.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/oauth/callback
```

We use the browser OAuth 2.0 flow directly (no `gapi` loader). Refresh tokens are stored
encrypted in IndexedDB via `src/drive/tokenStore.ts` and **never** written to any
user-visible file in Drive.

## Google Cloud Console setup

Do this once per environment (dev / staging / prod). Users do **not** need to do this —
they just click "Connect Google Drive" and grant consent.

1. Go to https://console.cloud.google.com/ and create a new project
   (e.g. `businessvault-dev`).
2. Navigate to **APIs & Services -> Library** and enable **Google Drive API**.
   Do NOT enable Google Sheets, Docs, or any other Drive-adjacent API — we only need Drive.
3. **APIs & Services -> OAuth consent screen**:
   - User type: **External** (for public), **Internal** (Workspace org only).
   - App name: `BusinessVault` (or your white-label name).
   - Support email + developer contact: your address.
   - Scopes: add exactly one -
     `https://www.googleapis.com/auth/drive.file`.
     **Do not add `drive` or `drive.readonly`** — those give access to the user's entire
     Drive, and Google will reject verification unless you truly need it. `drive.file`
     scopes us to files/folders the app itself creates or the user explicitly opens.
   - Test users: add your dev accounts.
4. **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID**:
   - Application type: **Web application**.
   - Name: `BusinessVault Web (dev)`.
   - Authorized JavaScript origins: `http://localhost:5173`.
   - Authorized redirect URIs: `http://localhost:5173/oauth/callback`.
   - For prod, add your production origin and `<origin>/oauth/callback` here as well.
5. Copy the **Client ID** into `.env.local` as `VITE_GOOGLE_CLIENT_ID`.
   We do NOT ship a client secret — this is a public SPA client using PKCE.

Scope reminder: **`drive.file` only**. If you find yourself wanting `drive` (full),
stop and redesign — the user must be able to trust that this app cannot read their
personal photos, tax returns, or unrelated Drive contents.

## src/ folder map

```
src/
  boot/            App startup: bootstrap.ts, service-worker registration.
  ui/              React 18 SPA. AppShell, Header, Sidebar, CloudIndicator (the "cloud
                   check" backup pill in the header — the only spec-mandated icon),
                   pages/, and feature folders: customers/, suppliers/, items/, invoices/,
                   pos/, payments/, purchases/, expenses/, reports/, restore/, settings/,
                   onboarding/. Domain services are called from here, never Drive directly.
  domain/          Business logic services. InvoiceService, PaymentService, PurchaseService,
                   InventoryService, AccountingService, ItemService, CustomerService, etc.
                   Each service (a) does its work in one Dexie transaction, (b) emits one
                   event via journal. GST helpers (gst.ts), money.ts, and event types live
                   here too. See eslint boundaries below - these files MUST NOT import
                   from src/drive/*.
  db/              Dexie schema + migrations + repositories. database.ts opens the DB,
                   schema.ts declares tables and indexes, migrations/ contains numbered
                   version upgrades. Repositories are thin - business logic stays in
                   domain/.
  events/          Event journal core: types.ts, journal.ts (append), verify.ts
                   (hash-chain + replay verification), replay.ts (rebuild state from
                   events).
  journal/         Journal file format on disk / in Drive. event.ts (event shape),
                   hashChain.ts + hashChain.test.ts (SHA-256 chain), journalWriter.ts
                   (JSONL line writer with month-partitioned files).
  lib/             Zero-dependency utilities. id.ts (ULID), crypto.ts (Web Crypto SHA-256),
                   csvSafe.ts (formula-injection guard), money.ts / qty.ts (integer money
                   & quantities), date.ts, gst.ts, backoff.ts (exp backoff + jitter),
                   business.ts, device.ts (device_id), env.ts, errors.ts, result.ts,
                   logger.ts.
  csv/             CSV codec and snapshot pipeline. csvCodec.ts (RFC-compatible quoting,
                   Unicode/Hindi safe), sanitize.ts (formula injection guard used at
                   write time), parser.ts, schemas.ts (stable headers per table),
                   snapshot.ts (build a full snapshot), streamCsvExport.ts (streaming
                   export - never load full tables into RAM), writer.ts.
  storage/         CustomerStorageProvider interface + non-Drive implementations.
                   LocalFolderStorageProvider (for tests and dev). All storage code
                   goes through this interface - services never see Drive.
  drive/           Google-specific storage provider. GoogleDriveStorageProvider.ts
                   (implements CustomerStorageProvider), driveApiClient.ts (fetch-based,
                   no gapi), oauth.ts + callbackHandler.ts + tokens.ts + tokenStore.ts
                   (PKCE OAuth + encrypted token cache), resumableStore.ts (resumable
                   upload state), readme.ts / readmeTemplate.ts (customer-visible
                   README.txt), schemaDoc.ts.
  sync/            The sync worker and its supporting queue. syncQueue.ts (persistent
                   retry queue with backoff), syncWorker.ts, journalUploader.ts,
                   snapshotUploader.ts, snapshotScheduler.ts, scheduler.ts, status.ts,
                   conflicts.ts (multi-device conflict detection), manifest.ts,
                   restore.ts, providerRegistry.ts, worker.ts.
  restore/         Recovery from Drive. rebuildFromDrive.ts (the end-to-end flow: read
                   manifest, verify schema+checksums, load snapshot, replay journal
                   events, rebuild indexes, revalidate accounting/inventory/GST),
                   eventHandlers.ts (per-event-type replay), tableSchema.ts,
                   diagnosticReport.ts (RECOVERY_DIAGNOSTIC_REPORT generator).
  export/          Full-business ZIP export. businessZipExport.ts, xlsx.ts, zip.ts,
                   zipWriter.ts. Independent of Drive.
  excel/           XLSX report workbook builder (Dashboard / Customers / ... / GST
                   Summary sheets).
  accounting/      Chart of accounts, postings, reports, reversal helpers.
  test/            Test doubles: fakeDriveProvider.ts, factories.ts, setup.ts.
```

## Running tests

```bash
npm test                # all vitest unit + integration specs
npm run test:watch      # watch mode
npm run test:e2e        # integration specs under tests/
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
```

Three test tiers:

- **Unit** - files ending `.test.ts` next to the source they cover under `src/`. Fast, use
  `fake-indexeddb`. Run with `npm test`.
- **Integration / e2e** - `tests/` at the repo root. Multi-service scenarios (accounting
  balance, CSV safety, hash chain end-to-end, inventory identity, interruption resilience,
  performance smoke).
- **Disaster recovery** - `tests/google-drive-disaster-recovery.spec.ts` and
  `tests/e2e/google-drive-disaster-recovery.spec.ts` implement the spec §38 scenario:
  create 1000 items / 100 customers / 500 invoices / payments / returns / expenses,
  sync to a fake Drive, wipe local DB, restore from Drive only, and assert every count
  and financial total matches. This test IS the acceptance gate.

## Final acceptance requirement (spec §41, verbatim)

> "A customer can lose every device they own and our entire production database can
> disappear, but after installing the application on a new device and connecting their
> Google Drive, their business can be reconstructed accurately from their Drive backup."
>
> This includes:
>
> Invoices, Purchases, Inventory, Customers, Suppliers, Payments, Expenses, GST
> information, Receivables, Payables, Accounting, Attachments, Audit history.
>
> If that statement is not demonstrably true, the Google Drive storage implementation is
> incomplete.

Green `tests/google-drive-disaster-recovery.spec.ts` is the single source of truth for
whether that statement holds. Do not merge changes that regress it.

## Contribution guardrails (eslint boundaries)

These are enforced in CI. They exist so the local-first architecture cannot silently
decay into "Drive-as-database" hacks.

- `src/domain/**` **MUST NOT** import from `src/drive/**`. Domain services talk to the
  storage layer through `CustomerStorageProvider` only. Same rule for `src/accounting/**`
  and `src/ui/**` reaching into `src/drive/**` directly.
- `src/csv/**` and `src/db/**` **MUST NOT** import from `src/drive/**`.
- `src/drive/**` is the ONLY place `fetch` calls to `*.googleapis.com` may live.
- No file may import from `dexie` outside `src/db/**` and `src/restore/**`. UI reads
  through domain services / repos, never Dexie directly.
- No `any` in exported signatures. Explicit return types on exported functions.
- No comments unless the WHY is non-obvious. No emojis in code/UI **except** the cloud
  indicator (`src/ui/CloudIndicator.tsx`) which the spec requires.
- CSV writers must go through `src/lib/csvSafe.ts` / `src/csv/sanitize.ts`. Never write a
  raw user-entered string to CSV.
- Any new financial write path must (a) run inside one Dexie transaction, (b) emit
  exactly one journal event, (c) be idempotent on replay. Add a replay test in
  `src/restore/*.test.ts` or `tests/`.
- Do not add npm dependencies without a written justification in the PR.

See `docs/architecture.md` for the deeper walkthrough of the storage model, event
journal, hash chain, and restore protocol.
