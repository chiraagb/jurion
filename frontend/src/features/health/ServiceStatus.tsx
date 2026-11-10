import { RefreshCw } from "lucide-react";
import Popover from "@/components/ui/Popover";

interface Props {
  services: [string, boolean | undefined][];
  loading: boolean;
  onRefresh: () => void;
}

/** One small pill for all the services: green when everything is up, red naming what is down. Open it for each service. */
export default function ServiceStatus({ services, loading, onRefresh }: Props) {
  const down = services.filter(([, ok]) => !ok).map(([n]) => n);
  const dot = loading ? "bg-subtle" : down.length ? "bg-danger" : "bg-success";
  const text = loading ? "Checking…" : down.length ? (down.length === 1 ? `${down[0]} offline` : `${down.length} services offline`) : "All systems online";
  return (
    <Popover
      label={`Service status: ${text}`}
      className="flex h-9 items-center gap-2 rounded-full border border-line paper px-3 text-xs text-fg-soft transition-colors hover:border-line-strong"
      trigger={<><span className={`h-2 w-2 rounded-full ${dot} ${loading ? "motion-safe:animate-pulse" : ""}`} aria-hidden /><span className="hidden sm:inline">{text}</span></>}
    >
      <ul className="space-y-0.5" aria-label="Service status">
        {services.map(([name, ok]) => (
          <li key={name} className="flex items-center justify-between gap-6 rounded-lg px-3 py-2 text-sm">
            <span className="flex items-center gap-2.5"><span className={`h-2 w-2 rounded-full ${loading ? "bg-subtle" : ok ? "bg-success" : "bg-danger"}`} aria-hidden />{name}</span>
            <span className="text-xs text-muted">{loading ? "checking" : ok ? "online" : "offline"}</span>
          </li>
        ))}
      </ul>
      <button onClick={onRefresh} disabled={loading} className="mt-1 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-t border-line text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Check again
      </button>
    </Popover>
  );
}
