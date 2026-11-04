"""Retrieval quality on a labelled question set: does the right clause come back, and how high?
Compares vector-only, keyword-only and hybrid (what the app uses) on the same questions.

  uv run python -W ignore -m tests.eval_qa              # retrieval only (needs the OpenAI key saved in the app; ~40 embedding calls)
Questions: tests/qa/questions.json. A question's gold is "a clause of <doc> whose text contains <phrase>"; kind "none" has no answer.
Results are written to tests/qa/results.json (shown on the Evaluation page)."""
import asyncio
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import select
from app import embeddings
from app.database import AsyncSessionLocal, Document
from app.embeddings import MODEL, expand_thin, hybrid, openai_key

QA = Path(__file__).parent / "qa"
MODES = {"vector": dict(use_keyword=False), "keyword": dict(use_vector=False), "hybrid": {}}
COLUMNS = (*MODES, "context")  # context = hybrid, then each heading-only clause is widened with the clauses after it (what Ask does)
KS = (1, 3, 5, 10)
norm = lambda t: " ".join(t.split()).lower()


def is_gold(filename: str, content: str, q: dict) -> bool:
    """The clause is of the right contract and holds the answer text (phrase may be a list: any one counts)."""
    phrases = q["phrase"] if isinstance(q["phrase"], list) else [q["phrase"]]
    return filename.startswith(q["doc"]) and any(norm(p) in norm(content) for p in phrases)


def gold_rank(hits: list[dict], q: dict) -> int | None:
    """1-based rank of the first clause that is the right one, else None."""
    if not q["doc"]:  # kind "none": there is no right clause
        return None
    return next((i for i, h in enumerate(hits, 1) if is_gold(h["filename"], h["content"], q)), None)


def summarize(ranks: list[int | None]) -> dict:
    n = len(ranks)
    return {**{f"hit@{k}": round(sum(r is not None and r <= k for r in ranks) / n, 3) for k in KS},
            "mrr": round(statistics.fmean(1 / r if r else 0 for r in ranks), 3), "n": n}


async def retrieval(questions: list[dict]) -> dict:
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(Document.user_id).where(Document.filename.startswith(questions[0]["doc"])).limit(1))).scalar()
        if not owner:
            sys.exit(f"No saved contract starts with {questions[0]['doc']!r}: save the contracts the questions are about first.")
        key = await openai_key(db, owner)
        if not key:
            sys.exit("No OpenAI key: save one in the app (key icon) or set OPENAI_API_KEY.")
        cache: dict[str, list[float]] = {}  # each question is embedded once, not once per mode
        real = embeddings.embed_texts
        async def memo(k, texts):
            return await _memo(real, cache, k, texts)
        embeddings.embed_texts = memo
        rows = []
        for q in questions:
            row = {"id": q["id"], "question": q["question"], "kind": q["kind"], "ranks": {}}
            for mode, flags in MODES.items():
                hits, _, _ = await hybrid(db, owner, q["question"], key, 10, **flags)
                row["ranks"][mode] = gold_rank(hits, q)
                if mode == "hybrid":
                    await expand_thin(db, hits)
                    row["ranks"]["context"] = gold_rank(hits, q)
                    row["top"] = [f"{h['clause_identifier']} {h['title'][:40]} ({h['filename'][:14]})" for h in hits[:3]]
            rows.append(row)
        embeddings.embed_texts = real
    return {"rows": rows, "owner": str(owner)}


async def _memo(real, cache, key, texts):
    missing = [t for t in dict.fromkeys(texts) if t not in cache]
    if missing:
        cache.update(zip(missing, await real(key, missing)))
    return [cache[t] for t in texts]


def report(rows: list[dict]) -> dict:
    answerable = [r for r in rows if r["kind"] != "none"]
    out = {"all": {m: summarize([r["ranks"][m] for r in answerable]) for m in COLUMNS}}
    for kind in ("direct", "paraphrase", "broad"):
        out[kind] = {m: summarize([r["ranks"][m] for r in answerable if r["kind"] == kind]) for m in COLUMNS}
    return out


def show(rep: dict):
    print(f"{'':<31}" + "".join(f"{m:>10}" for m in COLUMNS))
    for group, label in (("all", "all answerable"), ("direct", "direct (same words)"), ("paraphrase", "paraphrase (other words)"), ("broad", "broad (a whole section)")):
        for metric in ("hit@1", "hit@3", "hit@5", "hit@10", "mrr"):
            print(f"{label if metric == 'hit@1' else '':<25}{metric:>6}" + "".join(f"{rep[group][m][metric]:>10.3f}" for m in COLUMNS))
        print(f"{'':<25}  n={rep[group]['hybrid']['n']}")


if __name__ == "__main__":
    qs = json.loads((QA / "questions.json").read_text())
    res = asyncio.run(retrieval([q for q in qs]))
    rep = report(res["rows"])
    show(rep)
    prev = json.loads((QA / "results.json").read_text()) if (QA / "results.json").exists() else {}
    slot = "baseline" if "--baseline" in sys.argv else "retrieval"  # --baseline: the numbers before a change, kept to compare against
    (QA / "results.json").write_text(json.dumps({**prev, "ran_at": datetime.now(timezone.utc).isoformat(), "embedding_model": MODEL, "questions": len(qs),
                                                 slot: {"summary": rep, "rows": res["rows"], "ran_at": datetime.now(timezone.utc).isoformat()}}, indent=1, ensure_ascii=False))
    for r in res["rows"]:
        if r["kind"] != "none" and r["ranks"]["hybrid"] != 1:
            print(f"  Q{r['id']} {r['kind']:<10} hybrid rank {r['ranks']['hybrid']} (vec {r['ranks']['vector']}, kw {r['ranks']['keyword']}): {r['question']}")
