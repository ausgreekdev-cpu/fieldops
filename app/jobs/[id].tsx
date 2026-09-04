import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking, Modal, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Button } from '@/components/ui/Button';
import { VoiceButton } from '@/components/ui/VoiceButton';
import { ChecklistForm } from '@/features/checklists/ChecklistForm';
import { useChecklists, useChecklistSubmissions } from '@/features/checklists/useChecklists';
import { generateInvoiceLocally, shareInvoicePdf } from '@/features/invoices/generateInvoice';
import { PhotoGallery } from '@/components/ui/PhotoGallery';
import { JobEditModal } from '@/components/ui/JobEditModal';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { updateJobStatus } from '@/sync/mutations';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = React.useState<any>(null);
  const [companyId, setCompanyId] = React.useState<string | undefined>(undefined);
  const [showChecklist, setShowChecklist] = React.useState(false);
  const [activeTemplateId, setActiveTemplateId] = React.useState<string | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [photoTick, setPhotoTick] = React.useState(0);

  const { templates } = useChecklists(companyId);
  const { subs, refresh: refreshSubs } = useChecklistSubmissions(id as string);

  const activeTemplate = templates.find(t => t.id === activeTemplateId) ?? templates[0];

  const load = React.useCallback(async () => {
    try {
      const db = getRawDb();
      const row = await db.getFirstAsync(`SELECT * FROM jobs WHERE id=?`, [id as string]);
      setJob(row);
      if (row) {
        const cid = (row as any).company_id ?? (row as any).companyId;
        if (cid) setCompanyId(cid);
      }
    } catch (e) {
      console.warn(e);
      const supabase = getSupabase();
      const { data } = await supabase.from('jobs').select('*').eq('id', id as string).single();
      setJob(data);
      if (data) setCompanyId((data as any).company_id);
    }
    refreshSubs();
  }, [id, refreshSubs]);

  React.useEffect(() => { load(); }, [load]);

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera permission needed'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    const filename = `job_${id}_${Date.now()}.jpg`;
    const dest = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    const cid = job?.company_id ?? job?.companyId ?? companyId;
    if (!cid) { Alert.alert('Missing company — sync first'); return; }
    const storagePath = `${cid}/${id}/${filename}`;
    const mgr = SyncManager.getInstance(getSupabase());
    await mgr.queueFileUpload(id as string, cid, dest, storagePath);
    setPhotoTick(t => t + 1);
    Alert.alert('Photo saved offline', 'Will upload when back online');
  }

  async function captureReceipt() {
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
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
      await load();
    } catch (e: any) {
      Alert.alert('Parse failed (offline?)', e.message + '\nPhoto saved locally — retry when online.');
    }
  }

  if (!job) return <View style={styles.wrap}><Text style={styles.muted}>Loading job…</Text></View>;

  const status = job.status ?? 'scheduled';
  const cid = job.company_id ?? job.companyId ?? companyId ?? '';

  return (
    <>
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{job.title}</Text>
              <Text style={styles.customer}>{job.customer_name ?? job.customerName}</Text>
              <Text style={styles.addr}>{job.address}</Text>
            </View>
            <Pressable onPress={() => setShowEdit(true)} style={styles.editBtn}><Text style={styles.editText}>Edit</Text></Pressable>
          </View>
          <View style={styles.row}>
            <Text style={[styles.badge, badgeStyle(status)]}>{status.toUpperCase().replace('_', ' ')}</Text>
            {job.scheduled_at ? <Text style={styles.muted}>{new Date(job.scheduled_at).toLocaleString()}</Text> : null}
          </View>
          {job.notes ? <Text style={styles.notes}>{job.notes}</Text> : null}
        </View>

        <View style={styles.actions}>
          <Button title={status === 'scheduled' ? 'Start Job' : status === 'in_progress' ? 'Mark Completed' : status === 'completed' ? 'Generate Invoice (Offline)' : 'View Invoice'} onPress={async () => {
            if (status === 'scheduled') await updateJobStatus(id as string, 'in_progress');
            else if (status === 'in_progress') await updateJobStatus(id as string, 'completed');
            else if (status === 'completed') {
              try {
                const cid2 = cid || (job.company_id ?? job.companyId);
                if (!cid2) throw new Error('No company');
                const { pdfUri, number } = await generateInvoiceLocally({ jobId: id as string, companyId: cid2 });
                Alert.alert('Invoice created offline', `${number} — ${pdfUri}\nWill sync + upload when online. Share now?`, [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Share PDF', onPress: () => shareInvoicePdf(pdfUri, number) },
                ]);
              } catch (e: any) { Alert.alert('Invoice failed', e.message); }
            } else {
              router.push('/(tabs)/invoices' as any);
            }
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

        {/* Safety Checklists */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Safety Checklists</Text>
          <Text style={styles.hint}>Pre-start + compliance — photo proof + signature, offline-first</Text>
          {subs.length > 0 && (
            <View style={{ gap: 8, marginTop: 8 }}>
              {subs.map((s: any) => (
                <View key={s.id} style={styles.subRow}>
                  <Text style={[styles.subBadge, s.result === 'pass' ? styles.subPass : s.result === 'fail' ? styles.subFail : styles.subPending]}>{s.result.toUpperCase()}</Text>
                  <Text style={styles.subText}>{new Date(s.created_at).toLocaleString()} — {s.checklist_id.slice(0, 8)}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ gap: 8, marginTop: 12 }}>
            {templates.length === 0 ? (
              <Text style={styles.muted}>No templates — check Safety tab (defaults seed automatically)</Text>
            ) : (
              <View style={styles.templateChips}>
                {templates.map(t => (
                  <Pressable key={t.id} onPress={() => { setActiveTemplateId(t.id); setShowChecklist(true); }} style={[styles.chip, activeTemplateId === t.id && styles.chipActive]}>
                    <Text style={[styles.chipText, activeTemplateId === t.id && styles.chipTextActive]}>{t.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Button title="▶ Run Checklist" onPress={() => { if (!templates[0]) { Alert.alert('No templates', 'Go to Safety tab to seed'); return; } setActiveTemplateId(templates[0].id); setShowChecklist(true); }} />
          </View>
        </View>

        <VoiceButton jobId={id as string} companyId={cid} onResult={load} />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Evidence (offline-first)</Text>
          <PhotoGallery jobId={id as string} refreshKey={photoTick} />
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

      <Modal visible={showChecklist} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowChecklist(false)}>
        <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
            <Text style={{ fontWeight: '900', color: '#0F172A' }}>Run Checklist</Text>
            <Pressable onPress={() => setShowChecklist(false)}><Text style={{ color: '#2563EB', fontWeight: '700' }}>Close</Text></Pressable>
          </View>
          {activeTemplate && cid ? (
            <ChecklistForm template={activeTemplate} jobId={id as string} companyId={cid} onSubmitted={async () => { setShowChecklist(false); await load(); }} onCancel={() => setShowChecklist(false)} />
          ) : (
            <View style={{ padding: 24 }}><Text style={styles.muted}>No template / company — check setup</Text></View>
          )}
        </View>
      </Modal>
      <JobEditModal visible={showEdit} job={job} onClose={() => setShowEdit(false)} onSaved={load} />
    </>
  );
}

function badgeStyle(s: string) {
  const map: any = { scheduled: { backgroundColor: '#E2E8F0', color: '#475569' }, in_progress: { backgroundColor: '#DBEAFE', color: '#1D4ED8' }, completed: { backgroundColor: '#DCFCE7', color: '#15803D' }, invoiced: { backgroundColor: '#EDE9FE', color: '#6D28D9' } };
  return map[s] ?? {};
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  editText: { fontWeight: '700', color: '#0F172A', fontSize: 12 },
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
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', padding: 8, borderRadius: 8 },
  subBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontWeight: '800', fontSize: 11, overflow: 'hidden' },
  subPass: { backgroundColor: '#DCFCE7', color: '#15803D' },
  subFail: { backgroundColor: '#FEE2E2', color: '#DC2626' },
  subPending: { backgroundColor: '#FEF3C7', color: '#92400E' },
  subText: { color: '#475569', fontSize: 12 },
  templateChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFF' },
  chipActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  chipText: { fontWeight: '700', color: '#475569', fontSize: 12 },
  chipTextActive: { color: '#FFF' },
});
