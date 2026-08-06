from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EmailHit:
    email: str
    full_name: str | None = None
    title: str | None = None
    source: str = ""
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmailCandidate:
    email: str
    confidence: float
    source: str
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class VerificationResult:
    status: str  # valid | accept_all | invalid | unknown | risky
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class PersonRequest:
    first_name: str
    last_name: str


@dataclass
class EnrichResult:
    domain: str
    hits: list[EmailHit] = field(default_factory=list)
    people: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
