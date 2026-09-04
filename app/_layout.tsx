import * as React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { getDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';

const queryClient = new QueryClient();

export default function RootLayout() {
  React.useEffect(() => {
    // Init DB + Supabase listener early
    getDb().catch(console.error);
    const supabase = getSupabase();
    supabase.auth.onAuthStateChange((_event, _session) => {
      // could trigger SyncManager pull here
    });
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
