"""Answer quality: run the real Ask pipeline on every question in tests/qa/questions.json and score what comes back.

  uv run python -W ignore -m tests.eval_answers                                  # the workflow on the 83 original questions
  uv run python -W ignore -m tests.eval_answers --mode agent [--model provider:model] [--runs 3] [--set agentic]

--set agentic uses tests/qa/agentic_questions.json (multi-hop, party-then-clause, compare: questions whose answer needs more than one clause).
Every row also records the cost (LLM calls, tokens, time), so the workflow and the agent are compared on cost as well as correctness.

Per answerable question: was an answer given (not a refusal), did the cited clauses include the right one, were the answer's
claims supported by the clauses it was given (faithfulness), and did it address the question. Per unanswerable question:
did it refuse (detected by how the answer starts, see REFUSAL). The judge is a different, larger model than the one that wrote the answer (OPENAI_MODEL vs ASK_MODEL) to
reduce a model flattering its own output. Costs a few cents. Merged into tests/qa/results.json under "answers"."""
import argparse
import asyncio
import json
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from app.ask.agent import agent_pipeline
from app.ask.workflow import METER, pipeline
from app.core.config import settings
from app.core.database import AsyncSessionLocal, Document
from app.search.embeddings import openai_key
from app.core.llm_keys import provider_key
from tests.eval_qa import QA, is_gold

PARALLEL = 4
# How a refusal starts: "I couldn't find this in your saved contracts", "The clauses provided do not mention ...", "There is no ..."
REFUSAL = re.compile(r"^\W*(?:the\s+(?:provided\s+)?(?:clauses?|contracts?|text|documents?)(?:\s+(?:you\s+|we\s+)?provided)?\s+(?:do(?:es)?\s+not|don'?t)|i\s+(?:couldn'?t|could\s+not|cannot|can'?t)|there\s+(?:is|are)\s+no|no\s+(?:information|mention)|unable\s+to)", re.I)


class Claim(BaseModel):
    claim: str
    supported: bool


class Claims(BaseModel):
    claims: list[Claim]


class Addresses(BaseModel):
    reason: str
    addresses_the_question: bool


