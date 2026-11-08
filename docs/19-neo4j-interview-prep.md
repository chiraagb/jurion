# 19. Neo4j from zero: learn it, then pass the interview

This guide assumes you know nothing about Neo4j. Every idea comes with a real-life example, and every query is explained line by line using **your own contracts**.

How to read it:
- **Part A** (what a graph is) and **Part B** (the query language): about 45 minutes. Do not skip these.
- **Part C**: how *your* project uses Neo4j, step by step.
- **Part D**: what "GraphRAG" means.
- **Part E**: the interview questions, each with a simple answer and an example you can say out loud.
- **Part F**: what is really built, so you never over-claim.
- **Part G**: a hands-on drill in the Neo4j browser, with the answers.

To follow along, open `http://localhost:7474` (login in `docs/18-graph.md`) and type each query into the box at the top.

---

# Part A. What is a graph database?

## A1. The problem it solves

Think about **Facebook friends**. Your question is: *"Which friends of my friends also know my boss?"*

- In a **spreadsheet** (or a normal database table) you would keep a list of people, and a second list saying "person 5 is friends with person 9". To answer the question you have to look up your friends in the list, then for each friend look up *their* friends in the list again, then look up your boss's friends and compare. Every extra step is another slow search through a giant list. This kind of search is called a **join**.
- In a **graph** you draw a **dot for each person** and a **line between friends**. To answer the question you stand on your dot and just *walk along the lines*. You never search a giant list; you follow the lines that are already there.

Another way to see it: a **metro map**. Nobody stores a metro as a table of "station, next station". You draw stations (dots) and tracks (lines), and to plan a trip you follow the lines. A graph database stores data like the map.

**A graph database is a database designed for data where the connections matter as much as the things themselves.** Neo4j is the most popular one.

## A2. The four building blocks

Everything in Neo4j is made from just four things. Learn these and half the interview is done.

| Building block | Plain meaning | Real-life example | Example in Jurion |
|---|---|---|---|
| **Node** | A *thing* (a noun) | A person, a company, a station | A contract, a clause, a company |
| **Label** | A *category sticker* on a node | The sticker "Person" or "Company" | `Document`, `Clause`, `Party` |
| **Relationship** | A *line* between two things, with a *type* and a *direction* (a verb) | "Priya **WORKS_AT** Acme" | "Metavante **PARTY_TO** the outsourcing contract" |
| **Property** | A *fact* written on a node or on a line | An ID card: name, age. A line: "since 2021" | `name: "Metavante Corporation"`, `role: "Service Provider"` |

**Small real-life example** (no contracts yet): Priya works at Acme since 2021.

```
 (Priya)  --WORKS_AT {since: 2021}-->  (Acme)
  label: Person                         label: Company
  name: "Priya"                         name: "Acme"
```

- Two **nodes**: Priya (label `Person`) and Acme (label `Company`).
- One **relationship**: `WORKS_AT`. It has a *type* (WORKS_AT), a *direction* (from Priya to Acme, like an arrow), and its own *property* (`since: 2021`).

**Now the same idea with your project** (this is exactly what is stored in your Neo4j right now):

```
(Metavante Corporation) --PARTY_TO {role: "Service Provider"}--> (Outsourcing Agreement) --CONTAINS--> (Clause 8 Termination) --REFERENCES--> (Clause 18 Definitions)
      label: Party                                                   label: Document                        label: Clause                         label: Clause
```

Read it like a sentence: *"Metavante is a party to the Outsourcing Agreement. The agreement contains Clause 8. Clause 8 refers to Clause 18."* That is the whole data model. Three kinds of dots, three kinds of lines.

## A3. Why it is fast ("index-free adjacency")

Interviewers love this phrase, so here is what it means with a real example.

Imagine finding **your friends' friends**:
- **Method 1 (a table):** every time you need someone's friends you open a giant phone book and search for their name. Ten friends means ten searches in the huge book. Searching a book gets slower as the book grows.
- **Method 2 (a graph):** each person's page *already has their friends written on it*. You open your page, read your friends, open each of their pages, and read *their* friends. You never search the big book at all. The work depends on **how many people you actually visit**, not on how many people exist in the world.

