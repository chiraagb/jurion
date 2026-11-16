"""Clause-boundary accuracy against the reviewed labels in tests/corpus_big/labels/.
Run: uv run python -m tests.eval
A start is matched by (page, first 80 characters of its heading line). Files with undecided "?" lines are reported
but left out of the totals. The labels are only as complete as the review: a start that neither drafter found and the
reviewer did not add is invisible here, so skim the "=" lines and add misses as '+ p<page> | <line text>'."""
import re
from pathlib import Path

from app.ingestion.parser import MIN_CONFIDENCE, _local_from_lines, _read_lines

LABELS = Path(__file__).parent / "corpus_big" / "labels"


def load(path: Path):
    pdf, labeled, undecided = None, set(), 0
    for row in path.read_text().splitlines():
        if row.startswith("# pdf: "):
            pdf = row[7:]
        m = re.match(r"(=|\+|-|L\?|A\?) p(\d+) \| (.*)$", row)
        if not m:
            continue
        mark, page, text = m.groups()
        if mark in ("=", "+"):
            labeled.add((int(page), text))
        elif mark.endswith("?"):
            undecided += 1
    return pdf, labeled, undecided


def main():
    rows, tp = [], [0, 0, 0]  # matched, predicted, labeled (reviewed files only)
    fallback = 0
    for f in sorted(LABELS.glob("*.txt")):
        pdf, labeled, undecided = load(f)
        read = _read_lines(Path(pdf).read_bytes())
        local = _local_from_lines(read) if read else None
        pred = {(l["page_number"], l["text"][:80]) for l in (read[0][c["start_line"]] for c in local[0])} if local else set()
        needs_ai = local is None or local[1]["score"] < MIN_CONFIDENCE
        fallback += needs_ai
        hit = len(pred & labeled)
        p, r = hit / len(pred) if pred else 0.0, hit / len(labeled) if labeled else 0.0
        rows.append((f.stem[:44], len(labeled), len(pred), p, r, undecided, needs_ai))
        if not undecided and labeled:
            tp = [tp[0] + hit, tp[1] + len(pred), tp[2] + len(labeled)]
    print(f"{'contract':44} {'labels':>6} {'found':>5} {'prec':>5} {'recall':>6} {'todo':>5}  AI")
    for n, nl, np_, p, r, u, ai in rows:
        print(f"{n:44} {nl:6} {np_:5} {p:5.2f} {r:6.2f} {u:5}  {'yes' if ai else ''}")
    done = sum(1 for r in rows if not r[5] and r[1])
    if done:
        P, R = tp[0] / max(tp[1], 1), tp[0] / max(tp[2], 1)
        print(f"\nreviewed {done}/{len(rows)} files: precision {P:.2f}  recall {R:.2f}  F1 {2 * P * R / max(P + R, 1e-9):.2f}")
    print(f"AI fallback would trigger on {fallback}/{len(rows)} files")


if __name__ == "__main__":
    main()
