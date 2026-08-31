import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { hydrateResumes } from '@/features/resume/resumeSync';
import { hydrateProfile } from './profileSync';
import { clearLocalData } from './localReset';

type AuthState = {
  session: Session | null;
  userId: string | null;
  /** False only until the persisted session has been read back from Keychain. */
  ready: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, userId: null, ready: false });

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState({ session: data.session, userId: data.session?.user.id ?? null, ready: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, userId: session?.user.id ?? null, ready: true });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // The profile row is created server-side at sign-up, so hydration is a pull
  // into SQLite rather than a create-if-missing dance (FR-2).
  useEffect(() => {
    if (!state.userId) return;
    const userId = state.userId;
    void (async () => {
      await hydrateProfile(userId);
      await hydrateResumes(userId);
    })();
  }, [state.userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    // With email confirmation on, signUp returns a user but no session.
    return { needsConfirmation: data.session === null };
  }, []);

  const signOut = useCallback(async () => {
    const previousUserId = state.userId;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // Local rows are wiped so a second account on this device never reads the
    // first account's cached jobs, resumes or applications.
    if (previousUserId) await clearLocalData();
  }, [state.userId]);

  const value = useMemo(
    () => ({ ...state, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
