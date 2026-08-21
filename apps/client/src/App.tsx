import { AuthCard } from './components/AuthCard';
import { MainShell } from './components/MainShell';
import { defaultAuthService, type AuthService } from './auth/authService';
import { useAuthSession } from './auth/useAuthSession';
import { defaultFileService, type FileService } from './files/fileService';
import { defaultSearchService, type SearchService } from './search/searchService';
import { defaultSearchHistoryService, type SearchHistoryService } from './search/searchHistoryService';
import {
  defaultUploadService,
  type UploadService
} from './uploads/uploadService';
import {
  defaultWorkspaceService,
  type WorkspaceService
} from './workspaces/workspaceService';
import './App.css';

interface AppProps {
  authService?: AuthService;
  fileService?: FileService;
  forceAuthPage?: boolean;
  searchHistoryService?: SearchHistoryService;
  searchService?: SearchService;
  uploadService?: UploadService;
  workspaceService?: WorkspaceService;
}

export default function App({
  authService = defaultAuthService,
  fileService = defaultFileService,
  forceAuthPage = false,
  searchHistoryService = defaultSearchHistoryService,
  searchService = defaultSearchService,
  uploadService = defaultUploadService,
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
      fileService={fileService}
      onSignOutCurrentDevice={authService.signOutCurrentDevice}
      searchHistoryService={searchHistoryService}
      searchService={searchService}
      uploadService={uploadService}
      workspaceService={workspaceService}
    />
  );
}
