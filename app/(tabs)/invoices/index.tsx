import * as React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Button } from '@/components/ui/Button';

export default function InvoicesScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Invoices</Text>
      <Text style={styles.sub}>One-tap branded PDF from any Completed job</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No invoices yet</Text>
        <Text style={styles.emptySub}>Complete a job → Generate → Share via SMS/WhatsApp/Email</Text>
        <Button title="View Jobs" variant="secondary" size="sm" onPress={() => {}} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC', padding: 16, paddingTop: 20 },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  sub: { color: '#64748B', fontSize: 13, marginTop: 4 },
  empty: { marginTop: 32, backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  emptyText: { fontWeight: '800', color: '#0F172A' },
  emptySub: { color: '#94A3B8', fontSize: 12, textAlign: 'center' },
});