"Adjacency" means "neighbours", and "index-free" means "no big phone book needed". In Neo4j every node has direct pointers to its neighbouring lines. That is why walking several steps stays fast even in a huge database.

## A4. Graph vs table: the same question both ways

Question: *"Which companies appear in more than one of my contracts?"*

**In SQL** (a relational database) you need three tables and two joins:
```sql
SELECT p.name, count(*)
FROM party p
JOIN party_contract pc ON pc.party_id = p.id
JOIN contract c ON c.id = pc.contract_id
GROUP BY p.name
HAVING count(*) > 1;
```

**In Neo4j (Cypher):**
```cypher
MATCH (p:Party)-[:PARTY_TO]->(d:Document)
WITH p, count(d) AS contracts WHERE contracts > 1
RETURN p.name, contracts
```

Both work. For *this* question the difference is small. The graph really wins when the question is **several steps long**: "which companies appear in contracts that reference a clause about termination in contracts signed by a bank?" In SQL that becomes five or six joins that are hard to write and slow. In a graph it is still one drawing of dots and lines.

**When a graph is NOT the right tool** (say this in an interview, it shows maturity):
- Plain tables of rows (invoices, users, logs) where you mostly filter and add things up. Postgres is better.
- Big totals over millions of rows ("total sales per month"). Postgres is better.
- Storing large text and files. That is why Jurion keeps clause text and PDFs in Postgres, not Neo4j.

## A5. "ACID" in one example

ACID means the database never leaves your data half-done. Real-life example: a **bank transfer**. You move 100 from account A to account B. It must remove 100 from A *and* add 100 to B, or do *neither*. It must never remove the money and then crash before adding it. Neo4j guarantees this for its writes, the same as Postgres. In Jurion this is why rebuilding a contract's graph happens in **one transaction**: either the whole new graph appears, or nothing changes.

---

# Part B. Cypher, the query language

Cypher is the language you use to ask Neo4j questions. Its big idea: **you draw the pattern you are looking for with text.**

## B1. How to read a drawing

| You write | It means | Real-life picture |
|---|---|---|
| `( )` | a node (round brackets look like a circle) | a dot |
| `(p:Party)` | a node, nicknamed `p`, with the label `Party` | "a dot that I will call p, which has the Party sticker" |
| `-[ ]->` | a relationship (square brackets look like a box on the line) | an arrow |
| `-[:PARTY_TO]->` | an arrow of type PARTY_TO | "a PARTY_TO line pointing this way" |
| `{name: 'Acme'}` | a property filter | "...whose name is Acme" |

So `(p:Party)-[:PARTY_TO]->(d:Document)` reads: **"a Party, that is a party to, a Document."** Say it out loud as a sentence. That is the trick to Cypher.

## B2. The five words in almost every query

| Word | What it does | Real-life meaning |
|---|---|---|
| `MATCH` | find this pattern | "show me everything that looks like this drawing" |
| `WHERE` | keep only some | "...but only the ones where..." |
| `RETURN` | what to bring back | "give me these columns" |
| `ORDER BY` / `LIMIT` | sort / cap the count | "biggest first, only the top 5" |
| `WITH` | pass results into the next step | an assembly line: hand the half-finished result to the next station |

## B3. Six real queries on your data, explained line by line

These were all run on your graph, and the results below are real.

### Query 1: "What is in my graph?"
```cypher
MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC
```
- `MATCH (n)`: find **every** node, calling each one `n` (no label, so all kinds).
- `labels(n)[0]`: a node can have several stickers; take the first one.
- `count(*)`: count how many.
- Because we return a normal column (`label`) next to a count, Neo4j automatically **groups by the label**. There is no `GROUP BY` word in Cypher. (Real-life example: counting students per class. Each class is a group, and you count within it.)
- `ORDER BY n DESC`: biggest first.

Result: `Clause 399`, `Party 11`, `Document 5`. Five contracts, 399 clauses, 11 companies/people.

### Query 2: "Who is in each contract?"
```cypher
MATCH (d:Document)<-[r:PARTY_TO]-(p:Party)
RETURN d.filename, collect(p.name + ' (' + r.role + ')') AS parties
```
- The arrow points *left* here: `<-[r:PARTY_TO]-` means "the Party points to the Document". Same data, just drawn from the other side.
- `r` is a nickname for the relationship, so we can read its property `r.role`.
- `collect(...)` puts all the matching values into **one basket (a list) per contract**. Real-life example: instead of 3 rows saying "Contract A, Dana", "Contract A, Raj", "Contract A, Lee", you get one row: "Contract A: [Dana, Raj, Lee]".
- `p.name + ' (' + r.role + ')'` glues text together.

