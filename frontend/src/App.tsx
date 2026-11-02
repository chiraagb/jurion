import { useEffect, useState } from "react";
import { api } from "./api";
import {
  Database,
  Network,
  Server,
  HardDrive,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";

interface SystemHealth {
  status: string;
  postgres_vector: boolean;
  neo4j: boolean;
  redis: boolean;
}

export default function App() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<SystemHealth>("/health");
      setHealth(response.data);
    } catch (err: any) {
      setError(
        err.message || "Unable to communicate with the FastAPI backend.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSync();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Network className="text-cyan-400 h-6 w-6" /> Jurion Stack
              Diagnostics
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Verifying Frontend ⟷ Backend ⟷ Persistence Sync
            </p>
          </div>
          <button
            onClick={checkSync}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-sm text-rose-300 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Backend Unreachable</p>
              <p className="text-xs text-rose-400/90 mt-1">{error}</p>
              <p className="text-xs text-slate-400 mt-2">
                Make sure your FastAPI server is running with{" "}
                <code className="text-slate-200 bg-slate-800 px-1 py-0.5 rounded">
                  uv run fastapi dev app/main.py
                </code>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* FastAPI Service */}
            <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <Server className="text-blue-400 h-5 w-5" />
                <div>
                  <div className="text-sm font-medium">
                    FastAPI Backend Gateway
                  </div>
                  <div className="text-xs text-slate-400">
                    Port 8000 via Vite Proxy
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              </span>
            </div>

            {/* PostgreSQL + pgvector */}
            <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <Database className="text-indigo-400 h-5 w-5" />
                <div>
                  <div className="text-sm font-medium">
                    PostgreSQL (pgvector)
                  </div>
                  <div className="text-xs text-slate-400">
                    Vector store & chunk metadata
                  </div>
                </div>
              </div>
              {health?.postgres_vector ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Synced
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded-md">
                  <XCircle className="h-3.5 w-3.5" /> Disconnected
                </span>
              )}
            </div>

            {/* Neo4j Graph */}
            <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <Network className="text-cyan-400 h-5 w-5" />
                <div>
                  <div className="text-sm font-medium">
                    Neo4j Graph Database
                  </div>
                  <div className="text-xs text-slate-400">
                    Clause hierarchies & relationships
                  </div>
                </div>
              </div>
              {health?.neo4j ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Synced
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded-md">
                  <XCircle className="h-3.5 w-3.5" /> Disconnected
                </span>
              )}
            </div>

            {/* Redis */}
            <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <HardDrive className="text-amber-400 h-5 w-5" />
                <div>
                  <div className="text-sm font-medium">
                    Redis Ingestion Broker
                  </div>
                  <div className="text-xs text-slate-400">
                    Queue broker & semantic cache
                  </div>
                </div>
              </div>
              {health?.redis ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Synced
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded-md">
                  <XCircle className="h-3.5 w-3.5" /> Disconnected
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
