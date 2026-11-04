"""Answer quality: run the real Ask pipeline on every question in tests/qa/questions.json and score what comes back.

  uv run python -W ignore -m tests.eval_answers

Per answerable question: was an answer given (not a refusal), did the cited clauses include the right one, were the answer's
claims supported by the clauses it was given (faithfulness), and did it address the question. Per unanswerable question:
did it refuse (detected by how the answer starts, see REFUSAL). The judge is a different, larger model than the one that wrote the answer (OPENAI_MODEL vs ASK_MODEL) to
reduce a model flattering its own output. Costs a few cents. Merged into tests/qa/results.json under "answers"."""
import asyncio
import json
import re
import statistics
import sys
from datetime import datetime, timezone
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from app.ask import pipeline
from app.config import settings
from app.database import AsyncSessionLocal, Document
from app.embeddings import openai_key
from tests.eval_qa import QA, norm

PARALLEL = 4
# How a refusal starts: "I couldn't find this in your saved contracts", "The clauses provided do not mention ...", "There is no ..."
REFUSAL = re.compile(r"^\W*(?:the\s+(?:provided\s+)?(?:clauses?|contracts?|text|documents?)(?:\s+provided)?\s+(?:do(?:es)?\s+not|don'?t)|i\s+(?:couldn'?t|could\s+not|cannot|can'?t)|there\s+(?:is|are)\s+no|no\s+(?:information|mention)|unable\s+to)", re.I)


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


async def score(key: str, owner, q: dict, sem: asyncio.Semaphore) -> dict:
    async with sem:
        answer, sources = "", []
        async with AsyncSessionLocal() as s:
            async for kind, d in pipeline(s, owner, key, q["question"]):
                if kind == "sources":
                    sources = d["sources"]
                elif kind == "token":
                    answer += d["text"]
        row = {"id": q["id"], "question": q["question"], "kind": q["kind"], "answer": answer, "sources": len(sources)}
        context = "\n\n".join(f"[{i}] {x['content']}" for i, x in enumerate(sources, 1))
        row["refused"] = not sources or bool(REFUSAL.match(answer))  # a pattern, not a judge: the yes/no AI judge flagged clean answers as refusals
        if q["doc"]:  # the right clause: did grading keep it, and did the answer cite it
            has = lambda x: x["filename"].startswith(q["doc"]) and norm(q["phrase"]) in norm(x["content"])
            cited = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
            row["context_has_gold"] = any(has(x) for x in sources)
            row["cited_gold"] = any(has(x) for i, x in enumerate(sources, 1) if i in cited)
        if not row["refused"]:
            f = await judge(key, Claims, "List each factual claim the ANSWER makes about the contract. Mark supported=true only if the CLAUSES state it or clearly imply it. Ignore citation markers like [1].",
                            f"CLAUSES:\n{context}\n\nANSWER:\n{answer}")
            row["faithfulness"] = round(sum(c.supported for c in f.claims) / len(f.claims), 3) if f.claims else None
            row["unsupported"] = [c.claim for c in f.claims if not c.supported]
            row["answers_question"] = (await judge(key, Addresses, "Set addresses_the_question to true if the ANSWER directly addresses the QUESTION, whether or not it is correct.", f"QUESTION: {q['question']}\n\nANSWER:\n{answer}")).addresses_the_question
        return row


def summarize(rows: list[dict]) -> dict:
    rate = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    out = {}
    for name, group in (("all", [r for r in rows if r["kind"] != "none"]), *((k, [r for r in rows if r["kind"] == k]) for k in ("direct", "paraphrase", "broad"))):
        done = [r for r in group if not r["refused"]]
        faith = [r["faithfulness"] for r in done if r.get("faithfulness") is not None]
        out[name] = {"n": len(group), "answered": rate([not r["refused"] for r in group]), "right_clause_in_context": rate([r["context_has_gold"] for r in group]),
                     "right_clause_cited": rate([r["cited_gold"] for r in group]), "faithfulness": round(statistics.fmean(faith), 3) if faith else None,
                     "addresses_question": rate([r["answers_question"] for r in done])}
    none = [r for r in rows if r["kind"] == "none"]
    out["none"] = {"n": len(none), "correctly_refused": rate([r["refused"] for r in none])}
    return out


async def main():
    qs = json.loads((QA / "questions.json").read_text())
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(Document.user_id).where(Document.filename.startswith(qs[0]["doc"])).limit(1))).scalar()
        key = await openai_key(db, owner) if owner else None
    if not key:
        sys.exit("Need the saved contracts and an OpenAI key (saved in the app or OPENAI_API_KEY).")
    sem = asyncio.Semaphore(PARALLEL)
    rows = sorted(await asyncio.gather(*(score(key, owner, q, sem) for q in qs)), key=lambda r: r["id"])
    summary = summarize(rows)
    print(json.dumps(summary, indent=1))
    for r in rows:
        bad = (r["kind"] == "none" and not r["refused"]) or (r["kind"] != "none" and (r["refused"] or not r.get("cited_gold") or (r.get("faithfulness") or 1) < 1))
        if bad:
            print(f"  Q{r['id']} {r['kind']:<10} refused={r['refused']} context={r.get('context_has_gold')} cited={r.get('cited_gold')} faith={r.get('faithfulness')}: {r['question']}")
            for u in r.get("unsupported", [])[:2]:
                print(f"       unsupported: {u[:140]}")
    res = json.loads((QA / "results.json").read_text())
    res["answers"] = {"summary": summary, "rows": rows, "ran_at": datetime.now(timezone.utc).isoformat(), "answer_model": settings.ASK_MODEL, "judge_model": settings.OPENAI_MODEL}
    (QA / "results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
