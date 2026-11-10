import { LogOut } from "lucide-react";
import Popover from "@/components/ui/Popover";
import type { AuthUser } from "./useAuth";

/** The signed-in user as an avatar; the name, email and Sign out are in the menu it opens. */
export default function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const name = user.name || user.email;
  return (
    <Popover
      label={`Account: ${name}`}
      className="grid h-9 w-9 place-items-center overflow-hidden rounded-full ring-1 ring-line-strong transition-shadow hover:ring-accent"
      trigger={user.picture
        ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-9 w-9 object-cover" />
        : <span className="text-sm font-semibold text-accent-fg" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>}
    >
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold text-fg">{name}</p>
        {user.name && <p className="truncate text-xs text-muted">{user.email}</p>}
      </div>
      <button onClick={onLogout} className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg border-t border-line px-3 text-sm text-fg-soft transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
        <LogOut className="h-4 w-4" aria-hidden /> Sign out
      </button>
    </Popover>
  );
}
