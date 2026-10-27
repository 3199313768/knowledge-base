# Login Page Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the template-like authentication page with the approved focused macOS-style panel while preserving every existing login, registration, current-device sign-out, retry, and email-confirmation behavior.

**Architecture:** Keep `App.tsx` responsible for choosing loading, authentication, and signed-in views. Refactor `AuthCard.tsx` onto React Hook Form and the existing shared `Button`, `TextInput`, and `Card` components, then apply auth-specific layout styles in `App.css`; the auth service and session hook contracts remain unchanged.

**Tech Stack:** React 19, TypeScript 5.8, React Hook Form, existing shared UI components, Vitest, Testing Library, Vite 7, Playwright browser verification.

## Global Constraints

- Preserve the current `AuthService` signatures and Supabase/session behavior.
- Preserve the existing uncommitted session-retry edits in `App.tsx`, `App.test.tsx`, `AuthCard.tsx`, and `useAuthSession.ts`.
- Do not commit, push, create a PR, deploy, or alter Supabase data unless the user explicitly requests it.
- Use Chinese for every user-visible string and never expose raw tokens, request headers, SQL, or stack traces.
- Reuse `apps/client/src/components/ui/Button.tsx`, `TextInput.tsx`, and `Card.tsx`; do not add another UI library.
- Add only `react-hook-form`; current dependencies do not provide the form-state API required by the repository rules.
- Keep one semantic implementation for Mac and iPhone; responsive differences belong only in CSS/layout.
- Do not add password reset, third-party auth, invitation acceptance, all-device sign-out, artwork, custom fonts, or changes to the signed-in workbench.
- The auth panel is approximately `420px` wide on desktop, uses a solid cool-gray page background, and contains no decorative gradients, blurred blobs, or nested cards.
- Inputs and the primary action are `42–44px` high and must expose visible focus, disabled, error, and submitting states.

---

## File Map

- Modify `apps/client/package.json`: declare `react-hook-form`.
- Modify `pnpm-lock.yaml`: lock the installed React Hook Form version.
- Modify `apps/client/src/components/AuthCard.tsx`: own login/register mode, React Hook Form validation, async operation messages, and approved semantic markup.
- Modify `apps/client/src/components/ui/TextInput.tsx`: forward the native input ref required by React Hook Form registration.
- Modify `apps/client/src/App.tsx`: make the session-loading state use the shared `Card` shell and accessible status semantics.
- Modify `apps/client/src/App.css`: implement the focused panel, shared control states, field-level errors, and responsive behavior.
- Modify `apps/client/src/App.test.tsx`: update approved copy and cover field errors, pending submission, retry, and preserved auth behavior.

