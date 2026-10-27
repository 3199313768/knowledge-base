import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Session } from '@supabase/supabase-js';
import {
  Alert,
  AlertDescription,
  Field,
  FieldError,
  Label,
} from '@oxygen-design/ui';
import type { AuthCredentials, SignUpResult } from '../auth/authService';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { PasswordInput } from './ui/PasswordInput';
import { TextInput } from './ui/TextInput';

interface AuthCardProps {
  authError?: string | null;
  existingSession: Session | null;
  onSignIn: (credentials: AuthCredentials) => Promise<void>;
  onSignOutCurrentDevice: () => Promise<void>;
  onSignUp: (credentials: AuthCredentials) => Promise<SignUpResult>;
  onRetry?: () => void;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '认证操作失败';
}

type AuthMode = 'sign-in' | 'sign-up';

const emailPattern = /^[^\s@]+@[^\s@]+$/;

const copyByMode: Record<AuthMode, { title: string; description: string }> = {
  'sign-in': {
    title: '欢迎回来',
    description: '登录后继续查找和整理团队资料。'
  },
  'sign-up': {
    title: '创建账号',
    description: '使用邮箱和密码创建账号，用来登录团队资料。'
  }
};

export function AuthCard({
  authError = null,
  existingSession,
  onSignIn,
  onSignOutCurrentDevice,
  onSignUp,
  onRetry
}: AuthCardProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset
  } = useForm<AuthCredentials>({
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit'
  });

  const isSignUp = mode === 'sign-up';
  const isBusy = isSubmitting || isSigningOut;
  const copy = copyByMode[mode];

  const submit = handleSubmit(async ({ email, password }) => {
    setError(null);
    setNotice(null);

    try {
      const credentials = { email, password };

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
    }
  });

  async function handleSignOutCurrentDevice() {
    setError(null);
    setNotice(null);
    setIsSigningOut(true);
    try {
      await onSignOutCurrentDevice();
    } catch (caughtError) {
      setError(messageFrom(caughtError));
    } finally {
      setIsSigningOut(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    reset();
    setError(null);
    setNotice(null);
    setMode(nextMode);
  }

  return (
    <main className="auth-page">
      <Card className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand" aria-label="知识库">
          <span className="auth-brand__mark" aria-hidden="true">K</span>
          <span className="auth-brand__name">知识库</span>
        </div>
        <div className="auth-card__header">
          <div>
            <h1 id="auth-title">{copy.title}</h1>
            <p className="auth-card__description">{copy.description}</p>
          </div>
          {existingSession ? (
            <Button
              disabled={isBusy}
              onClick={handleSignOutCurrentDevice}
              variant="ghost"
            >
              {isSigningOut ? '正在退出…' : '退出当前设备'}
            </Button>
          ) : null}
        </div>

        {authError ? (
          <Alert className="message message--error auth-card__service-error" tone="error">
            <AlertDescription>{authError}</AlertDescription>
            {onRetry ? <Button disabled={isBusy} onClick={onRetry} variant="link">重试</Button> : null}
          </Alert>
        ) : null}

        <form className="auth-form" noValidate onSubmit={submit}>
          <Field className="field">
            <Label htmlFor="auth-email">邮箱</Label>
            <TextInput
              aria-describedby={errors.email ? 'auth-email-error' : undefined}
              aria-invalid={errors.email ? 'true' : 'false'}
              autoComplete="email"
              disabled={isBusy}
              id="auth-email"
              inputMode="email"
              placeholder="you@example.com"
              required
              type="email"
              {...register('email', {
                required: '请输入邮箱',
                setValueAs: (value: string) => value.trim(),
                pattern: { value: emailPattern, message: '请输入有效邮箱' }
              })}
            />
            <FieldError className="field__error" id="auth-email-error">
              {errors.email?.message}
            </FieldError>
          </Field>

          <Field className="field">
            <Label htmlFor="auth-password">密码</Label>
            <PasswordInput
              key={mode}
              aria-describedby={errors.password ? 'auth-password-error' : undefined}
              aria-invalid={errors.password ? 'true' : 'false'}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              disabled={isBusy}
              id="auth-password"
              placeholder="至少 6 位"
              required
              {...register('password', {
                required: '请输入密码',
                minLength: { value: 6, message: '密码至少 6 位' }
              })}
            />
            <FieldError className="field__error" id="auth-password-error">
              {errors.password?.message}
            </FieldError>
          </Field>

          {error ? <Alert className="message message--error" tone="error">{error}</Alert> : null}
          {notice ? <Alert className="message message--notice" tone="success">{notice}</Alert> : null}

          <Button disabled={isBusy} type="submit" variant="primary">
            {isSubmitting
              ? (isSignUp ? '正在创建…' : '正在登录…')
              : (isSignUp ? '创建账号' : '登录')}
          </Button>
        </form>

        <div className="auth-switch">
          {isSignUp ? (
            <>
              <span>已有账号？</span>{' '}
              <Button disabled={isBusy} onClick={() => switchMode('sign-in')} variant="link">
                返回登录
              </Button>
            </>
          ) : (
            <>
              <span>还没有账号？</span>{' '}
              <Button disabled={isBusy} onClick={() => switchMode('sign-up')} variant="link">
                创建账号
              </Button>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
