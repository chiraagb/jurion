"""Sign in with Google: the browser gets a Google ID token, we verify it, then issue our own session.
The session id lives in an HttpOnly cookie (JavaScript can't read it) and maps to a user in Redis,
so logging out or revoking works instantly."""
import asyncio
import secrets
import uuid
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database import User, get_db, redis_client

COOKIE, TTL = "jurion_session", 7 * 24 * 3600
router = APIRouter(prefix="/auth")


class GoogleIn(BaseModel):
    credential: str  # the ID token the Google button hands to the browser


def _verify(credential: str) -> dict:
    # Checks Google's signature, expiry, and that the audience is OUR client id.
    return id_token.verify_oauth2_token(credential, g_requests.Request(), settings.GOOGLE_CLIENT_ID)


def _public(user: User) -> dict:
    return {"email": user.email, "name": user.name, "picture": user.picture}


@router.post("/google")
async def google_login(body: GoogleIn, response: Response, db: AsyncSession = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "GOOGLE_CLIENT_ID is not set in the server .env")
    try:
        info = await asyncio.to_thread(_verify, body.credential)  # the call is blocking
    except ValueError:
        raise HTTPException(401, "Invalid Google token")
    if not info.get("email_verified"):
        raise HTTPException(403, "Google email not verified")
    if settings.ALLOWED_DOMAIN and info.get("hd") != settings.ALLOWED_DOMAIN:
        raise HTTPException(403, f"Only {settings.ALLOWED_DOMAIN} accounts can sign in")

    user = (await db.execute(select(User).where(User.google_sub == info["sub"]))).scalar_one_or_none()
    if not user:
        user = User(google_sub=info["sub"], email=info["email"])
        db.add(user)
    user.email, user.name, user.picture = info["email"], info.get("name", ""), info.get("picture", "")
    await db.commit()

    sid = secrets.token_urlsafe(32)  # fresh id on every login, never reused
    await redis_client.setex(f"sess:{sid}", TTL, str(user.id))
    response.set_cookie(
        COOKIE, sid, max_age=TTL, httponly=True, samesite="lax", secure=settings.COOKIE_SECURE, path="/"
    )
    return _public(user)


async def current_user(sid: str | None = Cookie(None, alias=COOKIE), db: AsyncSession = Depends(get_db)) -> User:
    user_id = await redis_client.get(f"sess:{sid}") if sid else None
    user = await db.get(User, uuid.UUID(user_id)) if user_id else None
    if not user:
        raise HTTPException(401, "Not signed in")
    return user


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return _public(user)


@router.post("/logout", status_code=204)
async def logout(response: Response, sid: str | None = Cookie(None, alias=COOKIE)):
    if sid:
        await redis_client.delete(f"sess:{sid}")  # dead server-side even if the cookie was copied
    response.delete_cookie(COOKIE, path="/")
