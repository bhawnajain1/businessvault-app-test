import { useEffect, useState } from 'react';
import { currentBusinessId } from '../../lib/business';

export function useBusinessId(): { businessId: string | null; error: string | null } {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    currentBusinessId()
      .then((id) => {
        if (alive) setBusinessId(id);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { businessId, error };
}
