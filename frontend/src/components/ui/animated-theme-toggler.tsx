import { useCallback, useEffect, useRef, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { flushSync } from "react-dom"

const DURATION = 400

// The new theme grows as a circle from the button. Coordinates are percentages of the snapshot box: Chrome renders px
// clip-path coordinates on ::view-transition-new(root) unscaled on fractional display scales for the first transition.
function clipPaths(cx: number, cy: number, w: number, h: number): [string, string] {
  const at = `${(cx / w) * 100}% ${(cy / h) * 100}%`
  const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
  // circle() percentage radii resolve against hypot(w, h) / sqrt(2) of the reference box
  return [`circle(0% at ${at})`, `circle(${(r / (Math.hypot(w, h) / Math.SQRT2)) * 100}% at ${at})`]
}

export const AnimatedThemeToggler = ({ className, ...props }: React.ComponentPropsWithoutRef<"button">) => {
  const [isDark, setIsDark] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const anim = useRef<Animation | null>(null)

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      observer.disconnect()
      anim.current?.cancel()
      const root = document.documentElement
      if (root.dataset.magicuiThemeVt !== "active") return
      delete root.dataset.magicuiThemeVt
      root.style.removeProperty("--magicui-theme-toggle-vt-duration")
      root.style.removeProperty("--magicui-theme-vt-clip-from")
    }
  }, [])

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current
    const root = document.documentElement
    if (!button || busy.current || root.dataset.magicuiThemeVt === "active") return

    const applyTheme = () => {
      root.classList.toggle("dark") // synchronously, so the View Transition snapshots the new theme
      setIsDark(!isDark)
      try {
        localStorage.setItem("theme", isDark ? "light" : "dark")
      } catch {
        /* storage blocked: the theme still changes for this visit */
      }
    }
    if (typeof document.startViewTransition !== "function") {
      applyTheme()
      return
    }

    const { top, left, width, height } = button.getBoundingClientRect()
    // innerWidth/innerHeight (not visualViewport): percentages resolve against the snapshot box, which includes scrollbars
    const clipPath = clipPaths(left + width / 2, top + height / 2, window.innerWidth, window.innerHeight)
    root.dataset.magicuiThemeVt = "active"
    root.style.setProperty("--magicui-theme-toggle-vt-duration", `${DURATION}ms`)
    // pin the collapsed clip-path in CSS so Firefox does not paint the new theme unclipped before the animation starts
    root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0])
    const cleanup = () => {
      busy.current = false
      delete root.dataset.magicuiThemeVt
      root.style.removeProperty("--magicui-theme-toggle-vt-duration")
      root.style.removeProperty("--magicui-theme-vt-clip-from")
      anim.current?.cancel()
      anim.current = null
    }

    busy.current = true
    const transition = document.startViewTransition(() => flushSync(applyTheme))
    transition.finished.finally(cleanup).catch(() => {})
    transition.ready
      .then(() => {
        anim.current = root.animate(
          { clipPath },
          { duration: DURATION, easing: "ease-in-out", fill: "forwards", pseudoElement: "::view-transition-new(root)" },
        )
      })
      .catch(() => {})
  }, [isDark])

  return (
    <button type="button" ref={buttonRef} onClick={toggleTheme} className={className} {...props}>
      {isDark ? <Sun /> : <Moon />}
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
