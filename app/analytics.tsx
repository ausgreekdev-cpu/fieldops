import * as React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useStats } from '@/features/analytics/useStats';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { exportJobsCsv, exportInvoicesCsv } from '@/lib/csv';
import { getRawDb } from '@/db/client';

export default function AnalyticsScreen() {
  const { stats, loading, refresh } = useStats();
  const { role } = useCurrentUser();
  const [refreshing, setRefreshing] = React.useState(false);

  async function handleExportJobs() {
    const db = getRawDb();
    const rows = await db.getAllAsync(`SELECT * FROM jobs WHERE deleted_at IS NULL LIMIT 200`) as any[];
    await exportJobsCsv(rows);
  }
  async function handleExportInvoices() {
    const db = getRawDb();
    const rows = await db.getAllAsync(`SELECT * FROM invoices LIMIT 200`) as any[];
    await exportInvoicesCsv(rows);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Analytics', headerShown: true }} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={async ()=>{setRefreshing(true); await refresh(); setRefreshing(false);}} />}>
        <View style={styles.header}>
          <Text style={styles.title}>FieldOps Analytics</Text>
          <Text style={styles.hint}>Local-first • Offline • Role: {role ?? '…'}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Button title="↻ Refresh" size="sm" variant="secondary" onPress={refresh} />
            <Button title="Export Jobs CSV" size="sm" variant="secondary" onPress={handleExportJobs} />
            <Button title="Export Invoices CSV" size="sm" variant="secondary" onPress={handleExportInvoices} />
          </View>
        </View>

        {!stats ? <Text style={styles.muted}>Loading…</Text> : (
          <>
            <View style={styles.grid}>
              <View style={[styles.statCard, styles.statPrimary]}><Text style={styles.statNum}>{stats.totalJobs}</Text><Text style={styles.statLabel}>Total Jobs</Text></View>
              <View style={styles.statCard}><Text style={styles.statNum}>${stats.totalRevenue.toFixed(0)}</Text><Text style={styles.statLabel}>Revenue</Text><Text style={styles.statSub}>{stats.totalInvoices} invoices</Text></View>
              <View style={styles.statCard}><Text style={styles.statNum}>{stats.pendingSync}</Text><Text style={styles.statLabel}>Pending Sync</Text><Text style={styles.statSub}>outbox</Text></View>
              <View style={styles.statCard}><Text style={styles.statNum}>{stats.passRate !== null ? `${stats.passRate}%` : '—'}</Text><Text style={styles.statLabel}>Checklist Pass</Text><Text style={styles.statSub}>{stats.totalChecklists} submissions</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Jobs by Status</Text>
              {Object.entries(stats.byStatus).length === 0 ? <Text style={styles.muted}>No jobs</Text> : Object.entries(stats.byStatus).map(([k,v])=>(
                <View key={k} style={styles.statusRow}>
                  <Text style={styles.statusLabel}>{k.replace('_',' ').toUpperCase()}</Text>
                  <View style={{ flex: 1, height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, marginHorizontal: 12 }}>
                    <View style={[styles.bar, { width: `${Math.min(100, (v / Math.max(1, stats.totalJobs))*100)}%`, backgroundColor: k==='completed' ? '#16A34A' : k==='in_progress' ? '#2563EB' : k==='invoiced' ? '#7C3AED' : '#64748B' }]} />
                  </View>
                  <Text style={styles.statusNum}>{v}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Quick Actions</Text>
              <Text style={styles.bullet}>• Create job offline → appears instantly in Kanban</Text>
              <Text style={styles.bullet}>• Hold Voice → auto notes/materials → invoicing</Text>
              <Text style={styles.bullet}>• Run checklist (photo+signature) → audit log</Text>
              <Text style={styles.bullet}>• Generate invoice → Share PDF / Pay Link</Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  hint: { color: '#64748B', fontSize: 11, marginTop: 4 },
  muted: { color: '#94A3B8', padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flexBasis: '48%', backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  statPrimary: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  statNum: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  statLabel: { fontWeight: '700', color: '#475569', fontSize: 11, marginTop: 4 },
  statSub: { color: '#94A3B8', fontSize: 10 },
  card: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  cardTitle: { fontWeight: '800', color: '#0F172A' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { fontWeight: '700', color: '#334155', fontSize: 11, width: 90 },
  bar: { height: 8, borderRadius: 4 },
  statusNum: { fontWeight: '800', color: '#0F172A', width: 24, textAlign: 'right' },
  bullet: { color: '#475569', fontSize: 12, lineHeight: 16 },
});
