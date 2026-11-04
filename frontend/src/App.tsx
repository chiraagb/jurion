import { useEffect } from "react";
import Header from "@/components/layout/Header";
import LoginPage from "@/features/auth/LoginPage";
import UserMenu from "@/features/auth/UserMenu";
import { useAuth } from "@/features/auth/useAuth";
import ServiceStatus from "@/features/health/ServiceStatus";
import { useHealth } from "@/features/health/useHealth";
import ContractsPage from "@/features/documents/ContractsPage";
import ParserLab from "@/features/parser/ParserLab";
import ReportPage from "@/features/report/ReportPage";
import AskPage from "@/features/ask/AskPage";
import SearchPage from "@/features/search/SearchPage";
import { Link, navigate, useRoute } from "@/lib/router";
import SettingsDialog from "@/features/settings/SettingsDialog";

export default function App() {
  const { user, loading: authLoading, error, login, logout } = useAuth();
  const { services, apiDown, loading, refresh } = useHealth();
  const { segments, params } = useRoute();
  const TABS = [["parser", "Parser Lab"], ["contracts", "My contracts"], ["ask", "Ask"], ["search", "Search"], ["report", "Parser report"]] as const;
  const known = TABS.find(([id]) => id === segments[0]);
  const tab = known?.[0] ?? "parser";
  useEffect(() => {
    if (!known) navigate("/parser", true); // "/" and unknown paths
    document.title = `Jurion · ${(known ?? TABS[0])[1]}`;
  }, [known]);

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
        <nav aria-label="Sections" className="mb-8 flex gap-1 border-b border-line">
          {TABS.map(([id, label]) => (
            <Link
              key={id}
              to={`/${id}`}
              aria-current={tab === id ? "page" : undefined}
              className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-base transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent ${
                tab === id ? "border-accent font-bold text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {/* Both stay mounted so switching tabs doesn't lose an unsaved parse result */}
        <div hidden={tab !== "parser"}>
          <ParserLab apiDown={apiDown} />
        </div>
        {tab === "contracts" && <ContractsPage id={segments[1]} page={Number(params.get("page")) || undefined} />}
        {tab === "ask" && <AskPage q={params.get("q") ?? ""} />}
        {tab === "search" && <SearchPage q={params.get("q") ?? ""} />}
        {tab === "report" && <ReportPage />}
      </main>
    </div>
  );
}
