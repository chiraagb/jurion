import Header from "@/components/layout/Header";
import LoginPage from "@/features/auth/LoginPage";
import UserMenu from "@/features/auth/UserMenu";
import { useAuth } from "@/features/auth/useAuth";
import ServiceStatus from "@/features/health/ServiceStatus";
import { useHealth } from "@/features/health/useHealth";
import ParserLab from "@/features/parser/ParserLab";
import SettingsDialog from "@/features/settings/SettingsDialog";

export default function App() {
  const { user, loading: authLoading, error, login, logout } = useAuth();
  const { services, apiDown, loading, refresh } = useHealth();

  if (authLoading) return <div className="min-h-dvh" aria-busy />;
  if (!user) return <LoginPage onCredential={login} error={error} />;

  return (
    <div className="min-h-dvh">
      <Header>
        <ServiceStatus services={services} loading={loading} onRefresh={refresh} />
        <SettingsDialog />
        <UserMenu user={user} onLogout={logout} />
      </Header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <ParserLab apiDown={apiDown} />
      </main>
    </div>
  );
}
