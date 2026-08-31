import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { secureStorage } from './secureStorage';

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No deep-link callback in V1 — email/password only (FR-1).
    detectSessionInUrl: false,
  },
});

/**
 * Refresh only runs while the app is foregrounded. Without this the timer keeps
 * firing in the background and a resumed app can act on an expired token —
 * which must never discard queued offline mutations (FR-1).
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
