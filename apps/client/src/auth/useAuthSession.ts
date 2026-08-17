import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AuthService } from './authService';

interface AuthSessionState {
  error: string | null;
  isLoading: boolean;
  session: Session | null;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '认证状态读取失败';
}

export function useAuthSession(authService: AuthService): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>({
    error: null,
    isLoading: true,
    session: null
  });

  useEffect(() => {
    let isMounted = true;
    let subscription = { unsubscribe: () => {} };

    try {
      subscription = authService.onSessionChange((session) => {
        if (!isMounted) {
          return;
        }

        setState({ error: null, isLoading: false, session });
      });
    } catch (error: unknown) {
      setState({
        error: safeMessage(error),
        isLoading: false,
        session: null
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }

    authService
      .getCurrentSession()
      .then((session) => {
        if (!isMounted) {
          return;
        }

        setState({ error: null, isLoading: false, session });
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setState({
          error: safeMessage(error),
          isLoading: false,
          session: null
        });
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [authService]);

  return state;
}
