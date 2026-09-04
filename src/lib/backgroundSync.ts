import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { getSupabase } from './supabase';
import { SyncManager } from '@/sync/SyncManager';
import { notifySyncComplete } from './notifications';

export const BG_TASK = 'fieldops-sync';

TaskManager.defineTask(BG_TASK, async () => {
  try {
    const supabase = getSupabase();
    const mgr = SyncManager.getInstance(supabase);
    // ensure init (NetInfo will be fetched inside processQueue guard)
    const { synced, failed } = await mgr.processQueue();
    if (synced > 0 || failed > 0) await notifySyncComplete(synced, failed);
    // pull latest jobs/invoices in background when online
    try { await mgr.pull('jobs'); } catch {}
    return synced > 0 || failed === 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    console.warn('[bg-sync]', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
    console.log('[bg-sync] restricted');
    return false;
  }
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_TASK);
  if (!isRegistered) {
    await BackgroundFetch.registerTaskAsync(BG_TASK, {
      minimumInterval: 15 * 60, // 15 minutes (iOS min)
      stopOnTerminate: false,
      startOnBoot: true,
    });
    console.log('[bg-sync] registered 15m');
  }
  return true;
}

export async function unregisterBackgroundSync() {
  try { await BackgroundFetch.unregisterTaskAsync(BG_TASK); } catch {}
}
