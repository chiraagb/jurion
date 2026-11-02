import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SystemHealth {
  status: string;
  postgres_vector: boolean;
  neo4j: boolean;
  redis: boolean;
}

export function useHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<SystemHealth>("/health");
      setHealth(data);
      setApiDown(false);
    } catch {
      setApiDown(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const services: [string, boolean | undefined][] = [
    ["API", !apiDown && !!health],
    ["Postgres", health?.postgres_vector],
    ["Neo4j", health?.neo4j],
    ["Redis", health?.redis],
  ];

  return { services, apiDown, loading, refresh };
}
