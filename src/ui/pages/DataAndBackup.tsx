import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentBusinessId } from '../../lib/business';
import BackupSettings from '../settings/BackupSettings';

// The route target for Settings → Data & Backup (spec §3, §28).
// Resolves the active business id from Dexie (the app has already onboarded
// if we reach this page), then hands off to BackupSettings.

export default function DataAndBackup() {
  const navigate = useNavigate();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const id = await currentBusinessId();
        if (cancelled) return;
        setBusinessId(id);
      } catch {
        if (!cancelled) setBusinessId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-slate-500">Loading backup settings…</div>;
  }
  if (!businessId) {
    return (
      <div className="p-6 text-slate-600">
        <p>No business found. Complete onboarding first.</p>
        <button
          type="button"
          onClick={() => navigate('/onboarding')}
          className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Go to onboarding
        </button>
      </div>
    );
  }

  return (
    <BackupSettings
      businessId={businessId}
      onReconnect={() => navigate('/onboarding?reconnect=1')}
    />
  );
}