### Task 1: Convert the authentication form to shared controls and React Hook Form

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/client/src/components/AuthCard.tsx`
- Modify: `apps/client/src/components/ui/TextInput.tsx`
- Test: `apps/client/src/App.test.tsx:145-308`

**Interfaces:**
- Consumes: existing `AuthCardProps`, `AuthCredentials`, `SignUpResult`, `Button`, `TextInput`, and `Card`.
- Produces: the unchanged `AuthCard(props: AuthCardProps)` public component; login passes `{ email: email.trim(), password }` to `onSignIn`, and registration passes the same shape to `onSignUp`.

- [x] **Step 1: Record the focused auth baseline before editing**

Run:

```bash
pnpm --dir apps/client test -- src/App.test.tsx
```

Expected: the current auth tests pass. If they do not, record the pre-existing failures separately and do not attribute them to this task.

- [x] **Step 2: Update the auth tests to describe the approved behavior**

In `apps/client/src/App.test.tsx`, change auth-page heading assertions from `登录知识库` to `欢迎回来`; keep assertions for the email/password fields and `登录` button. Extend the default-form test with:

```tsx
expect(screen.getByText('知识库')).toBeInTheDocument();
expect(screen.getByText('登录后继续查找和整理团队资料。')).toBeInTheDocument();
expect(screen.queryByText('Phase 3')).not.toBeInTheDocument();
```

After clicking `注册新账号`, assert:

```tsx
expect(screen.getByRole('heading', { name: '创建账号' })).toBeInTheDocument();
expect(
  screen.getByText('使用邮箱和密码创建账号，用来登录团队资料。')
).toBeInTheDocument();
```

Add a field-validation test:

```tsx
it('shows accessible field errors before authentication', async () => {
  const { authService } = createAuthService();
  render(<App authService={authService} />);
  await screen.findByRole('heading', { name: '欢迎回来' });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  expect(await screen.findByText('请输入邮箱')).toBeInTheDocument();
  expect(screen.getByLabelText('邮箱')).toHaveAttribute('aria-invalid', 'true');
  expect(authService.signInWithPassword).not.toHaveBeenCalled();
});
```

Add a deferred sign-in test for duplicate-submission protection:

```tsx
it('disables the form while sign in is pending', async () => {
  let resolveSignIn!: () => void;
  const { authService } = createAuthService();
  vi.mocked(authService.signInWithPassword).mockImplementation(
    () => new Promise<void>((resolve) => { resolveSignIn = resolve; })
  );
  render(<App authService={authService} />);
  await screen.findByRole('heading', { name: '欢迎回来' });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'me@example.test' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  expect(await screen.findByRole('button', { name: '正在登录…' })).toBeDisabled();
  expect(screen.getByLabelText('邮箱')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '正在登录…' }));
  expect(authService.signInWithPassword).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveSignIn();
  });
});
```

- [x] **Step 3: Run the focused tests and confirm the new expectations fail**

Run:

```bash
pnpm --dir apps/client test -- src/App.test.tsx
```

Expected: FAIL because the page still renders `登录知识库`, has no field-level error association, and does not display the new submitting label.

- [x] **Step 4: Add the required form dependency**

Run:

```bash
pnpm --dir apps/client add react-hook-form
```

Expected: `apps/client/package.json` contains `react-hook-form` under `dependencies`, and `pnpm-lock.yaml` changes only as needed for that package.

- [x] **Step 5: Refactor `AuthCard` to React Hook Form and shared primitives**

Use these imports and form state:

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { TextInput } from './ui/TextInput';

type AuthMode = 'sign-in' | 'sign-up';

const copyByMode: Record<AuthMode, { title: string; description: string }> = {
  'sign-in': { title: '欢迎回来', description: '登录后继续查找和整理团队资料。' },
  'sign-up': { title: '创建账号', description: '使用邮箱和密码创建账号，用来登录团队资料。' }
};

const {
  formState: { errors, isSubmitting },
  handleSubmit,
  register,
  reset
} = useForm<AuthCredentials>({
  defaultValues: { email: '', password: '' },
  mode: 'onSubmit'
});
```

Keep `mode`, `error`, `notice`, and separate `isSigningOut` local state. Define `isBusy = isSubmitting || isSigningOut`. Submit with:

```tsx
const submit = handleSubmit(async ({ email, password }) => {
  setError(null);
  setNotice(null);
  const credentials = { email: email.trim(), password };
  try {
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
```

Register the fields with these exact rules and IDs:

```tsx
{...register('email', { required: '请输入邮箱' })}
{...register('password', {
  required: '请输入密码',
  minLength: { value: 6, message: '密码至少 6 位' }
})}
```

Use IDs `auth-email`, `auth-email-error`, `auth-password`, and `auth-password-error`; set `aria-invalid`, `aria-describedby`, and render `.field__error` beside its field. Disable both inputs while `isBusy`.

Use `<Card className="auth-card" aria-labelledby="auth-title">`, `TextInput`, and shared `Button` components. The submit label is:

```tsx
isSubmitting
  ? (isSignUp ? '正在创建…' : '正在登录…')
  : (isSignUp ? '创建账号' : '登录')
```

On mode switch call `reset()`, clear `error` and `notice`, and update `mode`. Preserve `authError`/`onRetry`, email confirmation, and current-device sign-out behavior.

Update `TextInput` with `forwardRef<HTMLInputElement, TextInputProps>` and pass the ref to the native `<input>` so React Hook Form can register the real input element.

- [x] **Step 6: Run the focused tests and inspect the dependency diff**

Run:

```bash
pnpm --dir apps/client test -- src/App.test.tsx
git diff --check
git diff -- apps/client/package.json pnpm-lock.yaml apps/client/src/components/AuthCard.tsx apps/client/src/App.test.tsx
```

Expected: auth tests pass, `git diff --check` is silent, and no auth-service contract or unrelated lockfile entry changes.

### Task 2: Implement the focused panel and accessible loading shell

**Files:**
- Modify: `apps/client/src/App.tsx:1-49`
- Modify: `apps/client/src/components/AuthCard.tsx:97-189`
- Modify: `apps/client/src/App.css:33-240,1339-1371`
- Test: `apps/client/src/App.test.tsx:145-308`

