import { useEffect, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { getSupabase } from '@/lib/supabase';
import { SyncManager, SyncStatus } from './SyncManager';

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({ isOnline: true, isSyncing: false, pendingCount: 0 });
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    const mgr = SyncManager.getInstance(supabase);
    // init once (SyncManager.init is idempotent)
    mgr.init().catch(console.error);

    const unsub = mgr.subscribe(setStatus);
    // Poll counts every 2s (cheap local read)
    const interval = setInterval(async () => {
      const [c, f] = await Promise.all([mgr.getPendingCount(), mgr.getFailedCount()]);
      setStatus(s => (s.pendingCount === c ? s : { ...s, pendingCount: c }));
      setFailedCount(prev => (prev === f ? prev : f));
    }, 2000);

    const appSub = AppState.addEventListener('change', state => {
      if (state === 'active') mgr.processQueue().catch(console.error);
    });

    return () => {
      unsub();
      clearInterval(interval);
      appSub.remove();
    };
  }, []);

  const retryNow = useCallback(async () => {
    const mgr = SyncManager.getInstance(getSupabase());
    // Re-enable terminal failed rows (except version conflicts) first,
    // otherwise Retry is a no-op when everything is in 'failed'.
    await mgr.resetFailedForRetry().catch(() => 0);
    return mgr.processQueue();
  }, []);

  return { ...status, failedCount, retryNow };
}
