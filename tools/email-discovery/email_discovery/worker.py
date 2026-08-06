"""FastAPI worker — POST /v1/enrich."""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .models import PersonRequest
from .orchestrator import enrich_domain


class PersonIn(BaseModel):
    first_name: str
    last_name: str


class EnrichIn(BaseModel):
    domain: str
    people: list[PersonIn] = Field(default_factory=list)
    providers: list[str] | None = None
    smtp: bool = False


def create_app() -> FastAPI:
    app = FastAPI(title="FollowUp Email Discovery", version="0.1.0")
    secret = os.environ.get("OSINT_WORKER_SECRET")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/enrich")
    def enrich(
        body: EnrichIn,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        if secret:
            if not authorization or authorization != f"Bearer {secret}":
                raise HTTPException(status_code=401, detail="Unauthorized")
        people = [
            PersonRequest(first_name=p.first_name, last_name=p.last_name)
            for p in body.people
        ]
        result = enrich_domain(
            body.domain,
            people,
            providers=body.providers,
            smtp=body.smtp,
        )
        return {
            "domain": result.domain,
            "hits": [h.__dict__ for h in result.hits],
            "people": result.people,
            "errors": result.errors,
        }

    return app