Result for the outsourcing contract: `Oriental Financial Group Inc. (Customer)` and `Metavante Corporation (Service Provider)`.

### Query 3: "Is any company in more than one contract?"
```cypher
MATCH (p:Party)-[:PARTY_TO]->(d:Document)
WITH p, count(d) AS contracts WHERE contracts > 1
RETURN p.name, contracts
```
- First it finds every (party, contract) pair.
- `WITH p, count(d) AS contracts`: for each party, **count how many contracts**. `WITH` hands that result to the next step. (Assembly line again.)
- `WHERE contracts > 1`: keep only parties in two or more contracts. You must use `WITH ... WHERE` here, because you cannot filter on a count straight away; the count has to exist first.
- It returns **nothing today**, and that is correct: none of your 5 contracts share a company. If you uploaded a second contract with Metavante, this query would light up.

### Query 4: "Which clauses are mentioned the most?"
```cypher
MATCH (:Clause)-[:REFERENCES]->(b:Clause)
RETURN b.identifier, b.title, count(*) AS cited_by ORDER BY cited_by DESC LIMIT 5
```
- `(:Clause)` with no nickname means "some clause, I do not need to refer to it again".
- We only name `b`, the clause being pointed *at*, and count how many arrows end on it.
- Real-life example: **citations in research papers.** The most cited paper is the most important. Here, a clause that many others point to (like "Definitions") is a central clause.

Result: four clauses are tied at two references each: "Termination." (18) and "DEFINITIONS." (18) in the two contracts that use them, "INSPECTIONS, AUDITS, MONITORING" (8) and "PAYMENTS" (3).

### Query 5: "What mentions termination?"
```cypher
MATCH (a:Clause)-[:REFERENCES]->(b:Clause)
WHERE toLower(b.title) CONTAINS 'terminat'
RETURN a.identifier, a.title, b.identifier
```
- `toLower(...)` makes text lowercase so "Termination" and "TERMINATION" both match.
- `CONTAINS 'terminat'` is a text search. We use the stem so it matches "terminate", "termination".
- Meaning: "find every clause that points to a clause whose title is about termination."

### Query 6: "Follow the chain" (multi-hop)
```cypher
MATCH (a:Clause {identifier: '18'})<-[:REFERENCES*1..2]-(x:Clause)
RETURN DISTINCT x.identifier, x.title
```
- `{identifier: '18'}` picks Clause 18.
- `[:REFERENCES*1..2]` is the powerful part: **"follow REFERENCES lines, between 1 and 2 steps"**. Real-life example: *"who did I hear it from, and who did they hear it from?"* A rumour chain. Step 1 = clauses that point straight at Clause 18. Step 2 = clauses that point at *those* clauses.
- `DISTINCT` removes repeats if several paths reach the same clause.
- Always **put a limit on the steps** (`*1..2`, not just `*`). Unlimited chains can blow up in a dense graph. That is a classic interview point.

## B4. Writing data: the words your project uses

### CREATE vs MERGE (very common interview question)
- **`CREATE`** always makes a brand-new node. Real-life example: *pressing "add contact" on your phone.* If you press it twice for "Mom", you get **two** Moms.
- **`MERGE`** means **"find it, and only create it if it does not exist."** Real-life example: *a smart phone that checks first: "Is there already a Mom? Yes, then use her."*

Jurion needs MERGE for companies. If two contracts both name "Metavante", you want **one** Metavante node connected to both contracts, not two separate ones. That one shared node is what *connects* your contracts together.

**The catch interviewers test:** `MERGE` alone is not fully safe if two things run at the same moment; both might check, find nothing, and both create. The fix is a **uniqueness constraint**: a rule the database enforces, like *"no two contacts may have the same phone number."* We added these (see B5).

**Second rule:** MERGE the *node by its key*, then connect it separately. Jurion does:
```cypher
MERGE (x:Party {user_id: $uid, key: p.key})   -- find or create the company
MERGE (x)-[r:PARTY_TO]->(d)                   -- then find or create the line
```

