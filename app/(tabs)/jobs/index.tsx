import * as React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { JobCard } from '@/components/ui/JobCard';
import { Button } from '@/components/ui/Button';
import { useJobs } from '@/hooks/useJobs';
import { exportJobsCsv } from '@/lib/csv';
import type { JobStatus } from '@/types';

const filters: Array<{ label: string; value: JobStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Invoiced', value: 'invoiced' },
];

export default function JobsScreen() {
  const [filter, setFilter] = React.useState<JobStatus | 'all'>('all');
  const { jobs, loading, refresh } = useJobs(filter);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Jobs</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Export CSV" size="sm" variant="secondary" onPress={() => exportJobsCsv(jobs as any)} />
          <Button title="+ New Job" size="sm" onPress={() => router.push('/jobs/new' as any)} />
        </View>
      </View>

      <View style={styles.chips}>
        {filters.map(f => (
          <Pressable key={f.value} onPress={() => setFilter(f.value)} style={[styles.chip, filter === f.value && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f.value && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={jobs}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading…' : 'No jobs — tap + New Job (works offline)'}</Text>}
        renderItem={({ item }) => (
          <JobCard
            id={item.id}
            title={item.title}
            customerName={item.customer_name}
            address={item.address}
            customerPhone={item.customer_phone ?? undefined}
            status={item.status}
            scheduledAt={item.scheduled_at ?? undefined}
            lat={item.lat ?? undefined}
            lng={item.lng ?? undefined}
            onPress={() => router.push(`/jobs/${item.id}` as any)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 20, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  chips: { flexDirection: 'row', gap: 8, padding: 12, paddingHorizontal: 16, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  chipText: { fontWeight: '700', fontSize: 12, color: '#475569' },
  chipTextActive: { color: '#FFF' },
  empty: { textAlign: 'center', color: '#94A3B8', marginTop: 40, paddingHorizontal: 24 },
});
