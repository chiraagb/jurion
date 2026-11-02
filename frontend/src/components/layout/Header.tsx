import type { ReactNode } from "react";
import { Scale } from "lucide-react";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export default function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Scale className="h-6 w-6 text-accent" aria-hidden />
          <span className="font-display text-2xl font-semibold tracking-tight">Jurion</span>
          <span className="caption hidden border-l border-line-strong pl-2.5 sm:inline">Contract Parser Lab</span>
        </div>

        <div className="flex items-center gap-2">
          {children}
          <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
          <AnimatedThemeToggler
            aria-label="Toggle light or dark theme"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent [&_svg]:h-4 [&_svg]:w-4"
          />
        </div>
      </div>
    </header>
  );
}
