import * as React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { getDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { requestNotificationPermission } from '@/lib/notifications';
import { registerBackgroundSync } from '@/lib/backgroundSync';
import { SyncManager } from '@/sync/SyncManager';
import { initMonitoring } from '@/lib/monitoring';

const queryClient = new QueryClient();

export default function RootLayout() {
  React.useEffect(() => {
    // Init DB + Supabase listener early
    getDb().catch(console.error);
    const supabase = getSupabase();
    supabase.auth.onAuthStateChange((_event, _session) => {
      // could trigger SyncManager pull here
    });
    // Monitoring (no-op without DSN)
    initMonitoring(process.env.EXPO_PUBLIC_SENTRY_DSN);
    // Init sync + notifications + background fetch (all best-effort)
    SyncManager.getInstance(supabase).init().catch(console.error);
    requestNotificationPermission().catch(console.error);
    registerBackgroundSync().catch(console.error);
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
