import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, Image, Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Button } from '@/components/ui/Button';
import { Paywall } from '@/components/ui/Paywall';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { checkEntitlement } from '@/lib/revenuecat';
import { companySchema } from '@/lib/validation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canManageCompany } from '@/lib/permissions';

export default function SettingsScreen() {
  const [company, setCompany] = React.useState<any>(null);
  const [name, setName] = React.useState('');
  const [abn, setAbn] = React.useState('');
  const [logoUri, setLogoUri] = React.useState<string | null>(null);
  const { role } = useCurrentUser();
  const canManage = canManageCompany(role);
  const [saving, setSaving] = React.useState(false);
  const [showPaywall, setShowPaywall] = React.useState(false);
  const [isPro, setIsPro] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userRow } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        if (userRow?.company_id) {
          const { data: comp } = await supabase.from('companies').select('*').eq('id', userRow.company_id).single();
          if (comp) {
            setCompany(comp);
            setName(comp.name ?? '');
            setAbn(comp.abn ?? '');
            if (comp.logo_url) setLogoUri(comp.logo_url);
            return;
          }
        }
      }
      // fallback local
      const db = getRawDb();
      const row = (await db.getFirstAsync(`SELECT * FROM companies LIMIT 1`)) as any;
      if (row) {
        setCompany(row);
        setName(row.name ?? '');
        setAbn(row.abn ?? '');
        if (row.logo_url) setLogoUri(row.logo_url);
      }
      checkEntitlement('pro').then(setIsPro);
    } catch (e) { console.warn(e); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function pickLogo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1,1] });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    const dest = `${FileSystem.documentDirectory}logo_${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    setLogoUri(dest); // local preview; uploaded on save
  }

  async function handleSave() {
    if (!canManage) { Alert.alert('Permission denied', `Role ${role} cannot manage company — owner/admin only`); return; }
    if (!company) { Alert.alert('No company'); return; }
    const parsed = companySchema.safeParse({ name, abn });
    if (!parsed.success) { Alert.alert('Validation', parsed.error.issues.map(i=>i.message).join('\n')); return; }
    setSaving(true);
    try {
      const db = getRawDb();
      const now = new Date().toISOString();
      let logoStoragePath: string | null = company.logo_url ?? null;
      let localLogoUri: string | null = null;

      if (logoUri && logoUri.startsWith('file')) {
        localLogoUri = logoUri;
        const filename = `logo_${company.id}_${Date.now()}.jpg`;
        logoStoragePath = `${company.id}/${filename}`;
      }

      await db.runAsync(`UPDATE companies SET name=?, abn=?, logo_url=?, updated_at=?, synced=0 WHERE id=?`, [name.trim(), abn.trim() || null, logoStoragePath, now, company.id]);

      const mgr = SyncManager.getInstance(getSupabase());
      const payload: any = { id: company.id, name: name.trim(), abn: abn.trim() || null, logo_url: logoStoragePath, updated_at: now };
      if (localLogoUri) payload._localLogoUri = localLogoUri;
      await mgr.enqueue('companies' as any, company.id, 'update', payload);

      Alert.alert('Saved offline ✓', 'Company updated, logo will upload when online');
    } catch (e: any) { Alert.alert('Save failed', e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerShown: true }} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.title}>Company Settings</Text>
        <Text style={styles.hint}>Logo, ABN, tax — branded PDFs update instantly. Offline-first.</Text>

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.label}>Logo</Text>
            <Text style={{ color: '#64748B', fontSize: 11 }}>Role: {role ?? '…'} {canManage ? '• can manage' : '• view-only'}</Text>
          </View>
          <Pressable onPress={canManage ? pickLogo : () => Alert.alert('Read-only', 'Only owner/admin can change logo')} style={styles.logoBox}>
            {logoUri ? <Image source={{ uri: logoUri }} style={styles.logo} /> : <Text style={styles.logoPlaceholder}>Tap to pick logo</Text>}
          </Pressable>
          <Text style={styles.meta}>JPG/PNG, square recommended. Stored in company-logos bucket ({company?.id?.slice(0,8) ?? '…'}/*)</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Company Name *</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Smith Electrical" placeholderTextColor="#94A3B8" />
          <Text style={styles.label}>ABN / Tax ID</Text>
          <TextInput value={abn} onChangeText={setAbn} style={styles.input} placeholder="12 345 678 901" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
          <View style={{ height: 8 }} />
          <Button title={saving ? 'Saving…' : 'Save (Offline)'} onPress={handleSave} loading={saving} disabled={!canManage} />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Subscription</Text>
          <Text style={[styles.badge, isPro ? styles.badgePro : styles.badgeFree]}>{isPro ? 'PRO ✓' : 'FREE'}</Text>
          <Text style={styles.meta}>Free: 3 jobs, 5 AI logs/mo. Pro unlocks unlimited AI, custom checklists, branded PDFs.</Text>
          {!isPro && <Button title="Unlock Pro →" onPress={() => setShowPaywall(true)} />}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Sync Debug →" variant="secondary" size="sm" onPress={() => router.push('/debug' as any)} />
          <Button title="Team →" variant="ghost" size="sm" onPress={() => router.push('/(tabs)/team' as any)} />
        </View>
        <Text style={styles.foot}>Public repo: https://github.com/ausgreekdev-cpu/fieldops • Secrets via supabase secrets set (never committed)</Text>
      </ScrollView>
      <Paywall visible={showPaywall} onClose={() => setShowPaywall(false)} onProGranted={() => setIsPro(true)} feature="Pro features" />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  hint: { color: '#64748B', fontSize: 12 },
  card: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  label: { fontWeight: '700', color: '#0F172A', fontSize: 12 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, backgroundColor: '#FFF', color: '#0F172A' },
  logoBox: { width: 120, height: 120, borderRadius: 12, borderWidth: 1.5, borderColor: '#CBD5E1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: 'center', backgroundColor: '#F8FAFC' },
  logo: { width: '100%', height: '100%' },
  logoPlaceholder: { color: '#94A3B8', fontWeight: '700' },
  meta: { color: '#94A3B8', fontSize: 11 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontWeight: '800', overflow: 'hidden' } as any,
  badgePro: { backgroundColor: '#DCFCE7', color: '#15803D' } as any,
  badgeFree: { backgroundColor: '#F1F5F9', color: '#475569' } as any,
  foot: { color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
