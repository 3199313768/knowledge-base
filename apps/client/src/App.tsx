import { AuthCard } from './components/AuthCard';
import { MainShell } from './components/MainShell';
import { defaultAuthService, type AuthService } from './auth/authService';
import { useAuthSession } from './auth/useAuthSession';
import {
  defaultWorkspaceService,
  type WorkspaceService
} from './workspaces/workspaceService';
import './App.css';

interface AppProps {
  authService?: AuthService;
  forceAuthPage?: boolean;
  workspaceService?: WorkspaceService;
}

export default function App({
  authService = defaultAuthService,
  forceAuthPage = false,
  workspaceService = defaultWorkspaceService
}: AppProps) {
  const { error, isLoading, session } = useAuthSession(authService);

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p>正在读取当前设备会话…</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="message message--error">{error}</p>
        </section>
      </main>
    );
  }

  if (forceAuthPage || !session) {
    return (
      <AuthCard
        existingSession={session}
        onSignIn={authService.signInWithPassword}
        onSignOutCurrentDevice={authService.signOutCurrentDevice}
        onSignUp={authService.signUpWithPassword}
      />
    );
  }

  return (
    <MainShell
      email={session.user.email ?? '当前账号'}
      onSignOutCurrentDevice={authService.signOutCurrentDevice}
      workspaceService={workspaceService}
    />
  );
}
