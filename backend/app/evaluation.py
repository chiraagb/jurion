"""Serves the latest retrieval evaluation (written by `python -m tests.eval_qa`) to the Evaluation page."""

import json
from pathlib import Path
from fastapi import APIRouter, Depends
from app.core.auth import current_user
from app.core.database import User

router = APIRouter()
RESULTS = Path(__file__).resolve().parent.parent / "tests" / "qa" / "results.json"


@router.get("/evaluation")
async def evaluation(_: User = Depends(current_user)):
    return json.loads(RESULTS.read_text()) if RESULTS.exists() else {"available": False}
