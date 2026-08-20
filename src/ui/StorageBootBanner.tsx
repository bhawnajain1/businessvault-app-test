import { useEffect, useState } from 'react';
import {
  getBootState,
  reconnectWithUserGesture,
  subscribeBoot,
  tryBootLocalFolderProvider,
} from '../sync/bootProvider';

// Auto-attempts a silent reconnect on mount. If Chrome revoked the folder
// permission (needs a user gesture to re-grant), or if the saved handle is
// gone, shows a small yellow banner with a "Reconnect" button. The button
// runs inside a click handler so showDirectoryPicker / requestPermission
// succeed.
export default function StorageBootBanner() {
  const [state, setState] = useState(getBootState());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeBoot(setState);
    // Silent boot on first mount. This will land in 'running' if the saved
    // handle still has readwrite permission, or 'needs-permission' if not.
    void tryBootLocalFolderProvider();
    return unsub;
  }, []);

  if (state.status === 'idle' || state.status === 'starting' || state.status === 'running') {
    return null;
  }

  const onReconnect = async () => {
    setBusy(true);
    try {
      await reconnectWithUserGesture();
    } finally {
      setBusy(false);
    }
  };

  const isError = state.status === 'error';
  const isNoFolder = state.status === 'no-folder';
  const message = isError
    ? `Backup folder error: ${state.error ?? 'unknown'}`
    : isNoFolder
      ? 'Backup folder not chosen yet. Pick a folder so new entries flush to disk.'
      : 'Backup folder needs permission. Click Reconnect and re-grant access so new entries flush to disk.';
  const buttonLabel = busy
    ? 'Working…'
    : isNoFolder
      ? 'Choose Folder…'
      : 'Reconnect';

  return (
    <div
      className={
        'px-4 py-2 text-sm flex items-center gap-3 border-b ' +
        (isError
          ? 'bg-rose-50 border-rose-200 text-rose-900'
          : 'bg-amber-50 border-amber-200 text-amber-900')
      }
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onReconnect}
        disabled={busy}
        className="rounded border border-current px-2 py-1 text-xs hover:bg-white/40 disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