**Interfaces:**
- Consumes: the Task 1 `AuthCard` markup and existing `Card` component.
- Produces: `.auth-page`, `.auth-card`, `.auth-brand`, `.auth-brand__mark`, `.auth-card__header`, `.auth-form`, `.field__error`, `.auth-card__service-error`, `.auth-switch`, and `.auth-loading` style hooks.

- [x] **Step 1: Add a failing loading-state accessibility assertion**

Add this test to the auth describe block:

```tsx
it('announces session loading inside the authentication shell', () => {
  const authService: AuthService = {
    getCurrentSession: vi.fn(() => new Promise<Session | null>(() => undefined)),
    onSessionChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    signOutCurrentDevice: vi.fn()
  };
  render(<App authService={authService} />);

  expect(screen.getByRole('status')).toHaveTextContent('正在读取当前设备会话…');
  expect(screen.getByText('知识库')).toBeInTheDocument();
});
```

- [x] **Step 2: Run the new test and confirm it fails**

Run:

```bash
pnpm --dir apps/client test -- src/App.test.tsx
```

Expected: FAIL because the current loading paragraph has no `role="status"` and the loading panel has no knowledge-base brand.

- [x] **Step 3: Add the approved brand/header markup**

At the top of the `AuthCard` panel, render:

```tsx
<div className="auth-brand" aria-label="知识库">
  <span className="auth-brand__mark" aria-hidden="true">K</span>
  <span className="auth-brand__name">知识库</span>
</div>
```

Render the mode-specific `<h1 id="auth-title">` and description immediately below it. Keep the optional `退出当前设备` action in the header; do not add simulated window controls.

In `App.tsx`, import `Card` and change the loading branch to:

```tsx
<main className="auth-page">
  <Card className="auth-card auth-loading">
    <div className="auth-brand" aria-label="知识库">
      <span className="auth-brand__mark" aria-hidden="true">K</span>
      <span className="auth-brand__name">知识库</span>
    </div>
    <p aria-live="polite" role="status">正在读取当前设备会话…</p>
  </Card>
</main>
```

- [x] **Step 4: Replace only the authentication-page CSS**

Use these approved values and leave signed-in workbench selectors unchanged:

```css
.auth-page {
  align-items: center;
  background: #edf0f3;
  display: flex;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 32px 20px;
}

.auth-card.ui-card {
  background: #fbfcfd;
  border: 1px solid #d3d9e0;
  border-radius: 8px;
  box-shadow: 0 18px 46px rgba(36, 46, 56, 0.13);
  max-width: 420px;
  padding: 32px;
  width: 100%;
}

.auth-brand {
  align-items: center;
  display: flex;
  gap: 10px;
  margin-bottom: 28px;
}

.auth-brand__mark {
  align-items: center;
  background: #263d54;
  border-radius: 7px;
  color: #fff;
  display: inline-flex;
  font-size: 0.82rem;
  font-weight: 750;
  height: 32px;
  justify-content: center;
  width: 32px;
}

.auth-brand__name {
  color: #202832;
  font-size: 0.92rem;
  font-weight: 720;
}

.auth-card__header {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 26px;
}

.auth-card__description {
  color: #68727d;
  font-size: 0.92rem;
  margin: 8px 0 0;
}

.auth-form { display: grid; gap: 16px; }

.auth-form .text-input {
  background: #fff;
  border-color: #c8d0d9;
  border-radius: 7px;
  min-height: 44px;
  padding: 10px 12px;
}

.auth-form .text-input:focus-visible {
  border-color: #3976b8;
  box-shadow: 0 0 0 3px rgba(57, 118, 184, 0.18);
  outline: none;
}

.auth-form .text-input[aria-invalid="true"] { border-color: #c94b45; }

.field__error {
  color: #a92f2a;
  font-size: 0.8rem;
  font-weight: 500;
}

.auth-form .button--primary {
  background: #1769c2;
  border-radius: 7px;
  box-shadow: none;
  min-height: 44px;
  width: 100%;
}

.auth-form .button--primary:hover:not(:disabled) { background: #125ba9; }

.auth-form .button--primary:focus-visible,
.auth-switch .button:focus-visible,
.auth-card__service-error .button:focus-visible {
  box-shadow: 0 0 0 3px rgba(57, 118, 184, 0.22);
  outline: none;
}

.auth-card__service-error {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.auth-switch {
  color: #68727d;
  font-size: 0.88rem;
  margin-top: 20px;
  text-align: center;
}

.auth-loading { display: grid; gap: 8px; }
.auth-loading p { color: #68727d; margin: 0; }
```

