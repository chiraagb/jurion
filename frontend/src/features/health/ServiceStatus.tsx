import { RefreshCw } from "lucide-react";

interface Props {
  services: [string, boolean | undefined][];
  loading: boolean;
  onRefresh: () => void;
}

export default function ServiceStatus({ services, loading, onRefresh }: Props) {
  return (
    <div className="flex items-center gap-2" aria-label="Service status">
      {services.map(([name, ok]) => (
        <span
          key={name}
          className="flex items-center gap-1.5 rounded-full border border-line paper px-2.5 py-1 text-xs text-fg-soft"
        >
          <span
            className={`h-2 w-2 rounded-full ${loading ? "bg-subtle" : ok ? "bg-success" : "bg-danger"}`}
            aria-hidden
          />
          {name}
          <span className="sr-only">{loading ? "checking" : ok ? "online" : "offline"}</span>
        </span>
      ))}
      <button
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh service status"
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "motion-safe:animate-spin" : ""}`} />
      </button>
    </div>
  );
}
