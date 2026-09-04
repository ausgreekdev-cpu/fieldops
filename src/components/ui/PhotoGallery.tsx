import * as React from 'react';
import { View, Text, StyleSheet, FlatList, Image, Pressable, Alert } from 'react-native';
import { getRawDb } from '@/db/client';

interface Props { jobId: string; refreshKey?: number; }

export function PhotoGallery({ jobId, refreshKey }: Props) {
  const [photos, setPhotos] = React.useState<any[]>([]);

  const load = React.useCallback(async () => {
    try {
      const db = getRawDb();
      const rows = await db.getAllAsync(`SELECT id, storage_path, local_uri, taken_at, synced FROM job_photos WHERE job_id=? ORDER BY taken_at DESC LIMIT 20`, [jobId]);
      setPhotos(rows as any[]);
    } catch { setPhotos([]); }
  }, [jobId]);

  React.useEffect(() => { load(); }, [load, refreshKey]);

  if (photos.length === 0) return <Text style={styles.empty}>No photos yet — tap 📷 to capture offline</Text>;

  return (
    <FlatList
      data={photos}
      horizontal
      keyExtractor={i=>i.id}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      showsHorizontalScrollIndicator={false}
      renderItem={({item})=> (
        <Pressable onPress={() => Alert.alert('Photo', `${item.storage_path}\n${item.synced ? 'Synced ✓' : 'Pending upload'}`)} style={styles.thumbWrap}>
          <Image source={{ uri: item.local_uri ?? undefined }} style={styles.thumb} />
          {!item.synced ? <View style={styles.pendingDot}><Text style={styles.pendingText}>●</Text></View> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  empty: { color: '#94A3B8', fontSize: 11, textAlign: 'center' },
  thumbWrap: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  thumb: { width: '100%', height: '100%' },
  pendingDot: { position: 'absolute', top: 4, right: 4, backgroundColor: '#F59E0B', width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pendingText: { color: '#FFF', fontSize: 8, fontWeight: '900' },
});
