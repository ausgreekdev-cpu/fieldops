import * as React from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';
import { getRawDb } from '@/db/client';

export default function OnboardingScreen() {
  const [name, setName] = React.useState('');
  const [abn, setAbn] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    if (!name.trim()) { Alert.alert('Company name required'); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create company via supabase (RLS allows insert)
      const { data: company, error } = await supabase.from('companies').insert({ name: name.trim(), abn: abn.trim() || null }).select('id').single();
      if (error) throw error;

      const { error: uErr } = await supabase.from('users').update({ company_id: company.id, display_name: name.trim(), role: 'owner' }).eq('id', user.id);
      if (uErr) throw uErr;

      // Also cache locally for offline + seed demo data
      try {
        const db = getRawDb();
        const now = new Date().toISOString();
        await db.runAsync(`INSERT INTO companies (id, name, abn, created_at, updated_at, synced) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name`, [company.id, name.trim(), abn.trim(), now, now]);
        const { seedDefaultChecklists, seedDemoJobs } = await import('@/db/seed');
        await seedDefaultChecklists(company.id);
        await seedDemoJobs(company.id, user.id);
      } catch (e) { console.warn('[onboarding seed]', e); }

      router.replace('/(tabs)/jobs');
    } catch (e: any) {
      Alert.alert('Setup failed', e.message);
    } finally { setLoading(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Set up your business</Text>
      <Text style={styles.sub}>60 seconds — you can change this later</Text>

      <Text style={styles.label}>Company Name *</Text>
      <TextInput value={name} onChangeText={setName} placeholder="e.g. Smith Electrical" style={styles.input} placeholderTextColor="#94A3B8" />

      <Text style={styles.label}>ABN / Tax ID (optional)</Text>
      <TextInput value={abn} onChangeText={setAbn} placeholder="12 345 678 901" keyboardType="number-pad" style={styles.input} placeholderTextColor="#94A3B8" />

      <View style={{ height: 12 }} />
      <Button title="Create workspace →" onPress={submit} loading={loading} />

      <Text style={styles.foot}>Offline-ready. No card required for free tier.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, backgroundColor: '#FFF', padding: 24, paddingTop: 64, gap: 8 },
  title: { fontSize: 26, fontWeight: '900', color: '#0F172A' },
  sub: { color: '#64748B', marginBottom: 16 },
  label: { fontWeight: '700', color: '#334155', marginTop: 8, fontSize: 13 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 16, height: 52, fontSize: 15, backgroundColor: '#F8FAFC', color: '#0F172A' },
  foot: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 },
});
