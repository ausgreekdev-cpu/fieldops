import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import type { ChecklistField } from '@/types';

const FIELD_TYPES: ChecklistField['type'][] = ['pass_fail', 'checkbox', 'text', 'photo', 'select'];

function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'? r : (r&0x3)|0x8; return v.toString(16); }); }

export default function ChecklistEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [fields, setFields] = React.useState<ChecklistField[]>([
    { key: 'item_1', label: 'Site isolated & locked out', type: 'pass_fail', required: true },
  ]);
  const [loading, setLoading] = React.useState(!isNew);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const db = getRawDb();
        const row = (await db.getFirstAsync(`SELECT name, description, fields FROM compliance_checklists WHERE id=?`, [id as string])) as any;
        if (row) {
          setName(row.name);
          setDesc(row.description ?? '');
          setFields(typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields);
        }
      } catch (e) { console.warn(e); }
      setLoading(false);
    })();
  }, [id]);

  function addField() {
    setFields(prev => [...prev, { key: `field_${Date.now()}`, label: 'New item', type: 'text', required: false }]);
  }
  function updateField(idx: number, patch: Partial<ChecklistField>) {
    setFields(prev => prev.map((f, i) => i===idx ? { ...f, ...patch } : f));
  }
  function removeField(idx: number) {
    setFields(prev => prev.filter((_, i) => i!==idx));
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (fields.length === 0) { Alert.alert('Add at least one field'); return; }
    // normalize keys
    const normalized = fields.map(f => ({ ...f, key: f.key.trim().replace(/\s+/g,'_').toLowerCase() || `field_${uuid().slice(0,4)}` }));
    setSaving(true);
    try {
      const db = getRawDb();
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      let companyId: string | null = null;
      if (user) {
        const { data } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        companyId = data?.company_id ?? null;
      }
      if (!companyId) {
        const row = (await db.getFirstAsync(`SELECT company_id as cid FROM users LIMIT 1`)) as any;
        companyId = row?.cid ?? null;
      }
      if (!companyId) {
        const row2 = (await db.getFirstAsync(`SELECT id FROM companies LIMIT 1`)) as any;
        companyId = row2?.id ?? null;
      }
      if (!companyId) throw new Error('No company found — complete onboarding first');

      const tplId = isNew ? uuid() : (id as string);
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO compliance_checklists (id, company_id, name, description, fields, is_active, synced)
         VALUES (?, ?, ?, ?, ?, 1, 0)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, fields=excluded.fields, synced=0`,
        [tplId, companyId, name.trim(), desc.trim() || null, JSON.stringify(normalized)]
      );

      const mgr = SyncManager.getInstance(getSupabase());
      await mgr.enqueue('compliance_checklists' as any, tplId, isNew ? 'insert' : 'update', {
        id: tplId, company_id: companyId, name: name.trim(), description: desc.trim(), fields: normalized, is_active: true
      });

      Alert.alert('Saved offline', 'Template will sync when online');
      router.back();
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally { setSaving(false); }
  }

  if (loading) return <View style={styles.wrap}><Text style={styles.muted}>Loading…</Text></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.title}>{isNew ? 'New Template' : 'Edit Template'}</Text>
      <Text style={styles.hint}>Custom pass/fail items per job type — changes sync offline-first</Text>

      <Text style={styles.label}>Name *</Text>
      <TextInput value={name} onChangeText={setName} placeholder="e.g. Pre-Start Electrical" placeholderTextColor="#94A3B8" style={styles.input} />

      <Text style={styles.label}>Description</Text>
      <TextInput value={desc} onChangeText={setDesc} placeholder="Mandatory before electrical work" placeholderTextColor="#94A3B8" style={styles.input} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={styles.sectionTitle}>Fields ({fields.length})</Text>
        <Button title="+ Add Field" size="sm" variant="secondary" onPress={addField} />
      </View>

      {fields.map((f, idx) => (
        <View key={idx} style={styles.fieldCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.fieldIdx}>#{idx+1}</Text>
            <Pressable onPress={() => removeField(idx)}><Text style={styles.remove}>Remove</Text></Pressable>
          </View>
          <Text style={styles.label}>Key</Text>
          <TextInput value={f.key} onChangeText={v=>updateField(idx, { key: v })} style={styles.input} autoCapitalize="none" placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>Label *</Text>
          <TextInput value={f.label} onChangeText={v=>updateField(idx, { label: v })} style={styles.input} placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {FIELD_TYPES.map(t => (
              <Pressable key={t} onPress={()=>updateField(idx, { type: t })} style={[styles.typeChip, f.type===t && styles.typeChipActive]}>
                <Text style={[styles.typeText, f.type===t && styles.typeTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          {f.type === 'select' && (
            <>
              <Text style={styles.label}>Options (comma separated)</Text>
              <TextInput value={(f.options ?? []).join(', ')} onChangeText={v=>updateField(idx, { options: v.split(',').map(s=>s.trim()).filter(Boolean) })} placeholder="Clear, Windy, Rain" style={styles.input} placeholderTextColor="#94A3B8" />
            </>
          )}
          <View style={styles.checkRow}>
            <Pressable onPress={()=>updateField(idx, { required: !f.required })} style={[styles.checkbox, f.required && styles.checkboxOn]}>
              {f.required ? <Text style={styles.checkTick}>✓</Text> : null}
            </Pressable>
            <Text style={styles.checkLabel}>Required</Text>
          </View>
        </View>
      ))}

      <Button title={saving ? 'Saving…' : 'Save Template (Offline)'} onPress={handleSave} loading={saving} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  hint: { color: '#94A3B8', fontSize: 12 },
  muted: { color: '#94A3B8', padding: 16 },
  label: { fontWeight: '700', color: '#334155', fontSize: 12, marginTop: 8 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, backgroundColor: '#FFF', color: '#0F172A' },
  sectionTitle: { fontWeight: '800', color: '#0F172A' },
  fieldCard: { backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 6 },
  fieldIdx: { fontWeight: '800', color: '#64748B' },
  remove: { color: '#DC2626', fontWeight: '700' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFF' },
  typeChipActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  typeText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  typeTextActive: { color: '#FFF' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  checkTick: { color: '#FFF', fontWeight: '900', fontSize: 12 },
  checkLabel: { fontWeight: '600', color: '#334155', fontSize: 12 },
});