Render switch copy as `还没有账号？` plus `创建账号`, or `已有账号？` plus `返回登录`, keeping the action in a semantic `Button` with `variant="link"`.

At `max-width: 640px`, use:

```css
.auth-page { align-items: flex-start; padding: 20px 14px; }
.auth-card.ui-card { padding: 24px 20px; }
.auth-card__header { flex-direction: column; }
.auth-card__header > .button { align-self: flex-start; }
```

- [x] **Step 5: Run focused tests and static checks**

Run:

```bash
pnpm --dir apps/client test -- src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: all commands pass; no TypeScript error is introduced by React Hook Form registration or shared-component props.

### Task 3: Verify regression safety and rendered layout

**Files:**
- Inspect: `apps/client/src/App.tsx`
- Inspect: `apps/client/src/components/AuthCard.tsx`
- Inspect: `apps/client/src/App.css`
- Inspect: `apps/client/src/App.test.tsx`
- Inspect: `apps/client/package.json`
- Inspect: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Tasks 1–2 implementation.
- Produces: test, typecheck, build, desktop/mobile rendering, and final-diff evidence; no source-code API.

- [x] **Step 1: Run the client verification suite**

Run:

```bash
pnpm --dir apps/client test
pnpm --dir apps/client typecheck
pnpm --dir apps/client build
```

Expected: all client tests pass, TypeScript exits `0`, and Vite produces the client bundle without errors. Report any pre-existing failure separately from regressions.

- [x] **Step 2: Run browser verification using the Playwright skill**

Use the development server at `http://127.0.0.1:1420/`; restart it with `pnpm --dir apps/client dev --host 127.0.0.1` only if it is no longer listening. Check:

```text
Desktop: 1440 x 900
iPhone: 390 x 844
Short mobile: 390 x 667
```

At each viewport, verify:

```text
- The K mark, “知识库”, “欢迎回来”, both fields, primary action, and account switch are visible.
- There is no horizontal scrollbar, clipped label, text overlap, or control occlusion.
- Keyboard focus is visible on both inputs, the primary action, retry, and mode switch.
- Empty submit shows the field-level email error without leaving the page.
- Registration mode updates title, description, autocomplete semantics, and submit text.
```

Save screenshots outside the repository as `/tmp/knowledge-base-login-desktop.png`, `/tmp/knowledge-base-login-mobile.png`, and `/tmp/knowledge-base-login-mobile-short.png`. Do not add generated screenshots to Git.

- [x] **Step 3: Inspect the final diff for scope and secrets**

Run:

```bash
git diff --check
git status --short
git diff -- apps/client/package.json pnpm-lock.yaml apps/client/src/App.tsx apps/client/src/components/AuthCard.tsx apps/client/src/App.css apps/client/src/App.test.tsx docs/superpowers/specs/2026-10-26-login-page-visual-refresh-design.md docs/superpowers/plans/2026-10-26-login-page-visual-refresh.md
rg -n "service_role|SUPABASE_SERVICE_ROLE_KEY|access_token|refresh_token" apps/client/src apps/client/package.json
```

Expected: `git diff --check` is silent; only requested files plus pre-existing user changes appear; no secret value or service-role configuration is added. Existing synthetic token field names in test fixtures are not a new exposure.

- [x] **Step 4: Report completion without committing**

Report all of the following:

```text
1. Exact files changed.
2. The focused-panel behavior and responsive result.
3. Focused tests, full client tests, typecheck, build, and browser viewport results.
4. Any unverified real Supabase authentication behavior or remaining risk.
5. Confirmation that changes remain local and uncommitted.
```

### Task 4: Address independent review findings

**Files:**
- Modify: `apps/client/src/components/AuthCard.tsx`
- Modify: `apps/client/src/auth/useAuthSession.ts`
- Modify: `apps/client/src/App.css`
- Test: `apps/client/src/App.test.tsx`

- [x] **Step 1: Normalize and validate email input before authentication**

Trim the email through React Hook Form, reject malformed values with an accessible Chinese error, and verify that the auth service receives only the normalized address.

- [x] **Step 2: Close the retry concurrency window**

Move session retry into the loading state synchronously, remove the stale retry action while recovery is pending, and cover the behavior with a deferred request test.

- [x] **Step 3: Scope auth description styling and fill critical test gaps**

Keep the new description color and size local to the auth card, preserve the signed-in workbench styling, and add coverage for short passwords and failed authentication.
