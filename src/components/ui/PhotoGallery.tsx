import * as React from 'react';
import { View, Text, StyleSheet, FlatList, Image, Pressable, Alert, Modal, Dimensions } from 'react-native';
import { getRawDb } from '@/db/client';
import { evictLRUIfNeeded } from '@/lib/photoCache';

interface Props { jobId: string; refreshKey?: number; }

export function PhotoGallery({ jobId, refreshKey }: Props) {
  const [photos, setPhotos] = React.useState<any[]>([]);
  const [lightbox, setLightbox] = React.useState<any | null>(null);

  const load = React.useCallback(async () => {
    try {
      const db = getRawDb();
      const rows = await db.getAllAsync(`SELECT id, storage_path, local_uri, taken_at, synced FROM job_photos WHERE job_id=? ORDER BY taken_at DESC LIMIT 20`, [jobId]);
      setPhotos(rows as any[]);
      // LRU eviction check in background (non-blocking)
      evictLRUIfNeeded().catch(()=>{});
    } catch { setPhotos([]); }
  }, [jobId]);

  React.useEffect(() => { load(); }, [load, refreshKey]);

  if (photos.length === 0) return <Text style={styles.empty}>No photos yet — tap 📷 to capture offline</Text>;

  const w = Dimensions.get('window').width;

  return (
    <>
      <FlatList
        data={photos}
        horizontal
        keyExtractor={i=>i.id}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({item})=> (
          <Pressable onPress={() => setLightbox(item)} style={styles.thumbWrap}>
            <Image source={{ uri: item.local_uri ?? undefined }} style={styles.thumb} />
            {!item.synced ? <View style={styles.pendingDot}><Text style={styles.pendingText}>●</Text></View> : null}
          </Pressable>
        )}
      />
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable onPress={() => setLightbox(null)} style={styles.lightboxBg}>
          <View style={styles.lightboxCard}>
            {lightbox ? <Image source={{ uri: lightbox.local_uri ?? undefined }} style={[styles.lightboxImg, { width: w - 32, height: w - 32 }]} resizeMode="contain" /> : null}
            <Text style={styles.lightboxMeta}>{lightbox?.storage_path ?? ''}</Text>
            <Text style={styles.lightboxMeta}>{lightbox?.synced ? 'Synced ✓' : 'Pending upload • will sync when online'}</Text>
            <Text style={styles.lightboxHint}>Tap outside to close • pinch-zoom via OS viewer</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  empty: { color: '#94A3B8', fontSize: 11, textAlign: 'center' },
  thumbWrap: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  thumb: { width: '100%', height: '100%' },
  pendingDot: { position: 'absolute', top: 4, right: 4, backgroundColor: '#F59E0B', width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pendingText: { color: '#FFF', fontSize: 8, fontWeight: '900' },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  lightboxCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 12, gap: 8, alignItems: 'center' },
  lightboxImg: { borderRadius: 12, backgroundColor: '#F1F5F9' },
  lightboxMeta: { color: '#475569', fontSize: 11, textAlign: 'center' },
  lightboxHint: { color: '#94A3B8', fontSize: 10, textAlign: 'center' },
});