async def judge(key: str, schema, system: str, user: str):
    r = await AsyncOpenAI(api_key=key, timeout=90).responses.parse(
        model=settings.OPENAI_MODEL, text_format=schema, input=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.output_parsed


def runner(mode: str, spec: str, mkey: str | None):
    """The pipeline under test: same arguments and events for both, so the scoring below is identical."""
    if mode == "agent":
        return lambda s, owner, key, q: agent_pipeline(s, owner, key, q, suggest=False, clarify=False, model=spec, model_key=mkey)
    return lambda s, owner, key, q: pipeline(s, owner, key, q, suggest=False, clarify=False)


async def score(key: str, owner, q: dict, sem: asyncio.Semaphore, run) -> dict:
    async with sem:
        answer, sources, steps, extra = "", [], 0, {}
        meter, t0 = {"calls": 0, "tokens": 0}, time.perf_counter()
        METER.set(meter)
        async with AsyncSessionLocal() as s:
            async for kind, d in run(s, owner, key, q["question"]):
                if kind == "sources":
                    sources = d["sources"]
                elif kind == "token":
                    answer += d["text"]
                elif kind == "step":
                    steps += 1
                elif kind in ("fallback", "budget"):
                    extra[kind] = True
        row = {"id": q["id"], "question": q["question"], "kind": q["kind"], "answer": answer, "sources": len(sources),
               "llm_calls": meter["calls"], "tokens": meter["tokens"], "latency_ms": round((time.perf_counter() - t0) * 1000), "steps": steps, **extra}
        context = "\n\n".join(f"[{i}] Contract: {x['filename']}\n{x['content']}" for i, x in enumerate(sources, 1))  # the answer names contracts, so the judge must see them
        row["refused"] = not sources or bool(REFUSAL.match(answer))  # a pattern, not a judge: the yes/no AI judge flagged clean answers as refusals
        cited = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
        row["invalid_citations"] = sum(n < 1 or n > len(sources) for n in cited)  # a [n] that points at no source
        if q["doc"]:  # the right clause: did grading keep it, and did the answer cite it
            has = lambda x, g=q: is_gold(x["filename"], x["content"], g)
            row["context_has_gold"] = any(has(x) for x in sources)
            row["cited_gold"] = any(has(x) for i, x in enumerate(sources, 1) if i in cited)
            if q.get("gold_all"):  # compare / multi-hop: a clause for EACH required piece must be cited
                row["found_all"] = all(any(has(x, g) for i, x in enumerate(sources, 1) if i in cited) for g in q["gold_all"])
        if not row["refused"]:
            f = await judge(key, Claims, "List each factual claim the ANSWER makes about the contract. Mark supported=true only if the CLAUSES state it or clearly imply it. Ignore citation markers like [1].",
                            f"CLAUSES:\n{context}\n\nANSWER:\n{answer}")
            row["faithfulness"] = round(sum(c.supported for c in f.claims) / len(f.claims), 3) if f.claims else None
            row["unsupported"] = [c.claim for c in f.claims if not c.supported]
            row["answers_question"] = (await judge(key, Addresses, "Set addresses_the_question to true if the ANSWER directly addresses the QUESTION, whether or not it is correct.", f"QUESTION: {q['question']}\n\nANSWER:\n{answer}")).addresses_the_question
        return row


def pct(xs: list[float], p: float) -> int | None:
    return round(sorted(xs)[min(len(xs) - 1, int(p * len(xs)))]) if xs else None


def summarize(rows: list[dict]) -> dict:
    rate = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    out = {}
    kinds = sorted({r["kind"] for r in rows if r["kind"] != "none"}, key=lambda k: (("direct", "paraphrase", "broad", "graph", "multi").index(k) if k in ("direct", "paraphrase", "broad", "graph", "multi") else 9, k))
    for name, group in (("all", [r for r in rows if r["kind"] != "none"]), *((k, [r for r in rows if r["kind"] == k]) for k in kinds)):
        done = [r for r in group if not r["refused"]]
        faith = [r["faithfulness"] for r in done if r.get("faithfulness") is not None]
        out[name] = {
            "n": len(group), "answered": rate([not r["refused"] for r in group]), "right_clause_in_context": rate([r["context_has_gold"] for r in group]),
            "right_clause_cited": rate([r["cited_gold"] for r in group]),
            "answered_wrong_clause": rate([not r["refused"] and not r["cited_gold"] for r in group]),  # confident, cited, but not the right clause
            "faithfulness": round(statistics.fmean(faith), 3) if faith else None, "addresses_question": rate([r["answers_question"] for r in done]),
            "found_all": rate([r["found_all"] for r in group if "found_all" in r]),  # null when no question of the group needs several clauses
            "llm_calls_median": statistics.median(r["llm_calls"] for r in group) if group else None, "tokens_median": round(statistics.median(r["tokens"] for r in group)) if group else None,
            "latency_p50_ms": pct([r["latency_ms"] for r in group], 0.5), "latency_p90_ms": pct([r["latency_ms"] for r in group], 0.9),
            "steps_median": statistics.median(r["steps"] for r in group) if group else None, "invalid_citations": sum(r["invalid_citations"] for r in group),
        }
    none = [r for r in rows if r["kind"] == "none"]
    out["none"] = {"n": len(none), "correctly_refused": rate([r["refused"] for r in none])}
    return out


def result_key(mode: str, spec: str, qset: str) -> str:
    """Where a run is stored in results.json. The original workflow run keeps its old key, "answers"; the page reads the rest."""
    slug = "" if mode == "workflow" or spec == settings.AGENT_MODEL else "__" + re.sub(r"[^a-z0-9]+", "_", spec.lower())
    return ("answers" if mode == "workflow" else f"answers_{mode}{slug}") if qset == "original" else f"answers_{qset}_{mode}{slug}"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["workflow", "agent"], default="workflow")
    ap.add_argument("--model", default=None, help="agent only: provider:model (default AGENT_MODEL)")
    ap.add_argument("--runs", type=int, default=1, help="repeat the whole set; each run's summary is kept so the page can show a range")
    ap.add_argument("--set", dest="qset", choices=["original", "agentic"], default="original")
    a = ap.parse_args()
    spec = a.model or settings.AGENT_MODEL
    if a.mode == "agent" and spec not in settings.AGENT_ALLOWED_MODELS:
        sys.exit(f"{spec} is not in AGENT_ALLOWED_MODELS")
    qs = json.loads((QA / ("questions.json" if a.qset == "original" else "agentic_questions.json")).read_text())
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(Document.user_id).where(Document.filename.startswith(qs[0]["doc"])).limit(1))).scalar()
        key = await openai_key(db, owner) if owner else None
        mkey = await provider_key(db, owner, spec.partition(":")[0]) if owner and a.mode == "agent" else None
    if not key or (a.mode == "agent" and not mkey):
        sys.exit("Need the saved contracts and a key for OpenAI (and for the agent model's provider), saved in the app or in .env.")
    run, sem, runs, rows = runner(a.mode, spec, mkey), asyncio.Semaphore(PARALLEL), [], []
    for i in range(a.runs):
        rows = sorted(await asyncio.gather(*(score(key, owner, q, sem, run) for q in qs)), key=lambda r: r["id"])
        runs.append(summarize(rows))
        print(f"run {i + 1}/{a.runs}: cited right clause {runs[-1]['all']['right_clause_cited']}, wrong-clause {runs[-1]['all']['answered_wrong_clause']}, median calls {runs[-1]['all']['llm_calls_median']}")
    summary = runs[-1]
    print(json.dumps(summary, indent=1))
    for r in rows:
        bad = (r["kind"] == "none" and not r["refused"]) or (r["kind"] != "none" and (r["refused"] or not r.get("cited_gold") or (r.get("faithfulness") or 1) < 1))
        if bad:
            print(f"  Q{r['id']} {r['kind']:<17} refused={r['refused']} context={r.get('context_has_gold')} cited={r.get('cited_gold')} faith={r.get('faithfulness')}: {r['question']}")
            for u in r.get("unsupported", [])[:2]:
                print(f"       unsupported: {u[:140]}")
    res = json.loads((QA / "results.json").read_text())
    res[result_key(a.mode, spec, a.qset)] = {"summary": summary, "rows": rows, "runs": runs, "ran_at": datetime.now(timezone.utc).isoformat(), "mode": a.mode, "question_set": a.qset,
                                             "answer_model": spec if a.mode == "agent" else settings.ASK_MODEL, "judge_model": settings.OPENAI_MODEL}
    (QA / "results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
