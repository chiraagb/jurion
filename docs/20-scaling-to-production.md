# 20. Scaling to Production

What changes when real companies use Jurion with thousands of contracts. **Not needed for the first version** – this is the roadmap.

## 1. Keep each customer's data separate (multi-tenancy)

Every customer ("tenant") must only ever see their own contracts.

- **Postgres:** add a `tenant_id` column to every table and turn on **Row-Level Security** – the database itself refuses to return other tenants' rows, even if the code has a bug.

  ```sql
  ALTER TABLE contract_chunks ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation_policy ON contract_chunks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
  ```

- **Neo4j:** every query starts from the tenant's node, so it can only reach that tenant's documents:

  ```cypher
  MATCH (t:Tenant {id: $tenant_id})-[:OWNS]->(d:Document)-[:CONTAINS]->(c:Clause)
  ```

## 2. Ingest lots of documents fast

- **Separate worker queues** per job type: parsing, OCR (for scanned PDFs, on GPU machines), and AI extraction (rate-limited so we don't hit API limits).
- **Batch writes to Neo4j** with `UNWIND` – send 500 clauses in one query instead of 500 separate queries.

## 3. Make it faster and cheaper

| Idea | How | Why |
|---|---|---|
| **Semantic cache** | Store past questions' embeddings in Redis; if a new question is ≥ 96% similar, reuse the old answer | Skip the AI entirely for repeat questions |
| **Cheap model for easy steps** | Use small models (gpt-4o-mini, Haiku) for classifying and extracting; big model only for the final answer | Big cost and speed savings |
| **Reranking** | Fetch top 50 candidates, then use a reranker model to pick the best 5 | More accurate results, smaller prompts |

## 4. Security and trust

- **Clause-level access control:** tag sensitive clauses (e.g. `security_clearance = 'EXECUTIVE'`). Searches skip clauses the user isn't cleared for, based on their login token.
- **Hallucination guards:** automatic checks on every answer –
  - any dollar amount in the answer must appear word-for-word in the source clauses
  - any claim without a citation → answer is rejected and retried
- **Audit log:** permanently record, for every answer:
  - a hash of the exact clause text used
  - the graph path followed (e.g. `SOW_1 → SUPERSEDES → MSA_2022`)
  - the model name, settings, prompt and response

  Stored append-only so it can't be edited later. Needed for legal/compliance audits.
