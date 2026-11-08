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


def make_scanned_pdf() -> bytes:
    """The sample contract photographed: every page is only a picture, with no text layer."""
    src = pymupdf.open(stream=make_sample_pdf(), filetype="pdf")
    doc = pymupdf.open()
    for page in src:
        out = doc.new_page(width=page.rect.width, height=page.rect.height)
        out.insert_image(out.rect, pixmap=page.get_pixmap(dpi=200))
    return doc.tobytes()


def make_early_signature_pdf() -> bytes:
    """A master agreement whose signature page comes FIRST and whose numbered terms follow it (the Oriental/Metavante layout)."""
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    def put(s, bold=False):
        nonlocal y
        page.insert_text((72, y), s, fontsize=10, fontname="hebo" if bold else "helv"); y += 16
    put("TECHNOLOGY OUTSOURCING AGREEMENT", True)
    put("This Master Agreement is made between the Provider and the Customer as of the Effective Date.")
    put("The parties agree to the terms and conditions of this Agreement, which follow this page.")
    put("IN WITNESS WHEREOF, the parties have caused this Agreement to be executed on their behalf.")
    put("PROVIDER CORPORATION    CUSTOMER GROUP INC.")
    page = doc.new_page()
    y = 72
    put("TERMS AND CONDITIONS", True)
    for n, t in [(1, "CONSTRUCTION"), (2, "TERM"), (3, "LICENSES"), (4, "SERVICES")]:
        put(f"{n}. {t}", True)
        put(f"{n}.1. The first provision of the {t.lower()} article applies to the Provider and the Customer.")
    return doc.tobytes()


def make_paren_pdf() -> bytes:
    """Sections numbered "1) Title" with a closing parenthesis, and nothing bold: the normal rules find no structure here."""
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    def put(s):
        nonlocal y
        page.insert_text((72, y), s, fontsize=10); y += 16
    put("This agreement is made between the Provider and the Company on the date shown below.")
    for n, t in [(1, "Duties of the Provider"), (2, "Duties of the Company"), (3, "Term and Termination")]:
        put(f"{n}) {t}")
        put(f"   The first obligation under {t.lower()} is described in this paragraph for the parties.")
    return doc.tobytes()


def make_run_in_pdf() -> bytes:
    """An endorsement with bold, unnumbered run-in headings: "MEMBERSHIP. The person named ..."."""
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    def put(s, bold=False):
        nonlocal y
        page.insert_text((72, y), s, fontsize=10, fontname="hebo" if bold else "helv"); y += 16
    put("ENDORSEMENT", True)
    put("This endorsement amends the contract to which it is attached.")
    for t in ["MEMBERSHIP", "DIVIDENDS", "ASSIGNMENT"]:
        put(f"{t}. The {t.lower()} provision is amended as follows for every insured person.", True)
        put("The remaining wording of the provision stays as written in the contract.")
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


def make_number_column_pdf() -> bytes:
    """Numbers are stored apart from their text (all markers first), as in some Word exports: the stream reads
    '1.', '2.', '2.1' and only then the titles, which sit on the same baselines."""
    doc = pymupdf.open()
    page = doc.new_page()
    rows = [(100, "1.", "SCOPE OF SERVICES.", True), (160, "2.", "TERM.", True), (190, "2.1", "General Rights. The Company grants the right to market the products.", False)]
    for y, num, _, _ in rows:
        page.insert_text((60, y), num, fontsize=10, fontname="hebo")
    for y, _, text, bold in rows:
        page.insert_text((90, y), text, fontsize=10, fontname="hebo" if bold else "helv")
        if bold:
            page.insert_text((60, y + 20), "This agreement shall begin upon execution and remain in effect for one year.", fontsize=10)
    page.insert_text((60, 240), "3.", fontsize=10, fontname="hebo")
    page.insert_text((90, 240), "LAW.", fontsize=10, fontname="hebo")
    page.insert_text((60, 260), "This agreement is governed by the laws of the State of New York.", fontsize=10)
    return doc.tobytes()


