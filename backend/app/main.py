"""HerLit AI backend entrypoint.

Phase 1 intentionally exposes only a health endpoint. Real model orchestration,
source verification and content persistence arrive in Phase 2.
"""

from fastapi import FastAPI

app = FastAPI(title="HerLit AI API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "phase": "mvp-ui"}
