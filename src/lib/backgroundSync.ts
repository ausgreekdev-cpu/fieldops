import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { getSupabase } from './supabase';
import { SyncManager } from '@/sync/SyncManager';
import { notifySyncComplete } from './notifications';
import { captureError, addBreadcrumb } from './monitoring';

export const BG_TASK = 'fieldops-sync';

TaskManager.defineTask(BG_TASK, async () => {
  try {
    addBreadcrumb('bg-sync run', { task: BG_TASK });
    const supabase = getSupabase();
    const mgr = SyncManager.getInstance(supabase);
    const { synced, failed } = await mgr.processQueue();
    if (synced > 0 || failed > 0) await notifySyncComplete(synced, failed);
    try { await mgr.pull('jobs'); } catch {}
    return synced > 0 || failed === 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    captureError(e, { where: 'bg-sync task' });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function getBackgroundSyncStatus(): Promise<{ status: BackgroundFetch.BackgroundFetchStatus | null; isRegistered: boolean; minimumInterval?: number }> {
  const status = await BackgroundFetch.getStatusAsync();
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_TASK);
  return { status, isRegistered };
}

export async function registerBackgroundSync(): Promise<boolean> {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
    captureError(new Error('BackgroundFetch restricted'), { status });
    return false;
  }
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_TASK);
  if (!isRegistered) {
    await BackgroundFetch.registerTaskAsync(BG_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    addBreadcrumb('bg-sync registered', { interval: 15 * 60 });
  }
  try { await SecureStore.setItemAsync('prefs.bgSyncEnabled', 'true'); } catch {}
  return true;
}

export async function unregisterBackgroundSync(): Promise<void> {
  try { await SecureStore.setItemAsync('prefs.bgSyncEnabled', 'false'); } catch {}
  try { await BackgroundFetch.unregisterTaskAsync(BG_TASK); } catch {}
  addBreadcrumb('bg-sync unregistered');
}

export async function isBgSyncEnabled(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync('prefs.bgSyncEnabled')) === 'true'; } catch { return true; }
}