def make_underline_table_pdf() -> bytes:
    """No grid, only header underlines (the shape detectors get wrong): product names on one line, 'size  quantity'
    on the next, quantities in a second column; a long footer line crosses the gap and a page number sits far right."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((60, 100), "Product Name:", fontsize=10, fontname="hebo")
    page.insert_text((260, 100), "Agreed Quantity per Annum:", fontsize=10, fontname="hebo")
    page.draw_line((60, 104), (230, 104))
    page.draw_line((260, 104), (480, 104))
    y = 120
    for name, size, qty in [("ATP 1 Survivor Select", "150gm packaged", "15,000"), ("ATP 2 Mineral Concentrate", "29.5mL packaged", "20,000"),
                            ("ATP 3 Ionized Cal-Mag", "114gm packaged", "15,000"), ("ATP 4 Omega Blend", "250mL packaged", "15,000")]:
        page.insert_text((60, y), name, fontsize=10)
        page.insert_text((60, y + 12), size, fontsize=10)
        page.insert_text((260, y + 12), qty, fontsize=10)
        y += 24
    page.insert_text((140, y + 4), "Organic Preparations INC. and Agape International Holding Limited", fontsize=10)
    page.insert_text((520, y + 4), "12", fontsize=10)
    page.draw_line((60, y + 8), (520, y + 8))
    return doc.tobytes()


def make_table_pdf() -> bytes:
    """A body line that starts with 'signed by', a ruled 3x2 table, then a real clause after both."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "1. FEES", fontsize=12, fontname="hebo")
    page.insert_text((72, 92), "signed by the Investigator and returned to the Sponsor within thirty days of receipt.", fontsize=10)
    for r, (a, b) in enumerate([("Visit", "Fee"), ("Screening", "EUR 100"), ("Follow-up", "EUR 50")]):
        for c, text in enumerate((a, b)):
            rect = pymupdf.Rect(72 + c * 150, 120 + r * 24, 222 + c * 150, 144 + r * 24)
            page.draw_rect(rect, width=0.8)
            page.insert_text((rect.x0 + 4, rect.y0 + 16), text, fontsize=10)
    page.insert_text((72, 230), "2. TERM", fontsize=12, fontname="hebo")
    page.insert_text((72, 250), "This Agreement lasts for three years from the Effective Date unless ended earlier.", fontsize=10)
    page.insert_text((72, 290), "3. LAW", fontsize=12, fontname="hebo")
    page.insert_text((72, 310), "This Agreement is governed by the laws of the Republic of South Africa.", fontsize=10)
    return doc.tobytes()


