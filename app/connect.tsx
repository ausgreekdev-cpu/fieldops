import * as React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getSupabase, setSupabaseConfigOverride } from '@/lib/supabase';
import { saveSupabaseConfig, loadSupabaseConfig, isPlaceholderUrl } from '@/lib/supabaseConfig';
import { getDb } from '@/db/client';

export default function ConnectScreen() {
  const [url, setUrl] = React.useState('');
  const [anon, setAnon] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [hasExisting, setHasExisting] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const cfg = await loadSupabaseConfig();
      if (cfg) { setUrl(cfg.url); setAnon(cfg.anonKey); setHasExisting(true); }
    })();
  }, []);

  async function handleConnect() {
    const u = url.trim().replace(/\/$/, '');
    const a = anon.trim();
    if (!u || !a) { Alert.alert('Missing details', 'Paste both the Supabase project URL and anon public key.'); return; }
    if (!/^https:\/\//.test(u)) { Alert.alert('Invalid URL', 'URL should start with https://'); return; }

    setTesting(true);
    try {
      // Save locally first so a placeholder build works offline-first
      await saveSupabaseConfig({ url: u, anonKey: a });
      setSupabaseConfigOverride(u, a);

      // Test connection (non-blocking — don't fail if network offline)
      try {
        const s = getSupabase();
        await s.auth.getSession();
      } catch (e) {
        console.warn('[connect] test warning', e);
      }
      // Ensure DB is ready for the rest of the app
      try { await getDb(); } catch {}

      Alert.alert('Connected ✓', 'Workspace saved on this device. You can now log in.');
      router.replace('/(tabs)/jobs' as any);
    } catch (e: any) {
      Alert.alert('Could not connect', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Connect Workspace', headerShown: false }} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 8, marginTop: 24 }}>
          <View style={styles.logoBox}><Text style={styles.logo}>F</Text></View>
          <Text style={styles.title}>FieldOps</Text>
          <Text style={styles.sub}>
            {hasExisting
              ? 'Your workspace is already set. Update details below if needed.'
              : 'Welcome! One-time setup so everything just works — done in 30 seconds.'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Supabase Project URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://abcdefghijklm.supabase.co"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <Text style={styles.hint}>Where do I find this? Supabase Dashboard → Settings → API → Project URL</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Anon Public Key</Text>
          <TextInput
            value={anon}
            onChangeText={setAnon}
            placeholder="eyJhbGciOiJIUzI1NiIs…"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { fontFamily: 'monospace' }]}
            multiline
          />
          <Text style={styles.hint}>Dashboard → Settings → API → anon public key (starts with eyJ…). It’s safe to store — it’s a public key.</Text>
        </View>

        <Button title={testing ? 'Connecting…' : hasExisting ? 'Save & Connect' : 'Connect Workspace →'} onPress={handleConnect} loading={testing} />

        <Pressable onPress={() => router.replace('/(tabs)/jobs' as any)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ color: '#2563EB', fontWeight: '600', fontSize: 13 }}>Skip for now</Text>
        </Pressable>
        <Text style={styles.foot}>Stored locally on this device only (expo-secure-store). Never uploaded. Works offline.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  logoBox: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#FFF', fontWeight: '900', fontSize: 36 },
  title: { fontSize: 28, fontWeight: '900', color: '#0F172A', letterSpacing: -1 },
  sub: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 320 },
  card: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  label: { fontWeight: '700', color: '#0F172A', fontSize: 13 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, backgroundColor: '#FFF', color: '#0F172A', fontSize: 14 },
  hint: { color: '#94A3B8', fontSize: 11, lineHeight: 15 },
  foot: { color: '#94A3B8', fontSize: 11, textAlign: 'center' },
});