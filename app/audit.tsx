import * as React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export default function AuditScreen() {
  const { role } = useCurrentUser();
  const [logs, setLogs] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // local outbox + sync_logs fallback
      const db = getRawDb();
      let rows: any[] = [];
      try {
        const supabase = getSupabase();
        const { data } = await supabase.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(50);
        if (data && data.length) rows = data;
      } catch {}
      if (rows.length === 0) {
        // fallback: outbox + local sync_logs if table missing
        try {
          const out = await db.getAllAsync(`SELECT 'outbox' as source, table_name, record_id, operation, status, created_at, error FROM outbox ORDER BY created_at DESC LIMIT 30`) as any[];
          rows = out;
        } catch { rows = []; }
      }
      // also include checklist_submissions history
      try {
        const subs = await db.getAllAsync(`SELECT id, job_id, checklist_id, result, created_at FROM checklist_submissions ORDER BY created_at DESC LIMIT 20`) as any[];
        const mapped = subs.map(s => ({ id: s.id, table_name: 'checklist_submissions', record_id: s.job_id, operation: `checklist:${s.result}`, status: 'synced', created_at: s.created_at }));
        rows = [...mapped, ...rows].slice(0, 60);
      } catch {}
      setLogs(rows);
    } finally { setLoading(false); }
  }, []);

  async function handleExportCsv() {
    if (logs.length === 0) { Alert.alert('No logs', 'Nothing to export'); return; }
    try {
      const header = 'id,table_name,record_id,operation,status,created_at,error\n';
      const rows = logs.map(l => {
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return [esc(l.id), esc(l.table_name), esc(l.record_id), esc(l.operation ?? ''), esc(l.status), esc(l.created_at), esc(l.error ?? '')].join(',');
      }).join('\n');
      const csv = header + rows;
      const uri = `${FileSystem.documentDirectory}audit_${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Share audit CSV' });
      } else {
        Alert.alert('CSV exported', uri);
      }
    } catch (e: any) { Alert.alert('Export failed', e.message); }
  }

  React.useEffect(() => { load(); }, [load]);

  if (role && !['owner','admin'].includes(role)) {
    return (
      <>
        <Stack.Screen options={{ title: 'Audit Log', headerShown: true }} />
        <View style={[styles.wrap, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
          <Text style={styles.title}>Permission denied</Text>
          <Text style={styles.hint}>Only owner/admin can view audit log. Role: {role}</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Audit Log', headerShown: true }} />
      <View style={styles.wrap}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.title}>Audit Log</Text>
            <Pressable onPress={handleExportCsv} style={styles.exportBtn}><Text style={styles.exportText}>Export CSV</Text></Pressable>
          </View>
          <Text style={styles.hint}>sync_logs + checklist history • local first, Supabase when online • role: {role ?? '…'}</Text>
        </View>
        <FlatList
          data={logs}
          keyExtractor={(i,idx)=> i.id ?? `${i.table_name}-${idx}`}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.empty}>No logs yet — run a checklist or create a job</Text>}
          renderItem={({item})=>(
            <View style={[styles.row, item.status==='failed' ? styles.rowFailed : item.status==='synced' ? styles.rowSynced : styles.rowPending]}>
              <View style={{ flex:1 }}>
                <Text style={styles.rowTitle}>{item.table_name} • {item.operation ?? item.type ?? 'event'}</Text>
                <Text style={styles.rowMeta}>{item.record_id?.slice(0,8) ?? '—'} • {new Date(item.created_at).toLocaleString()}</Text>
                {item.error ? <Text style={styles.rowError} numberOfLines={2}>{item.error}</Text> : null}
              </View>
              <Text style={styles.badge}>{(item.status ?? 'pending').toUpperCase()}</Text>
            </View>
          )}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { padding: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  hint: { color: '#64748B', fontSize: 11, marginTop: 4 },
  empty: { textAlign: 'center', color: '#94A3B8', marginTop: 24 },
  row: { flexDirection: 'row', gap: 12, backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  rowFailed: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  rowSynced: { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' },
  rowPending: { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
  rowTitle: { fontWeight: '700', color: '#0F172A', fontSize: 12 },
  rowMeta: { color: '#64748B', fontSize: 11 },
  rowError: { color: '#DC2626', fontSize: 10, marginTop: 2 },
  badge: { fontWeight: '800', fontSize: 10, color: '#334155', alignSelf: 'center' },
  exportBtn: { backgroundColor: '#0F172A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  exportText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
});
