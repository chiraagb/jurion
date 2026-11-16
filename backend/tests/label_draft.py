"""Drafts clause-boundary labels for the contracts in tests/corpus_big/selection.txt.
Run: uv run python -m tests.label_draft      (uses GEMINI_API_KEY; only run on contracts you may send to Google)

Two independent drafters mark where clauses start: the local parser and the LLM heading picker. Lines both mark are
taken as clause starts ("="). Lines only one marks ("L?" local only, "A?" AI only) are for a human to decide.
Output: tests/corpus_big/labels/<name>.txt. Edit it: change "?" lines to "+" (starts a clause) or "-" (does not), and add
missing starts as "+ p<page> | <exact line text>". Then run tests.eval."""
import asyncio
import json
import re
from pathlib import Path

from app.core.config import settings
from app.ingestion.parser import _llm_headings, _local_from_lines, _read_lines

BIG = Path(__file__).parent / "corpus_big"
LABELS, CACHE = BIG / "labels", BIG / "drafts"


def slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", Path(path).stem)[:60]


def key(line: dict) -> tuple:
    return line["page_number"], line["text"][:80]


async def ai_starts(read, name: str, sem: asyncio.Semaphore):
    cache = CACHE / f"{name}.json"
    if cache.exists():
        return {tuple(k) for k in json.loads(cache.read_text())}
    async with sem:
        await asyncio.sleep(2)  # stay under the per-minute request limit
        try:
            res = await asyncio.wait_for(_llm_headings(read, "gemini", settings.GEMINI_API_KEY), 90)
        except Exception as e:
            print(f"  AI failed for {name}: {type(e).__name__} {str(e)[:90]}")
            return None
    starts = {key(read[0][c["start_line"]]) for c in res[0]} if res else set()
    cache.write_text(json.dumps(sorted(starts)))
    return starts


async def draft(path: str, sem: asyncio.Semaphore) -> str:
    name = slug(path)
    read = _read_lines(Path(path).read_bytes())
    if not read:
        return f"{name}: no text layer, skipped"
    lines = read[0]
    local = _local_from_lines(read)
    mine = {key(lines[c["start_line"]]) for c in local[0]} if local else set()
    ai = await ai_starts(read, name, sem)
    out = [f"# pdf: {path}", f"# pages: {read[3]}   local: {len(mine)} starts   ai: {'unavailable' if ai is None else len(ai)} starts",
           "# '=' both agree. 'L?' only the local parser, 'A?' only the AI: change to '+' (starts a clause) or '-' (does not).",
           "# Add a missed start as '+ p<page> | <exact line text>'. Lines are in document order."]
    seen = set()
    for line in lines:
        k = key(line)
        if k in seen or (k not in mine and k not in (ai or set())):
            continue
        seen.add(k)
        mark = "=" if k in mine and ai is not None and k in ai else "L?" if k in mine else "A?"
        out.append(f"{mark} p{k[0]} | {k[1]}")
    LABELS.mkdir(parents=True, exist_ok=True)
    (LABELS / f"{name}.txt").write_text("\n".join(out) + "\n")
    undecided = sum(l.startswith(("L?", "A?")) for l in out)
    return f"{name}: {len(out) - 4} starts, {undecided} to decide"


async def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(1)  # one call at a time: 4 at once hit Gemini's rate limit
    paths = [p for p in (BIG / "selection.txt").read_text().split("\n") if p]
    for r in await asyncio.gather(*(draft(p, sem) for p in paths)):
        print(r)


if __name__ == "__main__":
    asyncio.run(main())
