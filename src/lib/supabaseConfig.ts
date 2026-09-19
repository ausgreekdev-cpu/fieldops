import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// User-supplied Supabase config, persisted locally so a prebuilt installer works
// for anyone without needing to rebuild with baked env vars.
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const URL_KEY = 'fieldops.supabase.url';
const ANON_KEY = 'fieldops.supabase.anon';
const STORED_FLAG = 'fieldops.supabase.stored';

// In-memory override (set after first-run wizard saves config)
let current: SupabaseConfig | null = null;

function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return Promise.resolve(localStorage.getItem(key)); } catch { return Promise.resolve(null); }
  }
  return SecureStore.getItemAsync(key);
}
function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch {}
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, value);
}
function storageRemove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.removeItem(key); } catch {}
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key);
}

export async function loadSupabaseConfig(): Promise<SupabaseConfig | null> {
  if (current) return current;
  try {
    const stored = await storageGet(STORED_FLAG);
    if (stored === '1') {
      const url = await storageGet(URL_KEY);
      const anon = await storageGet(ANON_KEY);
      if (url && anon) {
        current = { url, anonKey: anon };
        return current;
      }
    }
  } catch {}
  return null;
}

export async function saveSupabaseConfig(cfg: SupabaseConfig): Promise<void> {
  current = cfg;
  await storageSet(URL_KEY, cfg.url.trim());
  await storageSet(ANON_KEY, cfg.anonKey.trim());
  await storageSet(STORED_FLAG, '1');
}

export async function clearSupabaseConfig(): Promise<void> {
  current = null;
  await storageRemove(URL_KEY);
  await storageRemove(ANON_KEY);
  await storageRemove(STORED_FLAG);
}

export function getSupabaseConfig(): SupabaseConfig | null {
  return current;
}

export function isPlaceholderUrl(url: string): boolean {
  return !url || url.includes('placeholder') || url.includes('YOUR_PROJECT') || url === 'https://xxx.supabase.co';
}