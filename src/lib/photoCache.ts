import * as FileSystem from 'expo-file-system';
import { getRawDb } from '@/db/client';
import { selectEvictions, EvictCandidate } from './photoCacheLogic';

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB
const DIR = FileSystem.documentDirectory ?? '';

/** Local file URIs that must never be evicted (not yet uploaded). */
async function getProtectedUris(): Promise<Set<string>> {
  const prot = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u === 'string' && u) prot.add(u);
  };
  try {
    const db = getRawDb();
    const outbox = (await db.getAllAsync(`SELECT payload FROM outbox WHERE status IN ('pending','syncing','failed')`)) as {
      payload: string;
    }[];
    for (const r of outbox) {
      try {
        const p = JSON.parse(r.payload) as any;
        add(p.local_uri);
        add(p._localPdfUri);
        add(p._localLogoUri);
        if (p._localPhotoMap && typeof p._localPhotoMap === 'object') {
          Object.values(p._localPhotoMap).forEach(add);
        }
      } catch {}
    }
    const photos = (await db.getAllAsync(`SELECT local_uri FROM job_photos WHERE synced=0 AND local_uri IS NOT NULL`)) as {
      local_uri: string;
    }[];
    photos.forEach(r => add(r.local_uri));
    const invs = (await db.getAllAsync(`SELECT pdf_path FROM invoices WHERE synced=0 AND pdf_path IS NOT NULL`)) as {
      pdf_path: string;
    }[];
    invs.forEach(r => add(r.pdf_path));
  } catch {}
  return prot;
}

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
    const protectedUris = await getProtectedUris();

    const files = await FileSystem.readDirectoryAsync(DIR);
    const infos: EvictCandidate[] = await Promise.all(
      files
        .filter(f => f.match(/\.(jpg|png|jpeg)$/i))
        .map(async f => {
          const info = await FileSystem.getInfoAsync(DIR + f);
          return { name: f, uri: DIR + f, mod: (info as any).modificationTime ?? 0, size: (info as any).size ?? 0, exists: info.exists };
        })
    );
    for (const uri of selectEvictions(infos, protectedUris, size, MAX_BYTES)) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      console.log('[photoCache] evicted', uri.replace(DIR, ''));
    }
  } catch (e) { console.warn('[photoCache]', e); }
}
