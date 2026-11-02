import Header from "@/components/layout/Header";
import ServiceStatus from "@/features/health/ServiceStatus";
import { useHealth } from "@/features/health/useHealth";
import SettingsDialog from "@/features/settings/SettingsDialog";
import ParserLab from "@/features/parser/ParserLab";

export default function App() {
  const { services, apiDown, loading, refresh } = useHealth();

  return (
    <div className="min-h-dvh">
      <Header>
        <ServiceStatus services={services} loading={loading} onRefresh={refresh} />
        <SettingsDialog />
      </Header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <ParserLab apiDown={apiDown} />
      </main>
    </div>
  );
}
