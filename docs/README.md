# Jurion Docs

Plain-English guide to what Jurion is, how it works, and how it was built. Read in this order: each group builds on the one before.

## Understand it
1. [Overview](01-overview.md): what Jurion is and why it exists
2. [Architecture](02-architecture.md): the pieces and how they connect
3. [Glossary](03-glossary.md): jargon explained

## Set it up
4. [Phase 1: Setup](04-phase1-setup.md): tools, databases, health check
5. [Git & GitHub](05-git-github.md): committing and pushing
6. [Sign in with Google](06-auth.md): login, sessions, setup
7. [Looking at the database](07-database.md): psql, DBeaver, what is stored

## Follow a contract through the system
8. [Phase 2: Ingestion](08-phase2-ingestion.md): turning a PDF into clauses
9. [Parser test results](09-parser-test-results.md): what was tested, the numbers, known gaps
10. [Saved contracts](10-saved-contracts.md): save, list, open, delete
11. [Embeddings and search](11-embeddings-search.md): pgvector column, embed buttons, hybrid search
12. [The contract graph](12-graph.md): companies and cross-references in Neo4j, and the Graph page
13. [Neo4j interview prep](13-neo4j-interview-prep.md): concepts, Cypher, how Jurion uses it, Q&A, drill

## Ask questions
14. [Phase 3: Query Engine](14-phase3-query-engine.md): the original plan for answering
15. [Ask](15-ask.md): answers with citations, relevance check, one rewrite, "which contract?", company facts, follow-ups
16. [Phase 4: Dashboard](16-phase4-dashboard.md): the user interface

## Prove it works
17. [Phase 5: Evaluation](17-phase5-evaluation.md): the original plan for measuring quality
18. [Evaluation](18-evaluation.md): question set, retrieval and answer scores, findings, bugs found in the measuring

## Run it and show it
19. [Operations](19-operations.md): migrations, tests and CI, duplicate protection, keeping the databases in step
20. [Scaling to production](20-scaling-to-production.md): the roadmap for real customers
21. [A 5-minute demo](21-demo-script.md): what to show and say
