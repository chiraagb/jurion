import { useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import {
  fetchKeyHints, loadProvider, removeKey, saveKey, saveProvider, type Provider,
} from "./llmConfig";

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  { id: "gemini", label: "Google Gemini", hint: "AIza…" },
  { id: "openai", label: "OpenAI (ChatGPT)", hint: "sk-…" },
];

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";

/** Gear button + native <dialog> (focus trap, Esc and backdrop handled by the browser). */
export default function SettingsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<Provider>(loadProvider);
  const [saved, setSaved] = useState<Partial<Record<Provider, string>>>({}); // masked hints from the server
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ gemini: "", openai: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setProvider(loadProvider());
    setDrafts({ gemini: "", openai: "" });
    setError(null);
    ref.current?.showModal();
    try {
      setSaved(await fetchKeyHints());
    } catch (e) {
      setError(errorText(e));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      saveProvider(provider);
      for (const p of PROVIDERS) if (drafts[p.id].trim()) await saveKey(p.id, drafts[p.id].trim());
      ref.current?.close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Provider) => {
    try {
      await removeKey(p);
      setSaved(await fetchKeyHints());
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <button
        onClick={open}
        aria-label="API key settings"
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <KeyRound className="h-4 w-4" aria-hidden />
      </button>

      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-surface p-0 text-fg backdrop:bg-black/50"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-5 p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold">API keys</h2>
              <p className="mt-1 text-sm text-muted">
                Used only when a contract is too messy for the local parser. Keys are encrypted and stored in the
                database; they are never shown again, only a masked hint. Leave blank to use the server's own key.
              </p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <fieldset className="space-y-2">
            <legend className="caption mb-2">Fallback provider</legend>
            {PROVIDERS.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 text-base">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === p.id}
                  onChange={() => setProvider(p.id)}
                  className="accent-accent"
                />
                {p.label}
              </label>
            ))}
          </fieldset>

          {PROVIDERS.map((p) => (
            <div key={p.id}>
              <div className="flex items-center justify-between">
                <label htmlFor={`key-${p.id}`} className="caption">
                  {p.label} key
                </label>
                {saved[p.id] && (
                  <span className="flex items-center gap-2 text-sm text-muted">
                    Saved <code className="font-mono">{saved[p.id]}</code>
                    <button type="button" onClick={() => remove(p.id)} className="cursor-pointer text-danger hover:underline">
                      Remove
                    </button>
                  </span>
                )}
              </div>
              <input
                id={`key-${p.id}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={drafts[p.id]}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder={saved[p.id] ? "Paste a new key to replace it" : p.hint}
                className="mt-1 h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 font-mono text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </div>
          ))}

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="cursor-pointer rounded-lg border border-line-strong px-4 py-2 text-sm text-fg-soft hover:bg-raised"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
