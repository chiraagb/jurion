import { Scale } from "lucide-react";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import GoogleButton from "./GoogleButton";

// Illustrative sample only: shows what the parser does, not real data.
const SAMPLE = [
  { id: "1.", title: "SCOPE", body: null },
  { id: "1.1", title: null, body: "The Service Provider shall perform the services described in each Project Agreement." },
  { id: "2.", title: "TERM", body: null },
  {
    id: "2.2",
    title: null,
    body: ["Either party may terminate this Agreement on ", "ninety (90) days written notice", "."],
  },
  { id: "10.", title: "LIMITATION OF LIABILITY", body: null },
];

export default function LoginPage({ onCredential, error }: { onCredential: (c: string) => void; error: string | null }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* Left: a legal pad being parsed, clause by clause */}
      <aside className="legal-pad relative hidden overflow-hidden border-r border-line-strong lg:block" aria-hidden>
        <div className="scan-line pointer-events-none absolute inset-x-0 h-12 -translate-y-1/2 bg-gradient-to-b from-transparent via-accent/15 to-transparent" />
        <div className="flex h-full flex-col justify-between py-10 pl-24 pr-14">
          <div className="animate-rise flex items-center gap-2.5">
            <Scale className="h-5 w-5 text-accent" />
            <span className="font-display text-xl font-semibold">Jurion</span>
          </div>

          <ol className="space-y-5 font-display text-xl leading-snug text-fg-soft">
            {SAMPLE.map((row, i) => (
              <li key={row.id} className="animate-rise flex gap-4" style={{ animationDelay: `${0.5 + i * 0.45}s` }}>
                <span className="w-9 shrink-0 font-mono text-sm leading-7 text-accent-fg">{row.id}</span>
                {row.title ? (
                  <span className="font-semibold tracking-wide text-fg">{row.title}</span>
                ) : Array.isArray(row.body) ? (
                  <span>
                    {row.body[0]}
                    <span className="marker rounded-sm px-0.5 text-fg">{row.body[1]}</span>
                    {row.body[2]}
                    <span className="tag-pop mt-2 flex w-fit items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-1 font-sans text-xs font-bold uppercase tracking-wider text-accent-fg">
                      Termination · p.4
                    </span>
                  </span>
                ) : (
                  <span>{row.body}</span>
                )}
              </li>
            ))}
          </ol>

          <div className="animate-rise" style={{ animationDelay: "3s" }}>
            <svg viewBox="0 0 200 50" className="h-14 w-48 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path pathLength="1" className="sign-draw" d="M5 38 C 20 4, 32 4, 28 30 S 24 48, 46 20 S 70 4, 68 28 S 86 40, 100 18 S 126 8, 136 30 C 150 46, 172 12, 196 28" />
              <path pathLength="1" className="sign-draw" strokeWidth="1" d="M5 46 H 195" />
            </svg>
            <p className="caption mt-1">Example · clauses found, not stored</p>
          </div>
        </div>
      </aside>

      {/* Right: sign in */}
      <div className="relative flex min-h-dvh flex-col">
        <div className="flex justify-end p-4 sm:p-6">
          <AnimatedThemeToggler
            aria-label="Toggle light or dark theme"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent [&_svg]:h-4 [&_svg]:w-4"
          />
        </div>

        <main className="flex flex-1 items-center justify-center px-6 pb-16">
          <section aria-labelledby="login-title" className="animate-rise w-full max-w-sm text-center lg:text-left">
            <Scale className="mx-auto h-7 w-7 text-accent lg:hidden" aria-hidden />
            <p className="caption mt-4 lg:mt-0">Contract intelligence</p>
            <h1 id="login-title" className="mt-2 font-display text-5xl font-medium tracking-tight sm:text-6xl">
              Welcome to Jurion
            </h1>
            <div className="mx-auto my-7 h-1.5 w-16 border-y border-accent lg:mx-0" aria-hidden />
            <p className="font-display text-xl leading-snug text-fg-soft">
              Read every contract by the clause, and know exactly where each answer came from.
            </p>

            <div className="mt-9 flex flex-col items-center gap-4 lg:items-start">
              <GoogleButton onCredential={onCredential} />
              {error && (
                <p role="alert" className="max-w-xs text-sm text-danger">
                  {error}
                </p>
              )}
              <p className="text-sm text-muted">Sign in with your Google account.</p>
            </div>
          </section>
        </main>

        <footer className="caption pb-6 text-center text-subtle">§ Jurion · Contract Parser Lab</footer>
      </div>
    </div>
  );
}
