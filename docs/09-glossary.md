# 9. Glossary

| Term | Meaning |
|---|---|
| **RAG** | Retrieval-Augmented Generation. Find relevant text first, then let an AI answer using it. |
| **GraphRAG** | RAG that also uses a graph of relationships, not just text similarity. |
| **CRAG** | Corrective RAG. Check if the found text is good; if not, retry before answering. |
| **LLM** | Large Language Model – the AI (GPT-4o, Claude, Gemini). |
| **Embedding** | A list of numbers representing the meaning of text. Similar meanings → similar numbers. |
| **Vector search** | Finding text whose embedding is closest to the question's embedding. |
| **pgvector** | Postgres add-on that stores embeddings and does vector search. |
| **HNSW** | A type of index that makes vector search fast on large data. |
| **Cosine similarity** | The math used to compare two embeddings (1 = same meaning). |
| **Neo4j** | A graph database: stores nodes (things) and edges (relationships). |
| **Cypher** | Neo4j's query language, like SQL for graphs. |
| **MERGE** | Cypher command: create if missing, otherwise reuse. Avoids duplicates. |
| **UNWIND** | Cypher command to process a list in one query (used for batching). |
| **Multi-hop** | A question that needs following several links (A → B → C). |
| **Structured output** | Forcing the AI to reply in an exact JSON shape. |
| **State machine** | A set of steps where each step decides what runs next. |
| **LangGraph** | A library for building AI state machines. |
| **Celery** | A Python tool for running background jobs. |
| **Redis** | Fast in-memory store, used for queues and caching. |
| **SSE** | Server-Sent Events. Lets the server stream text to the browser live. |
| **Ragas** | A library that scores RAG answer quality. |
| **Multi-tenancy** | One app serving many customers, with data kept separate. |
| **RLS** | Row-Level Security. The database itself hides rows a user shouldn't see. |
| **MSA** | Master Services Agreement – the main contract between two companies. |
| **SOW** | Statement of Work – a smaller contract for a specific project, under an MSA. |
| **Supersedes** | "Replaces / overrides." |
| **Indemnify** | Promise to cover someone's losses if something goes wrong. |
