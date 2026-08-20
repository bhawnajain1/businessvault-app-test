import { useNavigate } from 'react-router-dom';
import { useBackupHealth } from './BackupHealthContext';
import type { BackupHealthStatus } from '../sync/syncWorker';

// Spec §29: three visible states in the header.
//   ☁ ✓  Backed up (HEALTHY)
//   ☁ ↻  Syncing (SYNCING) — animated pulse
//   ☁ !  Backup problem (OFFLINE/DISCONNECTED/ERROR/CONFLICT/INTEGRITY_FAILURE) — amber
// The cloud glyph is spec-mandated; the other symbols are also spec examples.
// Non-interruptive: clicking navigates to Data & Backup (no modal).

type Visual = 'ok' | 'syncing' | 'problem';

function visualFor(status: BackupHealthStatus): Visual {
  if (status === 'HEALTHY') return 'ok';
  if (status === 'SYNCING') return 'syncing';
  return 'problem';
}

function labelFor(status: BackupHealthStatus): string {
  switch (status) {
    case 'HEALTHY':
      return 'Backed up';
    case 'SYNCING':
      return 'Syncing';
    case 'OFFLINE':
      return 'Offline — changes queued';
    case 'DISCONNECTED':
      return 'Google Drive disconnected';
    case 'CONFLICT':
      return 'Backup conflict';
    case 'INTEGRITY_FAILURE':
      return 'Backup integrity failure';
    case 'ERROR':
    default:
      return 'Backup problem';
  }
}

function glyphFor(v: Visual): string {
  if (v === 'ok') return '✓';
  if (v === 'syncing') return '↻';
  return '!';
}

export default function CloudIndicator() {
  const nav = useNavigate();
  const health = useBackupHealth();
  const visual = visualFor(health.status);

  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-[12px] font-medium select-none transition-colors';
  const tone =
    visual === 'ok'
      ? 'bg-success-bg text-success hover:opacity-90'
      : visual === 'syncing'
        ? 'bg-info-bg text-info hover:opacity-90 animate-pulse'
        : 'bg-warning-bg text-warning hover:opacity-90';

  const label = labelFor(health.status);
  const glyph = glyphFor(visual);

  return (
    <button
      type="button"
      onClick={() => nav('/settings/backup')}
      className={`${base} ${tone}`}
      aria-label={`Backup status: ${label}. Click to open Data & Backup.`}
      title={label}
      data-testid="cloud-indicator"
      data-status={health.status}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {'☁'}
      </span>
      <span aria-hidden="true" className="leading-none">
        {glyph}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
