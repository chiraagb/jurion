"""Regression check on real contracts. Run: uv run python -m tests.integration.test_corpus
PDFs live in tests/corpus/ (gitignored: real contracts); expectations.json is committed. A missing PDF is skipped.
To add a case: drop the PDF in tests/corpus/, add an entry, run this."""
import json
from pathlib import Path
from app.ingestion.parser import local_fast_parse

CORPUS = Path(__file__).parent.parent / "corpus"


def check(name: str, want: dict) -> str:
    pdf = CORPUS / name
    if not pdf.exists():
        return f"skip {name}"
    clauses, conf = local_fast_parse(pdf.read_bytes())
    ids = [c["clause_identifier"] for c in clauses]
    tables = sum(c["content"].count("\n| ") + c["content"].startswith("| ") for c in clauses)
    assert len(clauses) >= want["min_clauses"], f"{name}: {len(clauses)} clauses < {want['min_clauses']}"
    assert not set(want["ids"]) - set(ids), f"{name}: missing ids {set(want['ids']) - set(ids)}"
    assert tables >= want["min_table_rows"], f"{name}: {tables} table rows < {want['min_table_rows']}"
    assert conf["score"] >= want["min_score"], f"{name}: score {conf['score']} < {want['min_score']} {conf['issues']}"
    assert conf["balanced"] == 1.0, f"{name}: one clause hoards the text {conf['issues']}"
    return f"ok   {name}: {len(clauses)} clauses, {tables} table rows, score {conf['score']}"


if __name__ == "__main__":
    for name, want in json.loads((CORPUS / "expectations.json").read_text()).items():
        print(check(name, want))
