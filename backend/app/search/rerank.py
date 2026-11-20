"""Reranking: a cross-encoder (bge-reranker-v2-m3 by default) reads the question and each clause TOGETHER and scores how well
the clause answers it. Hybrid search only compares them separately (a vector each, or shared words), so a clause written in
other words can rank 15th; the reranker re-scores the top SEARCH_RERANK_POOL and lifts it into the top K.

Runs locally: contract text never leaves the server and there is no per-query cost. The model loads once per process:
at startup when SEARCH_RERANK is on (main.py), else on first use. Scoring runs in a worker thread so the event loop keeps
serving other requests, one search at a time: on one CPU, two at once only compete and double the memory.
"""

import asyncio
import importlib.util
import logging
import threading
from app.core.config import settings

log = logging.getLogger("jurion")
MAX_TOKENS = 512  # longer clauses are cut: the question and the clause's start decide relevance
_model = None
_failed = False
_load_lock = threading.Lock()
_predict_lock = threading.Lock()  # one scoring at a time per process (torch is not guaranteed thread-safe, and parallel CPU runs gain nothing)


def unavailable() -> str | None:
    """Why the reranker cannot run here, or None if it can. Cheap: checks the package and the downloaded model files without
    loading the model, so the settings dialog can grey the switch out with a reason."""
    if _failed:
        return "The reranker model failed to load on this server (see the server log)."
    if importlib.util.find_spec("sentence_transformers") is None:
        return "The sentence-transformers package is not installed on the server."
    if _model is None:
        from huggingface_hub import try_to_load_from_cache

        if not isinstance(try_to_load_from_cache(settings.SEARCH_RERANK_MODEL, "config.json"), str):
            return f"The model is not downloaded. Run: uv run hf download {settings.SEARCH_RERANK_MODEL}"
    return None


def load():
    """The cross-encoder, loaded once per process. None if it cannot load (then search runs without reranking)."""
    global _model, _failed
    with _load_lock:
        if _model is None and not _failed:
            try:
                from sentence_transformers import CrossEncoder  # imported here: torch is slow to import and most requests never rerank

                _model = CrossEncoder(settings.SEARCH_RERANK_MODEL, max_length=MAX_TOKENS)
            except Exception as e:  # not installed, no network for the first download, out of memory
                _failed = True
                log.warning("reranker unavailable, searching without it: %s: %s", type(e).__name__, e)
    return _model


def _score(question: str, hits: list[dict]) -> list[float] | None:
    model = load()
    if model is None:
        return None
    pairs = [(question, f"{h['title']}\n{h['content']}") for h in hits]
    with _predict_lock:
        return [float(s) for s in model.predict(pairs, batch_size=16)]


async def rerank(question: str, hits: list[dict], top: int) -> list[dict]:
    """`hits` re-ordered by the cross-encoder, best first, cut to `top`; each gains `rerank_score` and keeps its
    `vector_rank` / `keyword_rank`. If the model is unavailable or fails, the hybrid order is kept."""
    if not hits:
        return hits
    try:
        scores = await asyncio.to_thread(_score, question, hits)
    except Exception as e:
        log.warning("rerank failed, keeping the hybrid order: %s", type(e).__name__)
        scores = None
    if scores is None:
        return hits[:top]
    for h, s in zip(hits, scores):
        h["rerank_score"] = round(s, 4)
    return sorted(hits, key=lambda h: -h["rerank_score"])[:top]
