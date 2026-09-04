import { useEffect, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { getSupabase } from '@/lib/supabase';
import { SyncManager, SyncStatus } from './SyncManager';

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({ isOnline: true, isSyncing: false, pendingCount: 0 });

  useEffect(() => {
    const supabase = getSupabase();
    const mgr = SyncManager.getInstance(supabase);
    // init once
    mgr.init().catch(console.error);

    const unsub = mgr.subscribe(setStatus);
    // Poll pending count every 2s (cheap local read)
    const interval = setInterval(async () => {
      const c = await mgr.getPendingCount();
      setStatus(s => (s.pendingCount === c ? s : { ...s, pendingCount: c }));
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
    return mgr.processQueue();
  }, []);

  return { ...status, retryNow };
}
