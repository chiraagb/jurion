import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}

/** Who is signed in. The session itself is an HttpOnly cookie the browser sends automatically. */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuthUser>("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(null)) // 401 = signed out
      .finally(() => setLoading(false));
  }, []);

  const login = async (credential: string) => {
    setError(null);
    try {
      setUser((await api.post<AuthUser>("/auth/google", { credential })).data);
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Sign-in failed. Try again.");
    }
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
  };

  return { user, loading, error, login, logout };
}
