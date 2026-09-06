import * as FileSystem from 'expo-file-system';

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB
const DIR = FileSystem.documentDirectory ?? '';

export async function getCacheSize(): Promise<number> {
  try {
    const files = await FileSystem.readDirectoryAsync(DIR);
    let total = 0;
    for (const f of files) {
      if (!f.match(/\.(jpg|png|jpeg|pdf)$/i)) continue;
      const info = await FileSystem.getInfoAsync(DIR + f);
      if (info.exists && (info as any).size) total += (info as any).size as number;
    }
    return total;
  } catch { return 0; }
}

export async function evictLRUIfNeeded() {
  const size = await getCacheSize();
  if (size < MAX_BYTES) return;
  try {
    const files = await FileSystem.readDirectoryAsync(DIR);
    const infos = await Promise.all(files.filter(f => f.match(/\.(jpg|png|jpeg)$/i)).map(async f => {
      const info = await FileSystem.getInfoAsync(DIR + f);
      return { name: f, uri: DIR + f, mod: (info as any).modificationTime ?? 0, size: (info as any).size ?? 0, exists: info.exists };
    }));
    infos.sort((a, b) => a.mod - b.mod); // oldest first
    let cur = size;
    for (const file of infos) {
      if (cur < MAX_BYTES * 0.7) break; // target 70%
      // Don't delete files that are still pending in outbox (check existence elsewhere)
      if (!file.exists) continue;
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      cur -= file.size;
      console.log('[photoCache] evicted', file.name);
    }
  } catch (e) { console.warn('[photoCache]', e); }
}
