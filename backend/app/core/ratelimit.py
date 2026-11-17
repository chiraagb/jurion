"""Fixed-window rate limit in Redis. Usage: Depends(limit("parse", 10, 60)) = 10 calls per 60 s per signed-in user
(per client IP when nobody is signed in). If Redis is down the limit is skipped, not the request."""
import logging
from fastapi import HTTPException, Request
from app.core.database import redis_client

log = logging.getLogger("jurion.ratelimit")


def limit(name: str, calls: int, window_s: int, by_user: bool = False):
    async def check(request: Request) -> None:
        who = request.client.host if request.client else "?"
        if by_user:  # the session cookie identifies the user without a DB lookup; only the first call per window pays Redis twice
            sid = request.cookies.get("jurion_session")
            uid = await redis_client.get(f"sess:{sid}") if sid else None
            who = uid or who
        key = f"rl:{name}:{who}"
        try:
            n = await redis_client.incr(key)
            if n == 1:
                await redis_client.expire(key, window_s)
        except Exception:
            log.warning("rate limit skipped: Redis unavailable")
            return
        if n > calls:
            raise HTTPException(429, "Too many requests. Try again in a minute.", headers={"Retry-After": str(window_s)})

    return check
