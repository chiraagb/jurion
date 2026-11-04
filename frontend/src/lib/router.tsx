import { useMemo, useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes } from "react";

// A tiny History-API router: the app has five routes, so react-router would be more code than this.
const subscribe = (cb: () => void) => {
  addEventListener("popstate", cb);
  addEventListener("navigate", cb);
  return () => {
    removeEventListener("popstate", cb);
    removeEventListener("navigate", cb);
  };
};

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  dispatchEvent(new Event("navigate"));
}

/** The current path split into segments ("/contracts/ab12" -> ["contracts", "ab12"]) plus the ?query. */
export function useRoute() {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  return useMemo(() => {
    const u = new URL(href, location.origin);
    return { segments: u.pathname.split("/").filter(Boolean), params: u.searchParams };
  }, [href]);
}

/** A real <a href>: opens in a new tab, copies as a link, and a plain click stays in the app. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === "_blank") return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
