import { lazy, Suspense, useEffect } from "react";
import { MobileNav, NAV_LABEL, Sidebar } from "@/components/layout/AppNav";
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
const GraphPage = lazy(() => import("@/features/graph/GraphPage")); // draws with React Flow, which is large: loaded only when opened
import ProblemsPage from "@/features/problems/ProblemsPage";
import EvaluationPage from "@/features/evaluation/EvaluationPage";
import SessionsPage from "@/features/sessions/SessionsPage";
import SearchPage from "@/features/search/SearchPage";
import {
  ReferenceDock,
  ReferenceProvider,
  useReference,
} from "@/features/clause/Reference";
import { navigate, useRoute } from "@/lib/router";
import SettingsDialog from "@/features/settings/SettingsDialog";

export default function App() {
  return (
    <ReferenceProvider>
      <Shell />
    </ReferenceProvider>
  );
}

function Shell() {
  const { close: closeReference } = useReference();
  const { user, loading: authLoading, error, login, logout } = useAuth();
  const { services, apiDown, loading, refresh } = useHealth();
  const { segments, params } = useRoute();
  const known = segments[0] in NAV_LABEL ? segments[0] : undefined;
  const tab = known ?? "ask";
  useEffect(() => {
    if (!known) navigate("/ask", true); // "/" and unknown paths
    document.title = `Jurion · ${NAV_LABEL[tab]}`;
    closeReference(); // a reference belongs to the page it was opened from
  }, [known, tab, closeReference]);

  // The header's real height (it can wrap on narrow screens), so full-height screens like Ask fill exactly the rest of the window.
  useEffect(() => {
    const h = document.getElementById("app-header");
    if (!h) return;
    const set = () =>
      document.documentElement.style.setProperty(
        "--header-h",
        `${h.offsetHeight}px`,
      );
    set();
    const ro = new ResizeObserver(set);
    ro.observe(h);
    return () => ro.disconnect();
  }, [user]);

  if (authLoading) return <div className="min-h-dvh" aria-busy />;
  if (!user) return <LoginPage onCredential={login} error={error} />;

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <Header account={<UserMenu user={user} onLogout={logout} />}>
        <ServiceStatus
          services={services}
          loading={loading}
          onRefresh={refresh}
        />
        <SettingsDialog />
      </Header>
      <MobileNav current={tab} />
      <div className="lg:flex">
        <Sidebar current={tab} />
        <main
          id="main"
          className={`min-w-0 flex-1 ${tab === "ask" ? "" : "mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10"}`}
        >
          {/* Ask and the Parser Lab stay mounted, so a running answer or an unsaved parse survives a visit to another tab */}
          <div hidden={tab !== "ask"}>
            <AskPage
              q={params.get("q") ?? ""}
              session={params.get("s") ?? ""}
              active={tab === "ask"}
            />
          </div>
          <div hidden={tab !== "parser"}>
            <ParserLab apiDown={apiDown} />
          </div>
          {tab === "contracts" && (
            <ContractsPage
              id={segments[1]}
              page={Number(params.get("page")) || undefined}
              clause={
                params.has("clause") ? Number(params.get("clause")) : undefined
              }
            />
          )}
          {tab === "graph" && (
            <Suspense
              fallback={
                <p className="text-muted" aria-busy>
                  Loading…
                </p>
              }
            >
              <GraphPage />
            </Suspense>
          )}
          {tab === "search" && <SearchPage q={params.get("q") ?? ""} />}
          {tab === "sessions" && <SessionsPage id={segments[1]} />}
          {tab === "problems" && <ProblemsPage />}
          {tab === "evaluation" && <EvaluationPage />}
          {tab === "report" && <ReportPage />}
        </main>
        <ReferenceDock />
      </div>
    </div>
  );
}
