import * as React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useChecklists } from '@/features/checklists/useChecklists';
import { getSupabase } from '@/lib/supabase';

export default function ChecklistsScreen() {
  const [companyId, setCompanyId] = React.useState<string | undefined>(undefined);
  const { templates, loading, error, refresh } = useChecklists(companyId);

  React.useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('users').select('company_id').eq('id', user.id).single();
          if (data?.company_id) setCompanyId(data.company_id);
        }
        // fallback: try local users table
        if (!companyId) {
          const { getRawDb } = await import('@/db/client');
          const db = getRawDb();
          const row = (await db.getFirstAsync(`SELECT company_id as cid FROM users LIMIT 1`)) as any;
          if (row?.cid) setCompanyId(row.cid);
        }
      } catch {}
    })();
  }, []);

  if (loading) return <View style={[styles.wrap, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator /><Text style={{ color: '#64748B', marginTop: 8 }}>Loading templates…</Text></View>;
  if (error) return <View style={styles.wrap}><Text style={{ color: '#DC2626', padding: 16 }}>{error}</Text><Button title="Retry" variant="secondary" onPress={refresh} /></View>;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Safety Checklists</Text>
        <Text style={styles.sub}>Photo proof + timestamped signature — all offline-first. Seeded defaults work without network.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title="↻ Refresh" size="sm" variant="secondary" onPress={refresh} />
          <Button title="+ New Template" size="sm" onPress={() => router.push('/checklists/new' as any)} />
        </View>
      </View>

      <FlatList
        data={templates}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#94A3B8', marginTop: 24 }}>No templates — pull to refresh or create one. Defaults seed automatically when you have a company.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/checklists/${item.id}` as any)} style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            <Text style={styles.meta}>{item.fields.length} items • {item.fields.filter((f:any)=>f.type==='pass_fail').length} pass/fail • {item.fields.filter((f:any)=>f.type==='photo').length} photo</Text>
            <View style={{ height: 8 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Edit" size="sm" variant="secondary" onPress={() => router.push(`/checklists/${item.id}` as any)} />
              <Button title="Run on Job →" size="sm" onPress={() => Alert.alert('Run checklist', 'Open a Job → Start Checklist → pick this template. Jobs list shows which templates are available.')} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 12 },
  header: { paddingHorizontal: 16, paddingBottom: 4 },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  sub: { color: '#64748B', marginTop: 4, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  name: { fontWeight: '800', color: '#0F172A', fontSize: 16 },
  desc: { color: '#475569', fontSize: 12, marginTop: 2 },
  meta: { color: '#64748B', fontSize: 12, marginTop: 4 },
});
