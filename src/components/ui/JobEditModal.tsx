import * as React from 'react';
import { View, Text, StyleSheet, Modal, TextInput, Pressable, Alert } from 'react-native';
import { Button } from './Button';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { jobCreateSchema } from '@/lib/validation';

interface Props { visible: boolean; onClose: () => void; job: any; onSaved: () => void; }

export function JobEditModal({ visible, onClose, job, onSaved }: Props) {
  const [title, setTitle] = React.useState(job?.title ?? '');
  const [customerName, setCustomerName] = React.useState(job?.customer_name ?? '');
  const [phone, setPhone] = React.useState(job?.customer_phone ?? '');
  const [address, setAddress] = React.useState(job?.address ?? '');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (job) {
      setTitle(job.title ?? '');
      setCustomerName(job.customer_name ?? job.customerName ?? '');
      setPhone(job.customer_phone ?? '');
      setAddress(job.address ?? '');
    }
  }, [job]);

  async function handleSave() {
    const parsed = jobCreateSchema.safeParse({ title, customerName, customerPhone: phone, address, notes: job?.notes ?? '' });
    if (!parsed.success) { Alert.alert('Validation', parsed.error.issues.map(i=>i.message).join('\n')); return; }
    setSaving(true);
    try {
      const db = getRawDb();
      const now = new Date().toISOString();
      await db.runAsync(`UPDATE jobs SET title=?, customer_name=?, customer_phone=?, address=?, updated_at=?, synced=0, version=version+1 WHERE id=?`,
        [title.trim(), customerName.trim(), phone.trim() || null, address.trim(), now, job.id]);
      const mgr = SyncManager.getInstance(getSupabase());
      await mgr.enqueue('jobs', job.id, 'update', { id: job.id, title: title.trim(), customer_name: customerName.trim(), customer_phone: phone.trim() || null, address: address.trim(), updated_at: now });
      Alert.alert('Saved offline ✓', 'Will sync when back online');
      onSaved();
      onClose();
    } catch (e:any) { Alert.alert('Save failed', e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    Alert.alert('Delete job?', 'This will soft-delete locally and sync when online', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const db = getRawDb();
        const now = new Date().toISOString();
        await db.runAsync(`UPDATE jobs SET deleted_at=?, synced=0, updated_at=? WHERE id=?`, [now, now, job.id]);
        const mgr = SyncManager.getInstance(getSupabase());
        await mgr.enqueue('jobs', job.id, 'delete', { id: job.id, deleted_at: now });
        onSaved();
        onClose();
      }}
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Job</Text>
          <Pressable onPress={onClose}><Text style={styles.close}>✕</Text></Pressable>
        </View>
        <View style={styles.body}>
          <Text style={styles.label}>Title *</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>Customer *</Text>
          <TextInput value={customerName} onChangeText={setCustomerName} style={styles.input} placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>Phone</Text>
          <TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad" placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>Address *</Text>
          <TextInput value={address} onChangeText={setAddress} style={[styles.input, { minHeight: 56 }]} multiline placeholderTextColor="#94A3B8" />
          <View style={{ height: 12 }} />
          <Button title={saving ? 'Saving…' : 'Save (Offline)'} onPress={handleSave} loading={saving} />
          <Button title="Delete Job" variant="ghost" onPress={handleDelete} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex:1, backgroundColor:'#F8FAFC' },
  header: { flexDirection:'row', justifyContent:'space-between', padding:16, backgroundColor:'#FFF', borderBottomWidth:1, borderBottomColor:'#E2E8F0' },
  title: { fontWeight:'900', color:'#0F172A', fontSize:16 },
  close: { color:'#64748B', fontSize:18, fontWeight:'800' },
  body: { padding:16, gap:8 },
  label: { fontWeight:'700', color:'#0F172A', fontSize:12, marginTop:4 },
  input: { borderWidth:1.5, borderColor:'#CBD5E1', borderRadius:10, padding:12, backgroundColor:'#FFF', color:'#0F172A' },
});
