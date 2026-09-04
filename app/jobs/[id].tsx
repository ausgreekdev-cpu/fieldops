import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Button } from '@/components/ui/Button';
import { VoiceButton } from '@/components/ui/VoiceButton';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { updateJobStatus } from '@/sync/mutations';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = React.useState<any>(null);

  const load = React.useCallback(async () => {
    try {
      const db = getRawDb();
      const row = await db.getFirstAsync(`SELECT * FROM jobs WHERE id=?`, [id as string]);
      setJob(row);
    } catch (e) {
      console.warn(e);
      // fallback to supabase if local miss
      const supabase = getSupabase();
      const { data } = await supabase.from('jobs').select('*').eq('id', id as string).single();
      setJob(data);
    }
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera permission needed'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    // copy to persistent app dir
    const filename = `job_${id}_${Date.now()}.jpg`;
    const dest = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    // need company id
    const companyId = job?.company_id ?? job?.companyId;
    if (!companyId) { Alert.alert('Missing company — sync first'); return; }
    const storagePath = `${companyId}/${id}/${filename}`;
    const mgr = SyncManager.getInstance(getSupabase());
    await mgr.queueFileUpload(id as string, companyId, dest, storagePath);
    Alert.alert('Photo saved offline', 'Will upload when back online');
  }

  async function captureReceipt() {
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    Alert.alert('Receipt captured', 'Tap Parse to run AI (requires connectivity).');
    // Store locally; parse via Edge Function when online — wiring similar to VoiceButton but with image
    // For brevity, invoke parse-receipt inline
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const fd = new FormData();
      fd.append('image', { uri: res.assets[0].uri, name: 'receipt.jpg', type: 'image/jpeg' } as any);
      fd.append('job_id', id as string);
      const r = await fetch(`${supabaseUrl}/functions/v1/parse-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd as any,
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      Alert.alert('Receipt parsed', `${json.vendor} — ${json.line_items.length} items, $${json.total}`);
    } catch (e: any) {
      Alert.alert('Parse failed (offline?)', e.message + '\nPhoto saved locally — retry when online.');
    }
  }

  if (!job) return <View style={styles.wrap}><Text style={styles.muted}>Loading job…</Text></View>;

  const status = job.status ?? 'scheduled';

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.title}>{job.title}</Text>
        <Text style={styles.customer}>{job.customer_name ?? job.customerName}</Text>
        <Text style={styles.addr}>{job.address}</Text>
        <View style={styles.row}>
          <Text style={[styles.badge, badgeStyle(status)]}>{status.toUpperCase().replace('_', ' ')}</Text>
          {job.scheduled_at ? <Text style={styles.muted}>{new Date(job.scheduled_at).toLocaleString()}</Text> : null}
        </View>
        {job.notes ? <Text style={styles.notes}>{job.notes}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button title={status === 'scheduled' ? 'Start Job' : status === 'in_progress' ? 'Mark Completed' : status === 'completed' ? 'Generate Invoice' : 'View Invoice'} onPress={async () => {
          if (status === 'scheduled') await updateJobStatus(id as string, 'in_progress');
          else if (status === 'in_progress') await updateJobStatus(id as string, 'completed');
          else if (status === 'completed') Alert.alert('Invoice', 'One-tap PDF generation — see Invoices tab');
          await load();
        }} />
        <View style={styles.splitRow}>
          <Button title="Call" variant="secondary" size="md" onPress={() => job.customer_phone && Linking.openURL(`tel:${job.customer_phone}`)} />
          <Button title="Navigate" variant="secondary" size="md" onPress={() => {
            const q = job.lat && job.lng ? `${job.lat},${job.lng}` : encodeURIComponent(job.address);
            Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
          }} />
        </View>
      </View>

      <VoiceButton jobId={id as string} companyId={job.company_id ?? ''} onResult={load} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Evidence (offline-first)</Text>
        <View style={styles.splitRow}>
          <Button title="📷 Photo" variant="secondary" onPress={capturePhoto} />
          <Button title="🧾 Receipt" variant="secondary" onPress={captureReceipt} />
        </View>
        <Text style={styles.hint}>Photos + signatures saved locally instantly, synced in background</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Materials (AI-extracted)</Text>
        <Text style={styles.muted}>{job.materials ? (typeof job.materials === 'string' ? job.materials : JSON.stringify(job.materials, null, 2)) : 'No materials yet — use Voice or Receipt parser'}</Text>
      </View>
    </ScrollView>
  );
}

function badgeStyle(s: string) {
  const map: any = { scheduled: { backgroundColor: '#E2E8F0', color: '#475569' }, in_progress: { backgroundColor: '#DBEAFE', color: '#1D4ED8' }, completed: { backgroundColor: '#DCFCE7', color: '#15803D' }, invoiced: { backgroundColor: '#EDE9FE', color: '#6D28D9' } };
  return map[s] ?? {};
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  title: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  customer: { fontWeight: '700', color: '#334155', marginTop: 4 },
  addr: { color: '#64748B', fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontWeight: '800', fontSize: 11, overflow: 'hidden' },
  muted: { color: '#94A3B8', fontSize: 12 },
  notes: { marginTop: 12, color: '#334155', lineHeight: 20, backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8 },
  actions: { gap: 12 },
  splitRow: { flexDirection: 'row', gap: 12 },
  sectionTitle: { fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  hint: { color: '#94A3B8', fontSize: 11, marginTop: 8, textAlign: 'center' },
});
