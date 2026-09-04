import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Button } from '@/components/ui/Button';
import { SignaturePad } from '@/components/ui/SignaturePad';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import type { ChecklistField, ChecklistTemplate } from '@/types';

interface Props {
  template: ChecklistTemplate;
  jobId: string;
  companyId: string;
  onSubmitted?: () => void;
  onCancel?: () => void;
}

function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'? r : (r&0x3)|0x8; return v.toString(16); }); }

export function ChecklistForm({ template, jobId, companyId, onSubmitted, onCancel }: Props) {
  const [responses, setResponses] = React.useState<Record<string, any>>({});
  const [photoUris, setPhotoUris] = React.useState<Record<string, string>>({});
  const [signed, setSigned] = React.useState<{ path: string; signer: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function setResp(key: string, val: any) { setResponses(prev => ({ ...prev, [key]: val })); }

  async function capturePhoto(fieldKey: string) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera permission needed'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    // copy to persistent dir
    const dest = `${FileSystem.documentDirectory}check_${jobId}_${fieldKey}_${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    setPhotoUris(prev => ({ ...prev, [fieldKey]: dest }));
    setResp(fieldKey, dest); // store local path interim; replaced with storage path on sync
  }

  function validate(): string | null {
    for (const f of template.fields) {
      if (f.required) {
        const v = responses[f.key];
        if (v === undefined || v === null || v === '' ) {
          // photo field uses photoUris
          if (f.type === 'photo' && photoUris[f.key]) continue;
          return `Required: ${f.label}`;
        }
        if (f.type === 'pass_fail' && v !== 'pass' && v !== 'fail') return `Required: ${f.label}`;
      }
    }
    if (!signed) return 'Signature required to submit';
    return null;
  }

  function computeResult(): 'pass' | 'fail' | 'pending' {
    // Any required pass_fail = fail => overall fail
    for (const f of template.fields) {
      if (f.type === 'pass_fail' && responses[f.key] === 'fail') return 'fail';
    }
    // If all pass_fail are pass => pass else pending
    const pf = template.fields.filter(f => f.type === 'pass_fail');
    if (pf.length > 0 && pf.every(f => responses[f.key] === 'pass')) return 'pass';
    return pf.length >0 ? 'pending' : 'pass';
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { Alert.alert('Incomplete', err); return; }
    setSubmitting(true);
    try {
      const db = getRawDb();
      const id = uuid();
      const now = new Date().toISOString();
      const result = computeResult();

      // Prepare photo_proofs: copy each photo to final storage path tracking
      const photoProofPaths: string[] = [];
      const mgr = SyncManager.getInstance(getSupabase());

      for (const [key, localUri] of Object.entries(photoUris)) {
        const filename = `check_${jobId}_${key}_${Date.now()}.jpg`;
        const storagePath = `${companyId}/${jobId}/${filename}`;
        photoProofPaths.push(storagePath);
        // Write a job_photos-like local entry for visibility? Use checklist photo_proofs array + also queue upload via outbox as generic
        // We will store mapping in responses for audit and upload via outbox as checklist_submissions with payload containing storagePath
        // For actual file upload, enqueue a synthetic job_photos entry? Simpler: handle upload in SyncManager extension for submissions
        // For now, store localUri in responses and let submission sync upload files
      }

      // Build responses with serializable values (photos replaced with placeholder paths)
      const sanitizedResponses: Record<string, any> = { ...responses };
      for (const k of Object.keys(photoUris)) {
        // keep original local path for offline view, but submission payload will have storage mapping
        sanitizedResponses[k] = photoUris[k];
      }

      // Insert locally — offline-first
      await db.runAsync(
        `INSERT INTO checklist_submissions (id, job_id, checklist_id, company_id, responses, photo_proofs, signed_by, signed_at, result, created_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [id, jobId, template.id, companyId, JSON.stringify(sanitizedResponses), JSON.stringify(photoProofPaths), signed!.signer, now, result, now]
      );

      // Enqueue for sync (payload includes photo local mappings for uploader)
      await mgr.enqueue('checklist_submissions' as any, id, 'insert', {
        id, job_id: jobId, checklist_id: template.id, company_id: companyId,
        responses: sanitizedResponses, photo_proofs: photoProofPaths, signed_by: signed!.signer, signed_at: now, result, created_at: now,
        _localPhotoMap: photoUris // private field for uploader to map local->storage
      });

      // Also queue each photo file upload individually by reusing job_photos logic (upload to job-photos bucket)
      for (const [key, localUri] of Object.entries(photoUris)) {
        const storagePath = photoProofPaths.find(p => p.includes(key)) ?? `${companyId}/${jobId}/check_${key}_${Date.now()}.jpg`;
        // Create a ephemeral outbox for file — we piggyback on syncRow handling for submissions? Instead directly upload via storage when online
        // For now enqueue as job_photos as well for visibility
        const photoId = `chkphoto_${id}_${key}`;
        const now2 = new Date().toISOString();
        await db.runAsync(`INSERT OR IGNORE INTO job_photos (id, job_id, company_id, storage_path, local_uri, taken_at, synced) VALUES (?, ?, ?, ?, ?, ?, 0)`, [photoId, jobId, companyId, storagePath, localUri, now2]);
        await mgr.enqueue('job_photos' as any, photoId, 'insert', { id: photoId, job_id: jobId, company_id: companyId, storage_path: storagePath, local_uri: localUri, taken_at: now2 });
      }

      Alert.alert(result === 'pass' ? 'Checklist Passed ✓' : result === 'fail' ? 'Checklist Failed — action required' : 'Checklist Submitted', `Result: ${result.toUpperCase()}\nSaved offline, will sync when online.`);
      onSubmitted?.();
    } catch (e: any) {
      Alert.alert('Submit failed', e.message);
    } finally { setSubmitting(false); }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={styles.header}>
        <Text style={styles.title}>{template.name}</Text>
        {template.description ? <Text style={styles.desc}>{template.description}</Text> : null}
        <Text style={styles.hint}>All data saved offline first. Photo + signature timestamped.</Text>
      </View>

      {template.fields.map(field => (
        <View key={field.key} style={styles.fieldCard}>
          <Text style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>

          {field.type === 'pass_fail' && (
            <View style={styles.row}>
              {(['pass','fail'] as const).map(v => (
                <Pressable key={v} onPress={() => setResp(field.key, v)} style={[styles.pfBtn, responses[field.key]===v && (v==='pass'? styles.pfPass : styles.pfFail)]}>
                  <Text style={[styles.pfText, responses[field.key]===v && styles.pfTextActive]}>{v.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {field.type === 'checkbox' && (
            <Pressable onPress={() => setResp(field.key, !responses[field.key])} style={styles.checkRow}>
              <View style={[styles.checkbox, responses[field.key] && styles.checkboxOn]}>{responses[field.key] ? <Text style={styles.checkTick}>✓</Text> : null}</View>
              <Text style={styles.checkLabel}>{responses[field.key] ? 'Yes' : 'No'}</Text>
            </Pressable>
          )}

          {field.type === 'text' && (
            <TextInput value={responses[field.key] ?? ''} onChangeText={v=>setResp(field.key, v)} placeholder="Enter details" placeholderTextColor="#94A3B8" style={styles.input} multiline />
          )}

          {field.type === 'select' && (
            <View style={styles.selectWrap}>
              {(field.options ?? []).map(opt => (
                <Pressable key={opt} onPress={()=>setResp(field.key, opt)} style={[styles.selectOpt, responses[field.key]===opt && styles.selectOptActive]}>
                  <Text style={[styles.selectText, responses[field.key]===opt && styles.selectTextActive]}>{opt}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {field.type === 'photo' && (
            <View style={{ gap: 8 }}>
              {photoUris[field.key] ? <Image source={{ uri: photoUris[field.key] }} style={styles.preview} /> : null}
              <Button title={photoUris[field.key] ? 'Retake Photo' : '📷 Capture Photo Proof'} variant="secondary" size="sm" onPress={()=>capturePhoto(field.key)} />
            </View>
          )}
        </View>
      ))}

      <View style={styles.sigCard}>
        <Text style={styles.label}>Sign-off *</Text>
        {!signed ? (
          <SignaturePad jobId={jobId} companyId={companyId} onSigned={({ path, signedByName })=> setSigned({ path, signer: signedByName })} signerName="Site Operator" />
        ) : (
          <View style={styles.signedBox}>
            <Text style={styles.signedText}>✓ Signed by {signed.signer}</Text>
            <Text style={styles.signedSub}>{signed.path}</Text>
            <Pressable onPress={()=>setSigned(null)}><Text style={styles.resign}>Re-sign</Text></Pressable>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
        <Button title={submitting ? 'Submitting…' : 'Submit Checklist (Offline)'} onPress={handleSubmit} loading={submitting} />
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 },
  title: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  desc: { color: '#475569', fontSize: 13 },
  hint: { color: '#94A3B8', fontSize: 11, marginTop: 4 },
  fieldCard: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 10 },
  label: { fontWeight: '700', color: '#0F172A', fontSize: 13 },
  row: { flexDirection: 'row', gap: 12 },
  pfBtn: { flex: 1, height: 48, borderRadius: 10, borderWidth: 1.5, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' },
  pfPass: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  pfFail: { backgroundColor: '#FEE2E2', borderColor: '#DC2626' },
  pfText: { fontWeight: '800', color: '#64748B' },
  pfTextActive: { color: '#0F172A' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 28, height: 28, borderRadius: 6, borderWidth: 1.5, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  checkTick: { color: '#FFF', fontWeight: '900' },
  checkLabel: { fontWeight: '700', color: '#334155' },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, minHeight: 48, color: '#0F172A', backgroundColor: '#F8FAFC', textAlignVertical: 'top' },
  selectWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectOpt: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFF' },
  selectOptActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  selectText: { fontWeight: '700', color: '#475569', fontSize: 12 },
  selectTextActive: { color: '#FFF' },
  preview: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#F1F5F9' },
  sigCard: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  signedBox: { backgroundColor: '#F0FDF4', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#BBF7D0', gap: 4 },
  signedText: { fontWeight: '800', color: '#15803D' },
  signedSub: { color: '#64748B', fontSize: 11 },
  resign: { color: '#2563EB', fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
});
