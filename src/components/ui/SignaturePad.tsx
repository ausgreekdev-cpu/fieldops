import * as React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import * as FileSystem from 'expo-file-system';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';

interface Props {
  jobId: string;
  companyId: string;
  checklistId?: string;
  onSigned?: (info: { path: string; localUri: string; signedByName: string }) => void;
  signerName?: string; // default to current user
}

// Offline-first: signature saved to FileSystem immediately, queued to Storage/Supabase via outbox
export function SignaturePad({ jobId, companyId, onSigned, signerName = 'Site Operator' }: Props) {
  const [visible, setVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const sigRef = React.useRef<any>(null);

  const style = `.m-signature-pad {box-shadow: none; border: none; } .m-signature-pad--body {border: 1.5px solid #CBD5E1; border-radius: 12px;} .m-signature-pad--footer {display:none;}`;

  async function handleOK(signature: string) {
    // signature is base64 PNG data URL: "data:image/png;base64,..."
    try {
      setSaving(true);
      const base64 = signature.replace('data:image/png;base64,', '');
      const filename = `sig_${jobId}_${Date.now()}.png`;
      const localUri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });

      const storagePath = `${companyId}/${jobId}/${filename}`;

      // Persist row locally in job_signatures for offline visibility
      const { getRawDb } = await import('@/db/client');
      const db = getRawDb();
      const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO job_signatures (id, job_id, company_id, storage_path, signed_by_name, signed_at, synced) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [id, jobId, companyId, storagePath, signerName, now]
      );

      // Also create a generic outbox entry for upload + Supabase insert
      // We reuse SyncManager.queueFileUpload semantics but for signatures table
      // Store localUri in outbox payload so syncRow can upload
      const mgr = SyncManager.getInstance(getSupabase());
      await mgr.enqueue('job_signatures' as any, id, 'insert', {
        id,
        job_id: jobId,
        company_id: companyId,
        storage_path: storagePath,
        local_uri: localUri,
        signed_by_name: signerName,
        signed_at: now,
      });

      setVisible(false);
      onSigned?.({ path: storagePath, localUri, signedByName: signerName });
      Alert.alert('Signature saved offline', 'Will sync when back online');
    } catch (e: any) {
      Alert.alert('Signature failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    sigRef.current?.clearSignature();
  }

  if (!visible) {
    return (
      <Pressable onPress={() => setVisible(true)} style={styles.trigger} hitSlop={8}>
        <Text style={styles.triggerText}>✍️ Tap to Sign</Text>
        <Text style={styles.triggerSub}>Photo proof + timestamped log</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Sign below — use finger / stylus</Text>
      <View style={styles.padWrap}>
        <SignatureScreen
          ref={sigRef}
          onOK={handleOK}
          onEmpty={() => Alert.alert('Empty signature', 'Please sign before confirming')}
          descriptionText=""
          clearText="Clear"
          confirmText={saving ? 'Saving…' : 'Confirm'}
          webStyle={style}
          autoClear={false}
          imageType="image/png"
          dataURL="data:image/png;base64,"
        />
      </View>
      <View style={styles.row}>
        <Pressable onPress={handleClear} style={[styles.btn, styles.btnSecondary]}><Text style={styles.btnTextSecondary}>Clear</Text></Pressable>
        <Pressable onPress={() => sigRef.current?.readSignature()} style={[styles.btn, styles.btnPrimary]} disabled={saving}><Text style={styles.btnTextPrimary}>{saving ? 'Saving…' : 'Confirm & Save Offline'}</Text></Pressable>
      </View>
      <Pressable onPress={() => setVisible(false)} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    minHeight: 72,
    justifyContent: 'center',
  },
  triggerText: { fontWeight: '800', color: '#0F172A', fontSize: 15 },
  triggerSub: { color: '#64748B', fontSize: 12, marginTop: 2 },
  wrap: { backgroundColor: '#FFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  label: { fontWeight: '700', color: '#0F172A', fontSize: 13 },
  padWrap: { height: 200, overflow: 'hidden', borderRadius: 12, backgroundColor: '#FFF' },
  row: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#0F172A' },
  btnSecondary: { backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#CBD5E1' },
  btnTextPrimary: { color: '#FFF', fontWeight: '800' },
  btnTextSecondary: { color: '#0F172A', fontWeight: '700' },
  cancel: { alignItems: 'center', padding: 8 },
  cancelText: { color: '#64748B', fontWeight: '600' },
});
