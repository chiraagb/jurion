import { useEffect, useRef } from "react";

const WIDTH = 300; // Google's own button accepts 200-400px

/** Our styled button underneath, Google's real "Sign in with Google" button invisibly on top:
 *  styling follows the theme, while the click still goes through Google's secure widget. */
export default function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = () => {
      const gsi = (window as any).google.accounts.id;
      gsi.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: (r: { credential: string }) => onCredential(r.credential),
      });
      gsi.renderButton(ref.current, { type: "standard", size: "large", text: "continue_with", width: WIDTH });
    };
    if ((window as any).google) return init();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = init;
    document.head.append(script);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="group relative h-11"
      style={{ width: WIDTH }}
    >
      <div
        aria-hidden
        className="pointer-events-none flex h-full w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-base font-bold text-fg transition-colors duration-200 group-hover:border-accent group-hover:bg-raised group-focus-within:border-accent group-focus-within:bg-raised group-focus-within:shadow-[inset_0_0_0_1px_var(--accent)]"
      >
        <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
          <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        Continue with Google
      </div>
      {/* The real button: invisible but clickable; stretched from 40px to fill our 44px. */}
      <div ref={ref} className="absolute inset-0 origin-top-left scale-y-[1.1] overflow-hidden opacity-[0.01]" />
    </div>
  );
}
