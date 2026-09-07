import * as React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { getDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { requestNotificationPermission } from '@/lib/notifications';
import { registerBackgroundSync, isBgSyncEnabled } from '@/lib/backgroundSync';
import { SyncManager } from '@/sync/SyncManager';
import { initMonitoring, captureMessage, addBreadcrumb } from '@/lib/monitoring';

const queryClient = new QueryClient();

export default function RootLayout() {
  React.useEffect(() => {
    getDb().catch(console.error);
    const supabase = getSupabase();
    supabase.auth.onAuthStateChange((_event, _session) => {});
    initMonitoring(process.env.EXPO_PUBLIC_SENTRY_DSN);
    SyncManager.getInstance(supabase).init().catch(console.error);

    // Notifications + bg sync (only if granted && enabled)
    (async () => {
      try {
        const granted = await requestNotificationPermission();
        if (!granted) {
          captureMessage('notifications denied', 'warning');
          addBreadcrumb('notifications denied');
          return;
        }
        const bgEnabled = await isBgSyncEnabled();
        if (bgEnabled) await registerBackgroundSync();
        addBreadcrumb('notifications granted, bgSync check', { granted, bgEnabled });
      } catch (e) { console.warn(e); }
    })();

    // Tap handling -> analytics/debug
    const sub = Notifications.addNotificationResponseReceivedListener(res => {
      const title = res.notification.request.content.title ?? '';
      addBreadcrumb('notification tap', { title });
      if (title.includes('FieldOps') || title.includes('Weekly')) router.push('/analytics' as any);
      else if (title.includes('Sync')) router.push('/debug' as any);
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="jobs/[id]" options={{ presentation: 'card', headerShown: true, title: 'Job Detail' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
