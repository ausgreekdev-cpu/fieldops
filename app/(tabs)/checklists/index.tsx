import * as React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Button } from '@/components/ui/Button';

const MOCK = [
  { id: '1', name: 'Pre-Start Electrical', fields: 8 },
  { id: '2', name: 'Working at Heights', fields: 6 },
];

export default function ChecklistsScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Safety Checklists</Text>
      <Text style={styles.sub}>Tap a template to run on a job — photo proof + signature logged offline</Text>
      <FlatList
        data={MOCK}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.fields} items • Pass/Fail</Text>
            <View style={{ height: 8 }} />
            <Button title="Run Checklist" size="sm" variant="secondary" onPress={() => {}} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 20 },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A', paddingHorizontal: 16 },
  sub: { color: '#64748B', paddingHorizontal: 16, marginTop: 4, fontSize: 13 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  name: { fontWeight: '800', color: '#0F172A' },
  meta: { color: '#64748B', fontSize: 12, marginTop: 2 },
});
