# 6. Phase 4: Dashboard (the UI)

Goal: a screen where legal staff can ask questions and *see* how the answer was found.

## Layout

A split screen:

```
+----------------------+----------------------+
|                      |                      |
|   Chat               |   Graph view         |
|   (ask questions,    |   (clauses and links |
|    read answers)     |    the AI used)      |
|                      |                      |
+----------------------+----------------------+
```

- **Left – Chat:** type a question, the answer streams in with citations.
- **Right – Graph:** React Flow draws the clauses and documents the engine looked at, and the links it followed (e.g. `SOW_2 → SUPERSEDES → MSA_2021`). Overrides are highlighted.

When a new answer comes back, the chat passes the list of nodes and edges to the graph so it updates.

## Components

| Component | Job |
|---|---|
| `Dashboard` | Holds the split layout and shared graph state |
| `ChatInterface` | Question box, message list, streaming answer |
| `FlowCanvas` | Draws the graph with React Flow (zoom, pan, background grid) |
| `IngestionTracker` | Shows upload progress |

## Upload progress

Ingestion runs in the background, so the UI shows its stage by checking the backend (polling or WebSocket):

```
PARSING → EXTRACTING → GRAPH_INGEST → VECTOR_INDEX → DONE
```

shown as a progress bar.

## Done when

- You can upload a PDF and watch its progress
- You can ask a question, see a streamed cited answer, and see the graph of clauses used
