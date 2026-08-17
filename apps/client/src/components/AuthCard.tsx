import { FormEvent, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AuthCredentials, SignUpResult } from '../auth/authService';

interface AuthCardProps {
  existingSession: Session | null;
  onSignIn: (credentials: AuthCredentials) => Promise<void>;
  onSignOutCurrentDevice: () => Promise<void>;
  onSignUp: (credentials: AuthCredentials) => Promise<SignUpResult>;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '认证操作失败';
}

export function AuthCard({
  existingSession,
  onSignIn,
  onSignOutCurrentDevice,
  onSignUp
}: AuthCardProps) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSignUp = mode === 'sign-up';

  function validate() {
    if (!email.trim()) {
      return '请输入邮箱';
    }

    if (!password) {
      return '请输入密码';
    }

    if (password.length < 6) {
      return '密码至少 6 位';
    }

    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const credentials = {
        email: email.trim(),
        password
      };

      if (isSignUp) {
        const result = await onSignUp(credentials);
        if (result.needsEmailConfirmation) {
          setNotice('账号已创建，请检查邮箱完成确认。');
        }
      } else {
        await onSignIn(credentials);
      }
    } catch (caughtError) {
      setError(messageFrom(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOutCurrentDevice() {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await onSignOutCurrentDevice();
    } catch (caughtError) {
      setError(messageFrom(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card__header">
          <div>
            <p className="eyebrow">Phase 3</p>
            <h1 id="auth-title">登录知识库</h1>
            <p className="auth-card__description">
              使用邮箱和密码进入当前设备的知识库会话。
            </p>
          </div>
          {existingSession ? (
            <button
              className="button button--ghost"
              disabled={isSubmitting}
              onClick={handleSignOutCurrentDevice}
              type="button"
            >
              退出当前设备
            </button>
          ) : null}
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>

          <label className="field">
            <span>密码</span>
            <input
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              type="password"
              value={password}
            />
          </label>

          {error ? <p className="message message--error">{error}</p> : null}
          {notice ? <p className="message message--notice">{notice}</p> : null}

          <button className="button button--primary" disabled={isSubmitting}>
            {isSignUp ? '创建账号' : '登录'}
          </button>
        </form>

        <div className="auth-switch">
          {isSignUp ? (
            <button
              className="button button--link"
              onClick={() => {
                setMode('sign-in');
                setError(null);
                setNotice(null);
              }}
              type="button"
            >
              返回登录
            </button>
          ) : (
            <button
              className="button button--link"
              onClick={() => {
                setMode('sign-up');
                setError(null);
                setNotice(null);
              }}
              type="button"
            >
              注册新账号
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
