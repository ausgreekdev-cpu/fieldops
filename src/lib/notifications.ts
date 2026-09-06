import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Foreground handling: show alert, play sound
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
    await Notifications.setNotificationChannelAsync('fieldops-sync', {
      name: 'FieldOps Sync',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }
  return true;
}

export async function notifySyncComplete(synced: number, failed: number) {
  if (synced === 0 && failed === 0) return;
  const title = failed > 0 ? `Sync: ${synced} ok, ${failed} failed` : `Sync complete ✓ ${synced} update${synced === 1 ? '' : 's'} synced`;
  const body = failed > 0 ? 'Tap to retry failed items in Sync Debug' : 'All offline work uploaded';
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: null,
  });
}

export async function notifyDueJob(jobTitle: string, customer: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title: `Job due: ${jobTitle}`, body: `Customer ${customer} — tap to open`, sound: 'default' },
    trigger: null,
  });
}

export async function scheduleWeeklySummary(revenue: number, jobs: number) {
  // Cancel previous weekly summaries
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Weekly FieldOps Summary`,
      body: `Revenue $${revenue.toFixed(0)} • ${jobs} jobs • tap for analytics`,
      sound: 'default',
    },
    trigger: { seconds: 60 * 60 * 24 * 7, repeats: true } as any,
  });
}

export async function notifyWeeklySummaryNow(revenue: number, jobs: number) {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'FieldOps Weekly', body: `Revenue $${revenue.toFixed(0)} • ${jobs} jobs this week`, sound: 'default' },
    trigger: null,
  });
}
