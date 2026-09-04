import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { jobCreateSchema } from '@/lib/validation';

function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'? r : (r&0x3)|0x8; return v.toString(16); }); }

export default function NewJobScreen() {
  const [title, setTitle] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    const parsed = jobCreateSchema.safeParse({ title, customerName, customerPhone: phone, address, notes });
    if (!parsed.success) {
      Alert.alert('Validation', parsed.error.issues.map(i => i.message).join('\n'));
      return;
    }
    setSaving(true);
    try {
      const db = getRawDb();
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      let companyId: string | null = null;
      if (user) {
        const { data } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        companyId = (data as any)?.company_id ?? null;
      }
      if (!companyId) {
        const row = (await db.getFirstAsync(`SELECT company_id as cid FROM users LIMIT 1`)) as any;
        companyId = row?.cid ?? null;
      }
      if (!companyId) {
        const row2 = (await db.getFirstAsync(`SELECT id FROM companies LIMIT 1`)) as any;
        companyId = row2?.id ?? null;
      }
      if (!companyId) throw new Error('No company — complete onboarding first (Business Setup <60s)');

      const id = uuid();
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO jobs (id, local_id, company_id, assigned_to, customer_name, customer_phone, address, title, description, status, scheduled_at, materials, notes, version, created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, '[]', ?, 1, ?, ?, 0)`,
        [id, id, companyId, user?.id ?? null, customerName.trim(), phone.trim() || null, address.trim(), title.trim(), notes.trim() || null, now, notes.trim() || null, now, now]
      );

      const mgr = SyncManager.getInstance(getSupabase());
      await mgr.enqueue('jobs', id, 'insert', {
        id, local_id: id, company_id: companyId, assigned_to: user?.id ?? null,
        customer_name: customerName.trim(), customer_phone: phone.trim() || null, address: address.trim(),
        title: title.trim(), description: notes.trim() || null, status: 'scheduled', scheduled_at: now, materials: [], notes: notes.trim() || null,
        version: 1, created_at: now, updated_at: now,
      });

      Alert.alert('Job created offline ✓', 'Shows instantly, syncs when back online');
      router.replace(`/jobs/${id}` as any);
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally { setSaving(false); }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New Job', presentation: 'card', headerShown: true, headerBackTitle: 'Jobs' }} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New Job</Text>
        <Text style={styles.hint}>Large touch targets • Smart defaults • Works fully offline</Text>

        <Text style={styles.label}>Job Title *</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Switchboard upgrade — 12 Smith St" placeholderTextColor="#94A3B8" style={styles.input} />

        <Text style={styles.label}>Customer Name *</Text>
        <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Jane Smith" placeholderTextColor="#94A3B8" style={styles.input} />

        <Text style={styles.label}>Phone (tap-to-call)</Text>
        <TextInput value={phone} onChangeText={setPhone} placeholder="+61 4XX XXX XXX" keyboardType="phone-pad" placeholderTextColor="#94A3B8" style={styles.input} />

        <Text style={styles.label}>Address * (tap-to-navigate)</Text>
        <TextInput value={address} onChangeText={setAddress} placeholder="12 Smith St, Perth WA 6000" placeholderTextColor="#94A3B8" style={[styles.input, { minHeight: 56 }]} multiline />

        <Text style={styles.label}>Notes</Text>
        <TextInput value={notes} onChangeText={setNotes} placeholder="Access code 1234, parking rear…" placeholderTextColor="#94A3B8" style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]} multiline />

        <View style={{ height: 8 }} />
        <Button title={saving ? 'Saving…' : 'Create Job (Offline)'} onPress={handleSave} loading={saving} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        <Text style={styles.foot}>Status starts at Scheduled → tap Start Job on detail. All queued to outbox with exponential backoff.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  hint: { color: '#64748B', fontSize: 12 },
  label: { fontWeight: '700', color: '#334155', fontSize: 12, marginTop: 4 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFF', color: '#0F172A', fontSize: 15, minHeight: 48 },
  foot: { color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
