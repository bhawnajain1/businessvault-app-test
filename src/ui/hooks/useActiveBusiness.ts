import { useEffect, useState } from 'react';
import { currentBusinessId, NotOnboardedError } from '../../lib/business';
import { getDeviceId } from '../../lib/device';

export interface ActiveBusiness {
  businessId: string | null;
  deviceId: string | null;
  loading: boolean;
  error: Error | null;
}

export function useActiveBusiness(): ActiveBusiness {
  const [state, setState] = useState<ActiveBusiness>({
    businessId: null,
    deviceId: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bid, did] = await Promise.all([
          currentBusinessId().catch((e: unknown) => {
            if (e instanceof NotOnboardedError) return null;
            throw e;
          }),
          getDeviceId(),
        ]);
        if (cancelled) return;
        setState({ businessId: bid, deviceId: did, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({
          businessId: null,
          deviceId: null,
          loading: false,
          error: e instanceof Error ? e : new Error(String(e)),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
