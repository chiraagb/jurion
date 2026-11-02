import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import type { Phase } from "../types";
import { MAX_MB } from "../useParseContract";

interface Props {
  phase: Phase;
  file: File | null;
  disabled: boolean;
  apiDown: boolean;
  onFile: (f: File) => void;
}

export default function Dropzone({ phase, file, disabled, apiDown, onFile }: Props) {
  const [dragging, setDragging] = useState(false);
  const busy = phase === "uploading" || phase === "parsing";

  return (
    <section aria-label="Upload a contract">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f && !disabled) onFile(f);
        }}
        className={`group relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors duration-200 focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-accent ${
          dragging ? "border-accent bg-accent/5" : "border-line-strong bg-surface/50 hover:bg-surface"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // lets the same file be picked again
            if (f) onFile(f);
          }}
        />
        <span className="grid h-14 w-14 place-items-center rounded-full bg-raised text-accent transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
          {busy ? <Loader2 className="h-6 w-6 motion-safe:animate-spin" /> : <FileUp className="h-6 w-6" />}
        </span>
        {busy && file ? (
          <span className="text-base text-fg">
            {phase === "uploading" ? "Uploading" : "Parsing"} <span className="font-medium">{file.name}</span>…
          </span>
        ) : (
          <>
            <span className="text-base text-fg">
              <span className="font-bold text-accent">Choose a PDF</span> or drag it here
            </span>
            <span className="text-sm text-subtle">Contract PDFs up to {MAX_MB} MB</span>
          </>
        )}
        {apiDown && (
          <span className="text-sm text-danger">
            Backend is offline. Start it with <code className="font-mono">uv run fastapi dev app/main.py</code>
          </span>
        )}
      </label>
    </section>
  );
}
