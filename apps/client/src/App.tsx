import { StatusMessage } from '@oxygen-design/ui';
import { AuthCard } from './components/AuthCard';
import { MainShell } from './components/MainShell';
import { defaultAuthService, type AuthService } from './auth/authService';
import { useAuthSession } from './auth/useAuthSession';
import { defaultFileService, type FileService } from './files/fileService';
import { defaultRecycleBinService, type RecycleBinService } from './files/recycleBinService';
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
import { Card } from './components/ui/Card';
import './App.css';

interface AppProps {
  authService?: AuthService;
  fileService?: FileService;
  recycleBinService?: RecycleBinService;
  forceAuthPage?: boolean;
  searchHistoryService?: SearchHistoryService;
  searchService?: SearchService;
  uploadService?: UploadService;
  workspaceService?: WorkspaceService;
}

export default function App({
  authService = defaultAuthService,
  fileService = defaultFileService,
  recycleBinService = defaultRecycleBinService,
  forceAuthPage = false,
  searchHistoryService = defaultSearchHistoryService,
  searchService = defaultSearchService,
  uploadService = defaultUploadService,
  workspaceService = defaultWorkspaceService
}: AppProps) {
  const { error, isLoading, retry, session } = useAuthSession(authService);

  if (isLoading) {
    return (
      <main className="auth-page">
        <Card className="auth-card auth-loading">
          <div className="auth-brand" aria-label="知识库">
            <span className="auth-brand__mark" aria-hidden="true">K</span>
            <span className="auth-brand__name">知识库</span>
          </div>
          <StatusMessage aria-live="polite">正在读取当前设备会话…</StatusMessage>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <AuthCard
        authError={error}
        existingSession={session}
        onRetry={retry}
        onSignIn={authService.signInWithPassword}
        onSignOutCurrentDevice={authService.signOutCurrentDevice}
        onSignUp={authService.signUpWithPassword}
      />
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
      recycleBinService={recycleBinService}
      searchHistoryService={searchHistoryService}
      searchService={searchService}
      uploadService={uploadService}
      workspaceService={workspaceService}
    />
  );
}
