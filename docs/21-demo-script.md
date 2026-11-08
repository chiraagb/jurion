# 21. A 5-minute demo

Before you start: the three databases and the API are running, you are signed in, an OpenAI key is saved (key icon), and your contracts are saved with embeddings and graphs (My contracts shows `Embedded` and `Graph …`). Use a window at least 1300px wide.

**1. The problem (30 seconds).** Open **Problems & fixes**. Say: *"A plain 'search, then ask an AI' system breaks in predictable places: how the contract is cut up, finding the right text, knowing which contract you mean, and making things up. This page lists the ones I actually hit, each with a real example and a number."* Point at the bank example: it answered from a contract with no bank in it.

**2. Reading a contract (45 seconds).** **Parser Lab**: drop in a PDF. Show the clauses, the table kept as a table, and the confidence score. Say: *"It cuts at the contract's own headings, not every 500 words, and when it is unsure it asks an AI one narrow question, which lines are headings, and never lets the AI reword the text."* Save it; show that saving the same file twice offers "Replace".

**3. Ask (90 seconds).** **Ask**: click "What does the bank owe if it ends the contract early?". Point out: the question jumps to the top and the answer streams below; the "Narrowed by the graph" tag; the numbered chips; **References** cards. Click a chip: the clause opens beside the answer on the PDF page with the clause shaded. Use the arrows to step through references; press **Read full width** to read the page, then back. Say: *"Every claim is checkable in one click. And if nothing in the contracts supports an answer, it says so and the answer model is never called."* Ask something the contracts cannot answer ("What is the vendor's annual revenue?") to show the refusal.

**4. Compare (30 seconds).** **History**: tick two questions, **Compare side by side**. Open a clause that appears in both.

**5. The graph (45 seconds).** **My contracts** → open a contract → the **Graph** panel: parties and cross-references. Optionally show Neo4j at `localhost:7474` with `MATCH (p:Party)-[r:PARTY_TO]->(d:Document) RETURN p, r, d`. Say: *"Neo4j holds only the links; Postgres is the source of truth, so the graph can always be rebuilt."*

**6. Measuring it (60 seconds).** **Evaluation**: the table of search setups (from plain meaning search up to the full Ask pipeline), the card on what narrowing and widening rescued and broke, and the answers on 5 versus 15 contracts. Say: *"The graph fixed the failures it was built for, questions that name a contract, and changed overall search quality very little. My first version actually broke four questions by guessing a contract from the topic, so I limited it to names, roles and document kinds."* Close with the limits: small question set, AI-judged faithfulness, no OCR.

**Questions to expect**
- *Why two databases?* Postgres for text, vectors and ownership; Neo4j only for links, and it can be rebuilt. See `docs/18-graph.md` and `docs/19-neo4j-interview-prep.md`.
- *How do you know it works?* The Evaluation tab, and the bugs found in my own measuring (`docs/17-evaluation.md`).
- *What would you do next?* Questions that isolate the cross-reference widening, company-name matching, OCR, and an outbox for the graph.
