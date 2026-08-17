import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SignUpResult {
  needsEmailConfirmation: boolean;
}

export interface AuthSubscription {
  unsubscribe: () => void;
}

export interface AuthService {
  getCurrentSession: () => Promise<Session | null>;
  onSessionChange: (
    onChange: (session: Session | null) => void
  ) => AuthSubscription;
  signInWithPassword: (credentials: AuthCredentials) => Promise<void>;
  signUpWithPassword: (credentials: AuthCredentials) => Promise<SignUpResult>;
  signOutCurrentDevice: () => Promise<void>;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '认证操作失败';
}

export const defaultAuthService: AuthService = {
  async getCurrentSession() {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(messageFrom(error));
    }

    return data.session;
  },

  onSessionChange(onChange) {
    const supabase = getSupabaseBrowserClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      onChange(session);
    });

    return {
      unsubscribe: () => data.subscription.unsubscribe()
    };
  },

  async signInWithPassword({ email, password }) {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw new Error(messageFrom(error));
    }
  },

  async signUpWithPassword({ email, password }) {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      throw new Error(messageFrom(error));
    }

    return { needsEmailConfirmation: !data.session };
  },

  async signOutCurrentDevice() {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      throw new Error(messageFrom(error));
    }
  }
};
