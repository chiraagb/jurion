import { LogOut } from "lucide-react";
import type { AuthUser } from "./useAuth";

export default function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {user.picture ? (
        <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
      ) : null}
      <span className="hidden text-sm text-fg-soft md:inline">{user.name || user.email}</span>
      <button
        onClick={onLogout}
        aria-label="Sign out"
        title="Sign out"
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
