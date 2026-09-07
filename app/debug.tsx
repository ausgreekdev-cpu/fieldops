import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { useSyncStatus } from '@/sync/useSyncStatus';
import { getBackgroundSyncStatus } from '@/lib/backgroundSync';
import { getAllScheduledCount, getPermissionStatus, scheduleWeeklySummaryDebug, notifyWeeklySummaryNow } from '@/lib/notifications';
import { addBreadcrumb } from '@/lib/monitoring';
import * as Notifications from 'expo-notifications';

export default function DebugScreen() {
  const { isOnline, isSyncing, pendingCount, retryNow } = useSyncStatus();
  const [outbox, setOutbox] = React.useState<any[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [bgStatus, setBgStatus] = React.useState<any>(null);
  const [schedCount, setSchedCount] = React.useState(0);
  const [perm, setPerm] = React.useState<string>('unknown');

  const load = React.useCallback(async () => {
    try {
      const db = getRawDb();
      const rows = await db.getAllAsync(`SELECT id, table_name, record_id, operation, status, attempts, next_retry_at, error, created_at FROM outbox ORDER BY created_at DESC LIMIT 50`);
      setOutbox(rows as any[]);
      try { setBgStatus(await getBackgroundSyncStatus()); } catch {}
      try { setSchedCount(await getAllScheduledCount()); } catch {}
      try { setPerm(await getPermissionStatus()); } catch {}
      addBreadcrumb('debug load', { pending: rows.length });
    } catch (e) { console.warn(e); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function handleRetry() { await retryNow(); await load(); }
  async function handleClearFailed() {
    Alert.alert('Clear failed?', 'Reset failed items to pending (next retry now)', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', onPress: async () => {
        const db = getRawDb();
        await db.runAsync(`UPDATE outbox SET status='pending', next_retry_at=? WHERE status='failed'`, [new Date().toISOString()]);
        await load();
      }}
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Sync Debug', headerShown: true }} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async ()=>{setRefreshing(true); await load(); setRefreshing(false);}} />}>
        <View style={[styles.statusCard, isOnline ? styles.online : styles.offline]}>
          <Text style={styles.statusTitle}>{isOnline ? '● Online' : '○ Offline'}</Text>
          <Text style={styles.statusMeta}>{isSyncing ? 'Syncing…' : 'Idle'} • {pendingCount} pending</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button title="Retry Now" size="sm" onPress={handleRetry} />
            <Button title="Clear Failed" size="sm" variant="secondary" onPress={handleClearFailed} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Outbox Queue ({outbox.length}) — exponential backoff 1s·2^attempts cap 5m</Text>
        <Text style={styles.hint}>Shows last 50. Tap row to see error. Failed → pending on retry; pending → syncing → deleted on success.</Text>

        {outbox.length === 0 ? <Text style={styles.empty}>Queue empty ✓ — all synced</Text> : outbox.map(r => (
          <Pressable key={r.id} onPress={() => r.error && Alert.alert(`${r.table_name} • ${r.operation}`, r.error)} style={[styles.row, r.status==='failed' ? styles.rowFailed : r.status==='syncing' ? styles.rowSyncing : styles.rowPending]}>
            <View style={{ flex:1 }}>
              <Text style={styles.rowTitle}>{r.table_name} • {r.operation} • {r.status}</Text>
              <Text style={styles.rowMeta}>{r.record_id.slice(0,8)} • attempts {r.attempts} • {new Date(r.created_at).toLocaleTimeString()}</Text>
              {r.next_retry_at ? <Text style={styles.rowMeta}>next: {new Date(r.next_retry_at).toLocaleTimeString()}</Text> : null}
            </View>
            <Text style={styles.rowAttempts}>{r.attempts}</Text>
          </Pressable>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Background & Notifications</Text>
          <Text style={styles.bullet}>BG Fetch status: {bgStatus ? String(bgStatus.status) : '…'} • registered: {bgStatus?.isRegistered ? 'yes ✓' : 'no'} • 15m min (iOS throttles)</Text>
          <Text style={styles.bullet}>Scheduled notifications: {schedCount} • permission: {perm}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <Button title="Weekly Now" size="sm" onPress={async () => { await notifyWeeklySummaryNow(999, 3); addBreadcrumb('weekly now fired'); Alert.alert('Fired ✓'); }} />
            <Button title="Schedule 60s debug" size="sm" variant="secondary" onPress={async () => { await scheduleWeeklySummaryDebug(555, 2); setSchedCount(await getAllScheduledCount()); Alert.alert('Scheduled ✓ 60s'); }} />
            <Button title="Cancel All" size="sm" variant="ghost" onPress={async () => { await Notifications.cancelAllScheduledNotificationsAsync(); setSchedCount(0); Alert.alert('Cancelled'); }} />
          </View>
          <Text style={styles.hint}>Weekly uses identifier weekly-summary + Mon 9am channelId; debug uses cheap 60s for QA. Expo Go: BackgroundFetch unreliable — use Dev Client.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How to test offline</Text>
          <Text style={styles.bullet}>1) Airplane mode → create job → banner “Offline • 1 pending”</Text>
          <Text style={styles.bullet}>2) This screen shows row with pending + next_retry</Text>
          <Text style={styles.bullet}>3) Restore network → auto drains (NetInfo) or tap Retry Now</Text>
          <Text style={styles.bullet}>4) Verify Supabase row + Storage upload in Supabase Studio</Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  statusCard: { padding: 16, borderRadius: 16, borderWidth: 1 },
  online: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  offline: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  statusTitle: { fontWeight: '900', color: '#0F172A', fontSize: 16 },
  statusMeta: { color: '#475569', fontSize: 12, marginTop: 2 },
  sectionTitle: { fontWeight: '800', color: '#0F172A', marginTop: 8 },
  hint: { color: '#94A3B8', fontSize: 11 },
  empty: { textAlign: 'center', color: '#94A3B8', marginTop: 12 },
  row: { backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', gap: 12 },
  rowPending: { borderColor: '#F59E0B' },
  rowSyncing: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  rowFailed: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  rowTitle: { fontWeight: '700', color: '#0F172A', fontSize: 12 },
  rowMeta: { color: '#64748B', fontSize: 11 },
  rowAttempts: { fontWeight: '900', color: '#0F172A', fontSize: 18, alignSelf: 'center' },
  card: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 6, marginTop: 8 },
  cardTitle: { fontWeight: '800', color: '#0F172A' },
  bullet: { color: '#475569', fontSize: 12, lineHeight: 16 },
});
