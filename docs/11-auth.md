# 11 – Sign in with Google

One click, no passwords to store.

## How it works

1. The browser shows Google's **Sign in with Google** button.
2. Google gives the browser a signed **ID token**. The browser sends it to `POST /auth/google`.
3. The API verifies the token (Google's signature, expiry, and that it was issued for **our** client ID), checks the email is verified and, if `ALLOWED_DOMAIN` is set, that the account belongs to that Google Workspace domain.
4. The API creates or updates the user in the `users` table, makes a random session id, stores it in **Redis** (7 days) and sets it as an **HttpOnly, SameSite=Lax cookie**.
5. Every later request carries the cookie. JavaScript can't read it, so a script injected into the page can't steal it.
6. `POST /auth/logout` deletes the session in Redis, so it stops working at once, even if the cookie was copied.

## Setup

| Where | Setting |
|---|---|
| Google Cloud Console | OAuth client (Web application), authorized JavaScript origin `http://localhost:5173` |
| `backend/.env` | `GOOGLE_CLIENT_ID`, optional `ALLOWED_DOMAIN=yourcompany.com` |
| `frontend/.env` | `VITE_GOOGLE_CLIENT_ID` (same value) |

The client secret is not used by this flow.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /auth/google` | Exchange a Google ID token for a session cookie |
| `GET /auth/me` | Who am I (401 if signed out) |
| `POST /auth/logout` | End the session |

`/parse` and `/settings/llm/*` require sign-in. `/health` is public.

## Before production

- Serve over **HTTPS** and set `COOKIE_SECURE=True`.
- Set `FRONTEND_ORIGIN` and Google's authorized origins to the real domain.
- Set `ALLOWED_DOMAIN` (or keep the consent screen on Internal / test users) so not every Google account can sign in.
- Rate-limit `/auth/google`.
- Add passkeys as a second sign-in option.
