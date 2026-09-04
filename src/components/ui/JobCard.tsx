import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import type { JobStatus } from '@/types';

const statusColor: Record<JobStatus, string> = {
  scheduled: '#64748B',
  in_progress: '#2563EB',
  completed: '#16A34A',
  invoiced: '#7C3AED',
};

interface Props {
  id: string;
  title: string;
  customerName: string;
  address: string;
  customerPhone?: string;
  status: JobStatus;
  scheduledAt?: string;
  onPress?: () => void;
  lat?: number;
  lng?: number;
}

export function JobCard({ title, customerName, address, customerPhone, status, scheduledAt, onPress, lat, lng }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: statusColor[status] }]}>
          <Text style={styles.badgeText}>{status.replace('_', ' ').toUpperCase()}</Text>
        </View>
        {scheduledAt ? <Text style={styles.date}>{new Date(scheduledAt).toLocaleDateString()}</Text> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.customer}>{customerName}</Text>
      <Text style={styles.address} numberOfLines={2}>{address}</Text>

      <View style={styles.actions}>
        {customerPhone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${customerPhone}`)} style={styles.actionBtn} hitSlop={12}>
            <Text style={styles.actionText}>Call</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            const url = lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
            Linking.openURL(url);
          }}
          style={styles.actionBtn}
          hitSlop={12}
        >
          <Text style={styles.actionText}>Navigate</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#FFF', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  date: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  customer: { fontSize: 14, fontWeight: '600', color: '#334155' },
  address: { fontSize: 13, color: '#64748B', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: { backgroundColor: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minHeight: 44, justifyContent: 'center' },
  actionText: { fontWeight: '700', color: '#0F172A' },
});
