/**
 * Pure photo-cache eviction decisions — no expo-file-system / SQLite imports,
 * so selection logic is unit-testable under Jest.
 */

export interface EvictCandidate {
  name: string;
  uri: string;
  /** File modification time — lower = older. */
  mod: number;
  size: number;
  exists: boolean;
}

/** A URI is protected if the set contains it exactly, or a member ends with `/<name>`. */
export function isUriProtected(uri: string, name: string, protectedUris: ReadonlySet<string>): boolean {
  if (protectedUris.has(uri)) return true;
  for (const p of protectedUris) {
    if (p.endsWith(`/${name}`)) return true;
  }
  return false;
}

/**
 * Evict least-recently-modified files until usage drops below
 * `targetRatio * maxBytes`. Protected (not yet uploaded) and missing files
 * are never selected. Returns URIs in deletion order.
 */
export function selectEvictions(
  files: readonly EvictCandidate[],
  protectedUris: ReadonlySet<string>,
  currentBytes: number,
  maxBytes: number,
  targetRatio = 0.7
): string[] {
  const target = maxBytes * targetRatio;
  const sorted = [...files].sort((a, b) => a.mod - b.mod); // oldest first
  const out: string[] = [];
  let cur = currentBytes;
  for (const file of sorted) {
    if (cur < target) break;
    if (!file.exists) continue;
    if (isUriProtected(file.uri, file.name, protectedUris)) continue;
    out.push(file.uri);
    cur -= file.size;
  }
  return out;
}