### UNWIND: unpack a box
Jurion has to save 66 to 122 clauses per contract. Doing 122 separate queries is like **carrying groceries from the car one item at a time**. `UNWIND` lets you carry the **whole bag in one trip**:
```cypher
UNWIND $clauses AS c
CREATE (d)-[:CONTAINS]->(:Clause {id: c.id, title: c.title, ...})
```
`UNWIND` takes a list and turns it into one row per item, then the `CREATE` runs once for each row, all in one query.

### Parameters (`$name`): the fill-in-the-blank form
Notice `$uid`, `$doc`, `$clauses`. These are **blanks filled in separately**. Why not just paste the values into the text? Real-life example: **a paper form with blanks vs letting a stranger write directly on your document.** If you paste user text straight into a query, a bad person can type something that changes the meaning of the query. That attack is called **injection** (the classic joke is a student named "Robert'); DROP TABLE students;--"). With `$parameters` the database treats the value as plain data, never as part of the query. Bonus: Neo4j can reuse the plan for the query, so it is faster.

### DETACH DELETE
A node with lines attached cannot simply be deleted. Real-life example: **you cannot remove someone from a group chat while there are still active conversations with them**; first all links must be cleared. `DETACH DELETE` means "delete the node *and* every line attached to it". Plain `DELETE` refuses if lines remain.

### OPTIONAL MATCH
Like a **school list that must show every student, even those who joined no club.** Normal `MATCH` drops students with no club; `OPTIONAL MATCH` keeps the row and shows an empty value. (In SQL this is a `LEFT JOIN`.)

## B5. Indexes and constraints: the book's index

Real-life example: you want the page about "photosynthesis" in a 500-page book.
- **No index:** read every page from the start until you find it.
- **With an index** (the list at the back of the book): look up "photosynthesis, page 212" and jump there.

A database is the same. If you ask `MATCH (c:Clause {id: 'abc'})` with no index, Neo4j reads **every Clause node** (a *label scan*). With an index it jumps straight to the node (an *index seek*).

Two kinds, both of which Jurion creates when the API starts (`INDEXES` in `backend/app/graph.py`):
- **Constraint (unique):** "no two Documents may have the same id", and it also builds an index. Used for `Document.id` and `Clause.id`.
- **Index (plain):** only speeds up lookups. Used for `Clause.document_id` and `Party(user_id, key)`.

Why `Party` is only an index and not a constraint: we need uniqueness on the *pair* (user, name). Neo4j's free edition (Community) cannot enforce uniqueness over two properties; that needs the paid edition (Enterprise). Be ready to say that.

**How to prove an index is working: `PROFILE`.** Put the word `PROFILE` before a query and Neo4j shows how it ran. We ran:
```cypher
PROFILE MATCH (c:Clause {id: 'x'}) RETURN c
```
and it showed `NodeUniqueIndexSeek`, meaning *"jumped straight to it using the index."* If you see `NodeByLabelScan`, it read everything, and you probably need an index. (`EXPLAIN` does the same but only shows the plan without running the query.)

---

# Part C. How YOUR project uses Neo4j, step by step

## C1. The big picture with a library analogy

Think of a **library**:
- **Postgres is the shelves of books.** It holds the real contents: the contract text, the PDF, the vectors, the user accounts.
- **Neo4j is the "see also" map on the wall.** It does not hold the books. It only shows how things connect: "this book is by that author", "this chapter refers to that chapter."

If the map is torn up, nothing is lost: **you can redraw it from the books at any time.** That is exactly Jurion's design: *Postgres is the source of truth; the graph is derived and can be rebuilt.* It is the most important design decision to explain.

## C2. What happens when you press "Save contract" (in order)

Using your outsourcing contract (Oriental Financial and Metavante) as the example:

