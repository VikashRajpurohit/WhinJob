import * as SecureStore from 'expo-secure-store';

/**
 * Auth tokens live in Keychain/Keystore, never AsyncStorage (hard rule 9).
 *
 * SecureStore rejects values over ~2KB and a Supabase session with a large JWT
 * clears that easily, so values are split across numbered chunks. The base key
 * holds the chunk count, which is also how a stale longer session gets fully
 * cleared on overwrite.
 */
const CHUNK_SIZE = 1800;

function chunkKey(key: string, index: number) {
  return `${key}__${index}`;
}

async function chunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(key);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await chunkCount(key);
    if (count === 0) return null;

    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))),
    );
    // A missing chunk means a partial write; treat the whole value as absent
    // rather than handing Supabase a truncated session.
    return parts.some((p) => p == null) ? null : parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await chunkCount(key);
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      parts.push(value.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(chunkKey(key, i), part)));
    await SecureStore.setItemAsync(key, String(parts.length));

    for (let i = parts.length; i < previous; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await chunkCount(key);
    await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))),
    );
    await SecureStore.deleteItemAsync(key);
  },
};
