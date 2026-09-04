import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSyncStatus } from '@/sync/useSyncStatus';

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, retryNow } = useSyncStatus();

  if (isOnline && pendingCount === 0) return null;

  const bg = !isOnline ? '#DC2626' : '#F59E0B';
  const label = !isOnline
    ? `Offline Mode — ${pendingCount} update${pendingCount === 1 ? '' : 's'} pending sync`
    : isSyncing
    ? `Syncing ${pendingCount} update${pendingCount === 1 ? '' : 's'}…`
    : `${pendingCount} update${pendingCount === 1 ? '' : 's'} pending`;

  return (
    <View style={[styles.wrap, { backgroundColor: bg }]} accessibilityRole="alert">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <Text style={styles.dot}>{!isOnline ? '●' : '◐'}</Text>
        <Text style={styles.text}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {isOnline && pendingCount > 0 && !isSyncing && (
          <Pressable onPress={() => retryNow()} hitSlop={8} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        )}
        <Text style={styles.hint}>Never blocks</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    // sticky top, high contrast
  },
  dot: { color: '#FFF', fontWeight: '900' },
  text: { color: '#FFF', fontWeight: '700', fontSize: 13, flex: 1 },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '600' },
  retry: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 12 },
  retryText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
});