1. **Postgres stores** the PDF, all the clause texts and their line positions.
2. **Embeddings are made** (the numbers that capture meaning) and stored in Postgres. Not Neo4j.
3. **The graph is built** (`build_graph` in `backend/app/graph.py`):
   1. **Find the parties, with AI.** The first ~6,000 characters of the contract (the top, where companies are named) go to an AI model with the instruction "list the parties, their role, and the short names the text uses." Real-life example: *asking an assistant to read page 1 and write down who signed.* It returns, for example: Metavante Corporation, Service Provider, short name "Metavante". **One call per contract**, not one per clause, to keep it cheap.
   2. **Find cross-references, with a pattern (no AI).** A small search rule (a *regex*) finds text like "Section 5.3", "Clauses 4.1 and 4.2", "Article 18". Real-life example: *a highlighter pen that only marks the words "Section" followed by a number.* If that number matches the number of another clause in the same contract, we record a link. It deliberately **ignores** "Section 5.3 of the Securities Act" (that is outside this contract).
   3. **Write to Neo4j in one transaction:** delete this contract's old graph (if any), create the Document, all its Clauses (using `UNWIND`), the Parties, and the links. The "one transaction" means you never see a half-finished graph.
4. **Counts are saved in Postgres** (`graph_parties`, `graph_refs`), so the "My contracts" list shows `Graph 2p · 14r` without asking Neo4j.

Any failure in the graph step is logged and ignored, so **saving a contract never fails because of Neo4j.**

## C3. The design choices, each in plain language

**1. "Why is the clause text not in Neo4j?"**
It already lives in Postgres. Copying it into Neo4j means two copies that can disagree. Real-life example: *two notebooks with the same phone numbers: sooner or later you update one and forget the other.* The graph stores only ids, titles and links; the question "what does the clause say?" is answered by Postgres.

**2. "Why one Party node per user and name?"**
Real-life example: *one person with two jobs is one person, not two.* If "Metavante Corporation" is in your contract A and your contract B, it should be **one dot with two lines**, because that shared dot is what connects the contracts. `user_id` is part of the key so that your "Acme" and another user's "Acme" never merge, as in **separate address books for separate people.**

The weak spot, and what was done: names used to be matched by lowercase text, so "Acme Corp." and "Acme Corporation" became two dots. Now names are **normalised** first (accents, punctuation, "the", "and" and trailing legal words like Inc, Corp, Ltd are ignored), so those become one dot, and stored duplicates are merged on every start. What remains is real **entity resolution** (deciding that "Acme Group" and "Acme Corporation", or "Oriental Financial" and "Oriental Financial Group", are the same company), which needs an AI or human check. Say both.

**3. "Why does every Document and Party carry `user_id`?"**
**Multi-tenancy**: many users share one database, and nobody should see someone else's data. Real-life example: *an apartment building: shared walls, separate front doors.* In Jurion, ownership is checked in Postgres *before* any graph read. A production-grade version would also put the owner into every Cypher query as a second lock.

**4. "Why rebuild instead of update?"**
Deleting the contract's subgraph and recreating it in one transaction means a rebuild can **never create duplicates** and never leaves a half-updated contract. This property is called **idempotent**: doing it twice gives the same result as doing it once. Real-life example: *pressing a lift button twice does not call two lifts.*

## C4. The real bug we found (an excellent interview story)

While preparing this guide, a check showed **10 Document nodes in Neo4j but only 5 contracts**. The cause: my automated tests deleted their test *user* directly in Postgres. Postgres automatically deleted the user's contracts too (a *cascade*), but **Neo4j was never told**, so the test data stayed behind.

Real-life example: **two notebooks again.** You cross someone out of the first notebook and forget the second.

This is the central risk of running two databases, called **dual-write drift**. What we did:
1. Added `drop_user()` to the graph code, which removes everything a user has in Neo4j.
2. Made the tests call it.
3. Cleaned the leftovers and confirmed Neo4j matched Postgres again (5 documents, 399 clauses, 11 parties), and that it still matched after re-running every test.

What a production system would add: an **outbox**: write "please update the graph" as a row in Postgres *in the same transaction* as the change, and let a worker process it until it succeeds; plus a nightly **reconcile job** comparing both stores.

---

# Part D. GraphRAG in plain words

**RAG** = Retrieval-Augmented Generation. You do not ask the AI from memory; first you **retrieve** the relevant pieces of text from your documents, then the AI **answers using only those pieces.** That is what your Ask tab does.

**The weakness of plain RAG.** It finds text that is *similar* to your question, but it does not understand *connections*. Real example from your own evaluation:

> Question: "What does **the bank** owe if it ends the contract early?"

