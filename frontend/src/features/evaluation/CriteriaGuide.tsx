import { useEffect, useRef } from "react";
import { CRITERIA, NONE_CRITERION, type AnswerRow } from "./criteria";

const clip = (t: string, n = 180) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

/** The criteria in plain language, each with a real passing and a real failing answer from the latest run. Sits above the numbers on purpose. */
export default function CriteriaGuide({ rows }: { rows: AnswerRow[] }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (location.hash === "#criteria") box.current?.scrollIntoView({ behavior: "auto", block: "start" }); }, []);
  const all = [...CRITERIA, NONE_CRITERION];
  const noneRows = rows.filter((r) => r.kind === "none");
  return (
    <section ref={box} id="criteria" aria-labelledby="criteria-title" className="scroll-mt-20 space-y-4">
      <div>
        <h2 id="criteria-title" className="font-display text-2xl font-semibold">How answers are scored</h2>
        <p className="mt-2 max-w-3xl text-fg-soft">
          Every question has a known right answer written down in advance. The same questions go to both systems and the same rules score them: most are decided by a text match, not by an AI&apos;s opinion.
          The one AI judge (faithfulness) is a bigger model than the one that wrote the answers.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {all.map((c) => {
          const pool = c.key === "correctly_refused" ? noneRows : rows;
          const pass = c.key === "correctly_refused" ? noneRows.find((r) => r.refused) : "pass" in c ? pool.find((c as { pass: (r: AnswerRow) => boolean }).pass) : undefined;
          const fail = c.key === "correctly_refused" ? noneRows.find((r) => !r.refused) : "fail" in c ? pool.find((c as { fail: (r: AnswerRow) => boolean }).fail) : undefined;
          return (
            <li key={c.key} className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="flex items-baseline justify-between gap-3 font-semibold">
                {c.name}
                <span className="text-xs font-normal text-muted">{c.better === "higher" ? "higher is better" : "lower is better"}</span>
              </h3>
              <p className="mt-1 text-sm text-fg-soft">{c.means}</p>
              <p className="mt-1.5 text-xs text-muted"><b className="font-semibold text-fg-soft">Decided by:</b> {c.decidedBy}</p>
              {(pass || fail) && (
                <dl className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
                  {pass && <div><dt className="font-semibold text-accent-fg">Passes: “{clip(pass.question, 90)}”</dt><dd className="mt-0.5 text-muted">{clip(pass.answer)}</dd></div>}
                  {fail && <div><dt className="font-semibold text-danger">Fails: “{clip(fail.question, 90)}”</dt><dd className="mt-0.5 text-muted">{clip(fail.answer) || "(no answer)"}</dd></div>}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
