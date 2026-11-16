"""Per-provider LLM API keys, encrypted at rest in Postgres. The plaintext key never leaves this module
except to build an LLM client, and is never returned by the API (only a masked hint)."""
import uuid
from typing import Dict, Optional
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database import LlmApiKey


def _fernet() -> Fernet:
    if not settings.ENCRYPTION_KEY:
        raise RuntimeError("ENCRYPTION_KEY is not set in the server .env")
    return Fernet(settings.ENCRYPTION_KEY.encode())


def mask(key: str) -> str:
    return f"{key[:3]}…{key[-4:]}" if len(key) > 8 else "…"


async def save_key(db: AsyncSession, user_id: uuid.UUID, provider: str, api_key: str) -> str:
    hint = mask(api_key)
    token = _fernet().encrypt(api_key.encode()).decode()
    await db.merge(LlmApiKey(user_id=user_id, provider=provider, ciphertext=token, hint=hint))
    await db.commit()
    return hint


async def load_key(db: AsyncSession, user_id: uuid.UUID, provider: str) -> Optional[str]:
    row = await db.get(LlmApiKey, (user_id, provider))
    if not row:
        return None
    try:
        return _fernet().decrypt(row.ciphertext.encode()).decode()
    except InvalidToken:  # ENCRYPTION_KEY changed since the key was saved
        return None


async def delete_key(db: AsyncSession, user_id: uuid.UUID, provider: str) -> None:
    row = await db.get(LlmApiKey, (user_id, provider))
    if row:
        await db.delete(row)
        await db.commit()


async def key_hints(db: AsyncSession, user_id: uuid.UUID) -> Dict[str, str]:
    return {r.provider: r.hint for r in (await db.execute(select(LlmApiKey).where(LlmApiKey.user_id == user_id))).scalars()}


ENV_KEYS = {"openai": "OPENAI_API_KEY", "google_genai": "GEMINI_API_KEY"}  # provider -> the .env setting that is the fallback key


async def provider_key(db: AsyncSession, user_id: uuid.UUID, provider: str) -> Optional[str]:
    """The user's saved key for a provider, else that provider's .env key. Agent models can come from any provider; the saved-key table is already per provider."""
    saved_as = "gemini" if provider == "google_genai" else provider  # the key store calls Google's provider "gemini"
    try:
        stored = await load_key(db, user_id, saved_as)
    except Exception:  # ENCRYPTION_KEY missing: fall back to the .env key
        stored = None
    return stored or getattr(settings, ENV_KEYS.get(provider, ""), "") or None