Plain RAG searched all five contracts, found termination clauses from the *template services agreement*, and answered from that, even writing "(in this case, the bank)", a pure guess. The word "bank" only appears in one contract (Oriental Financial). Plain search has no idea which contract a "bank" belongs to.

**The librarian analogy.** Plain RAG is a librarian who grabs the books that *sound* most like your question. GraphRAG is a librarian who also has a **map**: "the bank is a party to *this* contract; this clause says 'subject to Section 8'; so look at those." With the map, they walk to the right shelf.

**What Jurion's graph will do (Step 2, not built yet):**
1. **Narrow:** the question names "the bank" → the graph says that is a party of the Oriental contract → search *only* that contract.
2. **Widen:** a retrieved clause says "subject to Section 8" → follow the `REFERENCES` line and bring in Section 8 too, because the answer depends on it.

**Two flavours of GraphRAG (know both names):**
1. **Graph-expanded retrieval** (what Jurion is building): normal search first, then use the graph to narrow or widen.
2. **Microsoft-style GraphRAG:** build a graph of everything, group it into "communities", write a summary of each community in advance, and answer big "overview" questions ("what are the common themes across all contracts?") from those summaries. It is powerful but costs much more to build.

**The honest costs:** extraction makes mistakes (and every mistake spreads through the graph), it needs maintenance when documents change, it adds a second database, and it only helps for questions that are *really about connections*. That is why you **measure it** instead of assuming.

**"Why not use Neo4j for the vectors too?"** Neo4j can do that (it has *vector indexes* from version 5.11). Jurion uses pgvector in Postgres because the clause text and the keyword search are already there, so hybrid search is one SQL query. Putting the vectors in Neo4j is a legitimate alternative (search by meaning, then walk the graph from the results). Say that, and say why you chose Postgres.

---

# Part E. Interview questions with simple answers

For each: the **short answer**, an **example you can say**, and a **follow-up** to expect.

### 1. What is a graph database, and when would you use one?
- **Answer:** It stores things and the connections between them as first-class data, so following connections is fast. Use it when questions are about relationships or paths, especially several steps long.
- **Example:** "Like a metro map: stations and tracks. Planning a trip means following tracks, not searching a table."
- **Follow-up:** *When not?* Plain tabular data and big totals; Postgres is better.

### 2. Why Neo4j alongside Postgres? Why not only Postgres?
- **Answer:** Postgres can store links and do recursive queries, and for two steps that is fine. I used Neo4j for links *between contracts* (the same company in many contracts) and clause-to-clause dependencies of variable depth, and because it is the natural base for graph-expanded retrieval. The price is a second database to keep in sync.
- **Example:** "Postgres holds the books; Neo4j is the 'see also' map on the wall, and I can redraw the map from the books."

### 3. What is index-free adjacency?
- **Answer:** Each node keeps direct pointers to its connected lines, so moving to a neighbour needs no index lookup. The cost depends on the part of the graph you touch, not on the database size.
- **Example:** "Each person's page already lists their friends; you never search the phone book."

### 4. MERGE vs CREATE?
- **Answer:** CREATE always adds a new node; MERGE finds or creates. MERGE on a unique key, backed by a uniqueness constraint; otherwise concurrent writers can create duplicates.
- **Example:** "'Add contact' twice gives two Moms; a smart phone checks for an existing Mom first."
- **Follow-up:** *How do you avoid duplicate companies?* A merge key of user plus a normalised name (accents, punctuation, "the", "and" and trailing legal suffixes dropped), so "Acme Corp." and "Acme Corporation Inc." merge. Nicknames and genuinely different forms still split; that is entity resolution proper, which needs an AI or human check.

### 5. How does data get into your graph?
- **Answer:** After a contract is saved, one AI call reads the top of the contract for the parties; a pattern finds "Section X" references; then one transaction deletes the contract's subgraph and recreates it with `UNWIND`. It can be rebuilt any time.
- **Example:** "An assistant reads page 1 and lists who signed; a highlighter marks 'Section 5.3'."

### 6. How do you keep Postgres and Neo4j consistent?
- **Answer:** Postgres is the source of truth; the graph is derived. Saves, deletes and replacements update the graph; failures are logged and never fail the user's action; a rebuild repairs any contract. Real drift happened to me once (Part C4). Production: an outbox plus a reconcile job.
- **Example:** "Two notebooks: cross out in one and you must cross out in the other."

