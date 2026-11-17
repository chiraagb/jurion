"""Which chat models the agent may use: the allow-list, building a LangChain model from "provider:model", and the key it needs."""

import importlib.util
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import current_user
from app.core.config import settings
from app.core.database import User, get_db
from app.core.llm_keys import provider_key

router = APIRouter()


PACKAGES = {
    "openai": "langchain_openai",
    "anthropic": "langchain_anthropic",
    "google_genai": "langchain_google_genai",
}


def installed(provider: str) -> bool:
    """Whether the LangChain package for a provider is installed (a model of that provider cannot run without it)."""
    return (
        provider in PACKAGES
        and importlib.util.find_spec(PACKAGES[provider]) is not None
    )


def build_model(spec: str, key: str):
    """The chat model for "provider:model". Imports are lazy so a provider you do not use need not be installed."""
    provider, _, name = spec.partition(":")
    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=name, api_key=key, temperature=0, timeout=60, stream_usage=True
        )
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=name, api_key=key, timeout=60)
    if provider == "google_genai":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=name, google_api_key=key, temperature=0)
    raise ValueError(f"Unsupported provider '{provider}'")


async def resolve(
    db: AsyncSession, uid: uuid.UUID, spec: str | None
) -> tuple[str, str]:
    """The allow-listed model spec and its key, or a 400 the user can act on."""
    spec = spec or settings.AGENT_MODEL
    if spec not in settings.AGENT_ALLOWED_MODELS:
        raise HTTPException(
            400,
            f"Model '{spec}' is not available. Use one of: {', '.join(settings.AGENT_ALLOWED_MODELS)}",
        )
    provider = spec.partition(":")[0]
    if not installed(provider):
        raise HTTPException(
            400,
            f"{spec} needs the {PACKAGES.get(provider, provider)} package, which is not installed on the server.",
        )
    key = await provider_key(db, uid, provider)
    if not key:
        raise HTTPException(
            400,
            f"Save a {provider.replace('_genai', '')} key (key icon, top bar) to use {spec}.",
        )
    return spec, key


@router.get("/ask/models")
async def models(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    """The agent models the server allows, and which of them this user has a key for."""
    have = {
        p: bool(await provider_key(db, user.id, p))
        for p in {m.partition(":")[0] for m in settings.AGENT_ALLOWED_MODELS}
    }
    return {
        "default": settings.AGENT_MODEL,
        "default_mode": settings.ASK_DEFAULT_MODE,
        "models": [
            {
                "id": m,
                "provider": m.partition(":")[0],
                "available": have[m.partition(":")[0]]
                and installed(m.partition(":")[0]),
            }
            for m in settings.AGENT_ALLOWED_MODELS
        ],
    }
