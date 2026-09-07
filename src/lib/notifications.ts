import * as Notifications from 'expo-notifications';
import { Platform, Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const WEEKLY_ID = 'weekly-summary';
const CHANNEL_ID = 'fieldops-sync';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status as any;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('[notifications] permission denied');
    return false;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'FieldOps Sync',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }
  return true;
}

export async function openNotificationSettings() {
  if (Platform.OS === 'ios') await Linking.openURL('app-settings:');
  else await Linking.openSettings();
}

export async function notifySyncComplete(synced: number, failed: number) {
  if (synced === 0 && failed === 0) return;
  const title = failed > 0 ? `Sync: ${synced} ok, ${failed} failed` : `Sync complete ✓ ${synced} update${synced === 1 ? '' : 's'} synced`;
  const body = failed > 0 ? 'Tap to retry failed items in Sync Debug' : 'All offline work uploaded';
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: null,
    identifier: undefined,
  } as any);
  // Note: immediate, no channelId needed for one-shot; Android will use default if not specified, but we set channel for weekly
}

export async function notifyDueJob(jobTitle: string, customer: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title: `Job due: ${jobTitle}`, body: `Customer ${customer} — tap to open`, sound: 'default' },
    trigger: null,
  } as any);
}

// Weekly — use WeeklyTriggerInput at Monday 9am, identifier, channelId, no cancelAll
export async function scheduleWeeklySummary(revenue: number, jobs: number) {
  // Store preference
  try { await SecureStore.setItemAsync('prefs.notifications.weeklyEnabled', 'true'); } catch {}
  // Cancel only weekly, not all
  try { await Notifications.cancelScheduledNotificationAsync(WEEKLY_ID); } catch {}
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_ID,
    content: {
      title: `Weekly FieldOps Summary`,
      body: `Revenue $${revenue.toFixed(0)} • ${jobs} jobs • tap for analytics`,
      sound: 'default',
    },
    trigger: {
      weekday: 2, // Monday
      hour: 9,
      minute: 0,
      repeats: true,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    } as any,
  });
}

export async function cancelWeeklySummary() {
  try { await SecureStore.setItemAsync('prefs.notifications.weeklyEnabled', 'false'); } catch {}
  try { await Notifications.cancelScheduledNotificationAsync(WEEKLY_ID); } catch {}
}

export async function getWeeklyStatus(): Promise<{ enabled: boolean; scheduled: boolean; nextTrigger?: Date | null }> {
  let enabled = false;
  try { enabled = (await SecureStore.getItemAsync('prefs.notifications.weeklyEnabled')) === 'true'; } catch {}
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const found = all.find(n => n.identifier === WEEKLY_ID);
  // nextTrigger not directly exposed; approximate
  return { enabled, scheduled: !!found, nextTrigger: null };
}

export async function notifyWeeklySummaryNow(revenue: number, jobs: number) {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'FieldOps Weekly', body: `Revenue $${revenue.toFixed(0)} • ${jobs} jobs this week`, sound: 'default' },
    trigger: null,
  } as any);
}

// Helper for debug: fire 60s debug weekly
export async function scheduleWeeklySummaryDebug(revenue: number, jobs: number) {
  try { await Notifications.cancelScheduledNotificationAsync('weekly-debug'); } catch {}
  await Notifications.scheduleNotificationAsync({
    identifier: 'weekly-debug',
    content: { title: 'FieldOps Weekly (debug)', body: `Revenue $${revenue.toFixed(0)} • ${jobs} jobs`, sound: 'default' },
    trigger: { seconds: 60, repeats: false, channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined } as any,
  });
}

export async function getAllScheduledCount(): Promise<number> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.length;
}