### 7. What is a super node?
- **Answer:** A node with a huge number of relationships. Walking through it is slow because you must look at all its lines. Avoid passing through hubs, or filter early.
- **Example:** "One celebrity everyone follows: asking 'friends of friends' through them touches millions."

### 8. How do you query a path of unknown length?
- **Answer:** A variable-length pattern like `[:REFERENCES*1..3]`, always with an upper bound; `shortestPath` for the shortest link.
- **Example:** "A rumour chain: who told whom, up to three people away."

### 9. What is Cypher injection and how do you prevent it?
- **Answer:** Building a query by pasting user text into it, which lets the user change the query. Always use parameters (`$name`).
- **Example:** "A form with blanks versus handing someone a pen to write on the original."

### 10. How do you make sure a query is fast?
- **Answer:** `PROFILE` it. Look for `NodeByLabelScan` where there should be an index seek, and add an index or constraint. Check the row counts between steps for explosions.
- **Example:** "Using the book's index vs reading every page. I proved `Clause.id` uses the index with PROFILE."

### 11. What is GraphRAG, and how is it different from RAG?
- **Answer:** Plain RAG retrieves similar text. GraphRAG also follows relationships to narrow or widen what it retrieves. Two flavours: graph-expanded retrieval and community-summary GraphRAG.
- **Example:** "A librarian who grabs similar-sounding books vs one with a map that knows which shelf belongs to the bank's contract."

### 12. How would you know your graph helps?
- **Answer:** A labelled question set where the graph *should* matter (a named party, a cross-reference), run with and without it, comparing right-clause-in-top-k and wrong-contract answers. I already built that harness for plain retrieval.
- **Example:** "My evaluation found a real failure: the 'bank' question was answered from the wrong contract. That is the test the graph has to pass."

### 13. How do you handle multi-tenancy?
- **Answer:** `user_id` on nodes, ownership checked in Postgres before any graph read, and the Party merge key includes the user. Production: add the owner to every Cypher query, or give each tenant their own database (Enterprise).
- **Example:** "An apartment building: shared walls, separate front doors."

### 14. How would you model "clause A overrides clause B"?
- **Answer:** A relationship `(:Clause)-[:OVERRIDES]->(:Clause)` with properties like the source text and a confidence score; found with an AI call, since a pattern cannot detect it.

### 15. What is the weakest part of your graph?
- **Answer:** Party names are normalised but not truly resolved (nicknames still split); references miss schedules and can mis-link when numbering restarts in an attachment; party extraction was checked by eye on five contracts, not measured; and the measured benefit of using it in Ask is small (it fixed the two questions that name a contract, with little change elsewhere).
- (Saying your own weaknesses calmly is a strength in interviews.)

### 16. Community vs Enterprise edition?
- **Answer:** Community is a single instance. Enterprise adds clustering, online backup, role-based access control and composite uniqueness ("node key") constraints.

### 17. What is ACID?
- **Answer:** Atomic, Consistent, Isolated, Durable: a write completes fully or not at all, rules hold, concurrent writes do not corrupt each other, and committed data survives a crash.
- **Example:** "A bank transfer: money leaves A and arrives in B, or neither."

### 18. Why a property graph and not RDF?
- **Answer:** A property graph puts properties on relationships, uses simple labels, and is easier to model and query for applications. RDF uses triples (subject, predicate, object), SPARQL and shared ontologies, and is built for linked open data.

---

# Part F. Be exact about what is built (the most important part)

**Built and tested**
- The graph model: `Party → Document → Clause → Clause`.
- Party extraction: correct by eye on all 5 of your contracts (for example the clinical trial: institution, investigator, sponsor).
- Cross-reference finder: 15, 14 and 5 links in the three contracts that use numbered references; 0 in the other two, which is true (one has almost none; the other refers to "Schedule A/B", which is not linked yet).
- Build on save, a rebuild button, cleanup on delete and replace, indexes and constraints, a Graph panel in the app, and a test against a real Neo4j.

