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

## Saving the same file twice

Each saved contract stores a **SHA-256 fingerprint** of its PDF (`documents.sha256`). When you save, the server checks whether *you* already saved a file with the same fingerprint:

- **Same file, same account:** the save is refused with `409` and the message names the copy you already have ("You already saved this contract as …"). A renamed copy of the same file is caught too, because the fingerprint comes from the file's bytes, not its name.
- **Replace option:** in the Parser Lab the Save button then shows **Replace it with this result**. Use it when you re-parsed the file (for example with Gemini) and want that version instead. The old copy and its clauses are deleted and the new one saved in one step (`replace=true` on the request).
- **Another account** can save the same file: duplicates are checked per user.
- **Old contracts** saved before this existed were given a fingerprint automatically when the server started. No duplicates were found among them.
- **Limit:** two saves of the same file at the exact same moment can both succeed. A unique database constraint on `(user_id, sha256)` would close that; it is left out for now so old duplicates (if any ever turn up) are never deleted behind your back.
