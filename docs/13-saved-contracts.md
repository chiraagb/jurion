# 13 – Saved contracts

Parse a contract, press **Save contract**, and it is kept for you.

## Flow

1. **Parser Lab:** upload a PDF. `/parse` returns the clauses but stores nothing.
2. Press **Save contract**. The browser sends the PDF and the parse result to `POST /documents`.
3. The API checks the PDF (size, `%PDF` header, opens it), validates the result, and stores one `documents` row, its `clauses` rows (in reading order) and the PDF itself.
4. **My contracts** lists your saved contracts. Opening one shows the same side-by-side view (PDF + clauses) as a fresh parse. The trash icon deletes it, with a confirmation.

## Endpoints (all need sign-in)

| Endpoint | Purpose |
|---|---|
| `POST /documents` | Save a PDF and its parsed clauses |
| `GET /documents` | List your contracts (newest first) |
| `GET /documents/{id}` | One contract with its clauses |
| `GET /documents/{id}/pdf` | The original PDF |
| `DELETE /documents/{id}` | Delete the contract and its clauses |

## Privacy

Every query filters by the signed-in user. Asking for someone else's contract returns **404**, the same as a contract that doesn't exist, so IDs can't be probed. The integration test `tests/integration/test_documents.py` checks this with two users.

## Limits

- The PDF is stored in Postgres (max 25 MB each). Fine for now; move to object storage (S3) when volume grows.
- Saving does not re-run the parser; it stores what you saw. Re-parsing a saved contract is not built yet.
- Nothing is searchable by meaning yet: embeddings are the next step.