**Used by Ask (built, tested, measured)**
- **Narrowing:** before searching, one cheap AI call reads the question and each contract's parties and roles and says which contracts the question names ("the bank" → the Oriental Financial contract). Ask searches those first and falls back to all contracts if nothing relevant turns up.
- **Widening:** after the relevant clauses are chosen, clauses they refer to ("subject to Section 8") are added and marked "pulled in by 9.1".
- **The honest result:** on the same 38 questions, the right clause was cited 89.5% → 94.7% of the time, fully faithful answers, and the two failures that named a contract (the "bank" and the "clinical trial agreement" questions) now work. Overall search quality is about the same. **Do not say "GraphRAG greatly improved my answers."** Say: *"It fixed a specific failure, questions that name a contract, with a small overall gain; my first version actually hurt four questions by guessing a contract from the topic, and I fixed it by deciding only from names, roles and document kinds."* The cross-reference widening is built but I cannot yet show it helps.

**NOT built yet**
- Also missing: links to schedules, real entity resolution for company nicknames (name variants with legal suffixes are handled), a drawn graph inside the app, and an outbox for reliable graph updates (a reconcile check runs on every start).

**What you would do next, in order:** more linked-clause questions (widening has one clear rescue on 6 questions so far) → AI-assisted entity resolution for nicknames → an outbox for reliable graph updates.

---

# Part G. Hands-on drill (10 minutes) with answers

Do these in the Neo4j browser **without looking** above, then check.

1. **Count nodes by label.** `MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n` → Clause 399, Party 11, Document 5.
2. **Each contract with its parties.** Query 2 in B3.
3. **Clauses that point at a termination clause.** Query 5 in B3.
4. **Top 3 most-referenced clauses.** Query 4 with `LIMIT 3`.
5. **Index vs scan.** Run `PROFILE MATCH (c:Clause {id: 'x'}) RETURN c` (you see `NodeUniqueIndexSeek`), then `PROFILE MATCH (c:Clause {title: 'GENERAL PROVISIONS'}) RETURN c` (a label scan plus a filter, because `title` has no index). Explain the difference in one sentence: *"the first jumps to the node using the book's index; the second reads every Clause."*
6. **Read the schema.** `SHOW INDEXES` and `SHOW CONSTRAINTS`; explain each row (which are unique constraints, which are plain indexes, and why `Party` is only an index).
7. **Explore visually.** `MATCH (d:Document)-[:CONTAINS]->(c:Clause) RETURN d, c LIMIT 60`, then double-click a Document to expand it. Then `MATCH (a:Clause)-[r:REFERENCES]->(b:Clause) RETURN a, r, b LIMIT 50` and describe what you see.

---

# Glossary (plain meanings)

| Word | Plain meaning |
|---|---|
| Node | A thing (a dot) |
| Label | A category sticker on a node |
| Relationship | A typed, directed line between two nodes |
| Property | A fact stored on a node or a line |
| Cypher | The language for asking Neo4j questions; you draw the pattern |
| MATCH / WHERE / RETURN | find a pattern / filter it / choose what to bring back |
| WITH | pass results to the next step (assembly line) |
| MERGE / CREATE | find-or-create / always create |
| UNWIND | turn a list into rows, to write many items in one trip |
| OPTIONAL MATCH | keep the row even when nothing matches (a left join) |
| DETACH DELETE | delete a node and all its lines |
| Variable-length path | `*1..3`: follow a relationship 1 to 3 steps |
| Parameter | a `$blank` filled in separately; prevents injection |
| Index | the book's index at the back: jump instead of reading everything |
| Constraint | a rule the database enforces, such as "unique ids" |
| PROFILE / EXPLAIN | show how a query ran / would run |
| Index-free adjacency | each node points directly at its neighbours |
| Super node | a node with a huge number of lines |
| ACID | all-or-nothing, correct, isolated, durable writes |
| Idempotent | doing it twice gives the same result as once |
| Dual-write drift | two databases slowly disagreeing |
| Outbox | a "to do" row saved in the same transaction as a change, so a worker can finish updating the other store |
| Entity resolution | deciding that "Acme Corp." and "Acme Corporation" are the same company |
| Multi-tenancy | many users sharing one system without seeing each other's data |
| RAG / GraphRAG | answer from retrieved text / also follow relationships when retrieving |
| Property graph vs RDF | simple dots-and-lines with properties vs subject-predicate-object triples |
