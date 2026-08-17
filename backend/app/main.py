"""HerLit AI backend entrypoint.

This FastAPI health scaffold is not the Phase 2 application runtime. The MVP
orchestration lives in TypeScript/Next server routes and directly reuses the
existing domain engines. A future independent backend must consume stable
contracts rather than copy scoring, verification, quote or grounding logic.
"""

from fastapi import FastAPI

app = FastAPI(title="HerLit AI API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "role": "health-scaffold-only"}
