"""Self-check for POST /parse. Run: uv run python -m tests.integration.test_parse [out.pdf]"""
import sys
import pymupdf
from fastapi.testclient import TestClient
import uuid
from app.auth import current_user
from app.database import User
from app.main import app

SECTIONS = [
    ("ARTICLE I", "Definitions", '"Services" means the work described in each Statement of Work.'),
    ("Section 2.1", "Term", "This Agreement begins on the Effective Date and lasts three (3) years."),
    ("Section 2.2", "Termination", "Either party may terminate on ninety (90) days written notice."),
    ("Section 10", "Limitation of Liability", "Total liability shall not exceed fees paid in the prior 12 months."),
    ("Section 14.2", "Governing Law", "This Agreement is governed by the laws of the State of New York."),
]


def make_sample_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    page.insert_text((72, y), "MASTER SERVICES AGREEMENT", fontsize=18)
    y += 36
    for clause_id, title, body in SECTIONS:
        page.insert_text((72, y), f"{clause_id}. {title}", fontsize=13, fontname="hebo")
        y += 20
        page.insert_text((72, y), body, fontsize=10)
        y += 32
    return doc.tobytes()


def make_split_heading_pdf() -> bytes:
    """Real-world layout: '1.' and 'SCOPE:' as separate lines, and '2.1' alone above its text."""
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72

    def put(x, s, bold=False):
        page.insert_text((x, y), s, fontsize=10, fontname="hebo" if bold else "helv")

    put(72, "NOW, THEREFORE, the Parties agree as follows, in consideration of the covenants:"); y += 30
    put(72, "1.", True); put(95, "SCOPE:", True); y += 22
    put(72, "1.1.The Service Provider shall perform clinical research services for the Client."); y += 30
    put(72, "2.", True); put(95, "TERM:", True); y += 22
    put(72, "2.1"); y += 14
    put(95, "This Agreement commences on the Effective Date and continues for three years.")
    return doc.tobytes()


def make_hanging_indent_pdf() -> bytes:
    """Clause number in its own column, body wrapped beside it; PyMuPDF splits these into separate blocks."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_textbox((72, 60, 520, 120), "WHEREAS, the first recital explains that the Client runs clinical trials in several regions.", fontsize=10)
    page.insert_textbox((72, 100, 520, 160), "AND WHEREAS, the second recital explains that the Service Provider supports such trials.", fontsize=10)
    for y, num in [(200, "2.6."), (260, "2.7."), (320, "3.1.")]:
        page.insert_text((72, y), num, fontsize=10)
        page.insert_textbox(
            (110, y - 9, 520, y + 60),
            "The Service Provider shall invoice the Client for the Services in accordance with the applicable "
            "Project Agreement, including any agreed upfront fees and milestone payments.",
            fontsize=10,
        )
    return doc.tobytes()


if __name__ == "__main__":
    pdf0 = make_sample_pdf()
    assert TestClient(app).post("/parse", files={"file": ("a.pdf", pdf0, "application/pdf")}).status_code == 401  # signed out
    assert TestClient(app).get("/auth/me").status_code == 401
    assert TestClient(app).post("/auth/google", json={"credential": "junk"}).status_code == 401  # forged token
    app.dependency_overrides[current_user] = lambda: User(id=uuid.uuid4())  # signed in from here on

    hanging = TestClient(app).post("/parse", files={"file": ("h.pdf", make_hanging_indent_pdf(), "application/pdf")}).json()
    by_id = {c["clause_identifier"]: c for c in hanging["clauses"]}
    assert "\n" not in by_id["2.6"]["content"], repr(by_id["2.6"]["content"])  # one paragraph, no stray breaks
    assert by_id["2.6"]["content"].startswith("2.6. The Service Provider")
    assert "\n\n" in by_id["PREAMBLE"]["content"]  # real paragraph break kept

    split = TestClient(app).post("/parse", files={"file": ("s.pdf", make_split_heading_pdf(), "application/pdf")}).json()
    by_id = {c["clause_identifier"]: c for c in split["clauses"]}
    assert by_id["1"]["title"] == "SCOPE", by_id.get("1")
    assert by_id["2"]["title"] == "TERM", by_id.get("2")
    assert by_id["1.1"]["parent_identifier"] == "1"
    assert by_id["2.1"]["title"].startswith("This Agreement"), by_id["2.1"]
    assert by_id["2.1"]["parent_identifier"] == "2"

    pdf = make_sample_pdf()
    client = TestClient(app)

    res = client.post("/parse", files={"file": ("msa.pdf", pdf, "application/pdf")})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["method"] == "local", data
    ids = [c["clause_identifier"] for c in data["clauses"]]
    for expected in ["ARTICLE I", "SECTION 2.1", "SECTION 2.2", "SECTION 10", "SECTION 14.2"]:
        assert expected in ids, ids
    assert data["pages"] == 1

    bad = client.post("/parse", files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert bad.status_code == 415, bad.text

    print(f"ok: {len(ids)} clauses via {data['method']} in {data['total_ms']}ms -> {ids}")
    if len(sys.argv) > 1:
        open(sys.argv[1], "wb").write(pdf)
        print(f"sample written to {sys.argv[1]}")