if __name__ == "__main__":
    from app.hybrid_parser import _ocr_ready, local_fast_parse
    if _ocr_ready():
        scan = make_scanned_pdf()
        assert not pymupdf.open(stream=scan, filetype="pdf")[0].get_text().strip(), "the fixture must have no text layer"
        got = local_fast_parse(scan)
        assert got and len(got[0]) >= 3, got  # a scan is read by OCR and cut into clauses like any other PDF
        assert any("OCR" in i for i in got[1]["issues"]), got[1]["issues"]  # and the result says so
        assert got[0][0]["start_line"] is not None  # real line positions: the clause highlight works on a scan too
    else:
        print("skip: Tesseract is not installed, so the OCR check did not run")
    paren = [c["clause_identifier"] for c in local_fast_parse(make_paren_pdf())[0]]
    assert {"1", "2", "3"} <= set(paren), paren  # "1) Title" sections are found when the normal rules find nothing
    run_in = [c["title"] for c in local_fast_parse(make_run_in_pdf())[0]]
    assert {"Membership", "Dividends", "Assignment"} <= set(run_in), run_in  # bold run-in headings, same condition
    ids = [c["clause_identifier"] for c in local_fast_parse(make_early_signature_pdf())[0]]
    assert {"1", "2", "3", "4"} <= set(ids) and "SIGNATURES" in ids, ids  # the terms after an early signature page are not swallowed

    from app.hybrid_parser import _confidence, local_fast_parse

    import redis
    from app.config import settings
    redis.Redis.from_url(settings.REDIS_URL).delete("rl:parse:testclient")  # the per-minute limit would trip on back-to-back runs

    from app.hybrid_parser import _rows_from_words, _usable
    page = pymupdf.open(stream=make_underline_table_pdf(), filetype="pdf")[0]
    grid = _rows_from_words(page, page.rect)
    assert grid and len(grid[0]) == 2 and _usable(grid), grid  # two columns found although nothing is ruled
    assert ["150gm packaged", "15,000"] in grid and ["114gm packaged", "15,000"] in grid, grid  # size and quantity side by side
    assert ["ATP 1 Survivor Select", ""] in grid, grid  # a name on its own line keeps an empty quantity
    assert not any("15,000" in r[0] for r in grid), grid  # a quantity is never glued onto the name column
    assert any("Organic Preparations" in c for r in grid for c in r), grid  # the line crossing the gap is kept, whole
    assert _rows_from_words(pymupdf.open(stream=make_sample_pdf(), filetype="pdf")[0], pymupdf.Rect(60, 60, 540, 130)) is None  # plain text is not a table

    cols, _ = local_fast_parse(make_number_column_pdf())
    got = {c["clause_identifier"]: c["title"] for c in cols}
    assert got.get("1", "").startswith("SCOPE") and got.get("2", "").startswith("TERM") and got.get("2.1", "").startswith("General"), got  # numbers re-attached to their own titles

    tbl, _ = local_fast_parse(make_table_pdf())
    by = {c["clause_identifier"]: c for c in tbl}
    assert "SIGNATURES" not in by and {"1", "2", "3"} <= by.keys(), list(by)  # "signed by" in prose is not a signature block
    assert "| Visit | Fee |\n| Screening | EUR 100 |\n| Follow-up | EUR 50 |" in by["1"]["content"], by["1"]["content"]

    def cl(i, t, pg): return {"clause_identifier": i, "title": t, "content": "x" * 50, "page_number": pg}
    dup = _confidence([cl("1", "A", 1), cl("2", "B", 1), cl("3", "COMPENSATION", 3), cl("3.1", "x", 3), cl("3", "SUPPLY", 4), cl("3.1", "y", 4)], 300)
    assert dup["unique"] < 1 and dup["score"] < 1 and "Number 3 is used twice" in dup["issues"][0], dup
    from app.hybrid_parser import _numbering_score
    assert _numbering_score(["2000"]) == 1.0 and _numbering_score([]) == 1.0  # a lone stray number: no crash
    assert _numbering_score(["1", "2", "3", "4", "22314"]) == 1.0  # the outlier is ignored, not counted as a gap
    assert _confidence([cl("1", "A", 1), cl("2", "B", 1), cl("3", "C", 2)], 150)["issues"] == []

    # LLM heading picker, with the model stubbed: picks come from line numbers, text still comes from the PDF.
    import asyncio
    import app.hybrid_parser as hp
    read = hp._read_lines(make_table_pdf())
    picks = {i: hp.Heading(line=i, clause_identifier=l["text"][0], title=l["text"][3:]) for i, l in enumerate(read[0]) if l["text"][:3] in ("1. ", "2. ", "3. ")}
    built, conf = hp._from_headings(read, picks)
    assert [c["clause_identifier"] for c in built] == ["1", "2", "3"] and "| Visit | Fee |" in built[0]["content"], built
    assert hp._from_headings(read, {}) is None  # no headings picked: caller keeps the local result

    async def fake_headings(read, provider, key): return hp._from_headings(read, dict(picks))
    real_local, real_llm = hp._local_from_lines, hp._llm_headings
    hp._local_from_lines = lambda r: ([{"clause_identifier": "X", "title": "t", "content": "c", "page_number": 1, "parent_identifier": None}], {"score": 0.1})
    hp._llm_headings = fake_headings
    out = asyncio.run(hp.parse_contract_fast(make_table_pdf(), "gemini", "k"))
    assert out["method"] == "gemini" and [c["clause_identifier"] for c in out["clauses"]] == ["1", "2", "3"], out  # low local score -> LLM headings used
    async def boom(*a): raise RuntimeError("503")
    hp._llm_headings = boom
    out = asyncio.run(hp.parse_contract_fast(make_table_pdf(), "gemini", "k"))
    assert out["method"] == "local" and out["steps"][1]["status"] == "failed", out  # LLM down -> local result, no retry loop
    hp._local_from_lines, hp._llm_headings = real_local, fake_headings
    good = asyncio.run(hp.parse_contract_fast(make_table_pdf(), "gemini", "k"))
    assert good["method"] == "local" and good["steps"][1]["status"] == "skipped", good  # a good local parse: AI not called
    forced = asyncio.run(hp.parse_contract_fast(make_table_pdf(), "gemini", "k", force_llm=True))
    assert forced["method"] == "gemini" and forced["steps"][1]["status"] == "done", forced  # "Parse with Gemini": AI result used
    assert len(forced["local_result"]["clauses"]) == 3, forced  # the local parse comes along, for comparison
    try:
        asyncio.run(hp.parse_contract_fast(make_table_pdf(), "openai", "", force_llm=True))
        raise SystemExit("forcing the AI with no key should fail")
    except hp.NoApiKey:
        pass
    hp._local_from_lines, hp._llm_headings = real_local, real_llm

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
