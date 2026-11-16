# 1. Overview

## What is Jurion?

Jurion is a tool that reads legal contracts and answers questions about them – correctly, and with proof (it tells you exactly which clause in which document the answer came from).

You upload contracts. You ask things like:

- "What is our liability cap with Vendor X?"
- "Does the SOW override the Master Agreement on liability?"
- "Which contracts don't have a GDPR data processing addendum?"

Jurion finds the right clauses and gives you a cited answer.

## Why build it?

The usual way to build "chat with your documents" is called **RAG** (Retrieval-Augmented Generation): chop documents into pieces, find the pieces that *sound* similar to the question, and hand them to an AI to write an answer.

That works okay for blog posts. It breaks on contracts, for three reasons:

### Problem 1: Clauses depend on other clauses
Section 14.2 might only make sense if you also read Section 1 (definitions) and Section 14.1. If you chop the contract into random pieces, those links are lost.

### Problem 2: Some documents override others
Companies have bundles of contracts: a Master Services Agreement (MSA), several Statements of Work (SOWs), amendments, etc. A SOW might say *"Notwithstanding Section 10 of the MSA, liability is capped at $500,000."* That means the SOW wins. Normal RAG can't tell which document wins – it might show you the old, overridden clause.

### Problem 3: Answers need several hops
"Are we protected if our vendor's subcontractor leaks data?" means following a chain: us → vendor → subcontractor, across several contracts. Simple similarity search can't follow chains.

## How Jurion fixes this

| Problem | Normal RAG | Jurion |
|---|---|---|
| Which document wins | Guesses based on similar text | Follows `SUPERSEDES` / `AMENDS` links in a graph |
| Broken context | Splits text at random points | Splits along real contract structure (Article → Section → Clause) |
| Multi-step questions | Can't connect the dots | Walks the graph across documents |
| Made-up answers | Answers even from bad matches | Checks the results first, retries if they're poor, and must cite every claim |

In short, Jurion uses **two kinds of search together**:

- A **graph** (Neo4j) that stores *how clauses and documents relate*.
- A **vector database** (Postgres + pgvector) that finds clauses by *meaning*.

A fixed **RAG workflow** (not an autonomous agent) runs both searches, grades the results, retries if they're poor, and writes a cited answer.
