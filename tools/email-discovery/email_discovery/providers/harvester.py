"""theHarvester subprocess wrapper (optional install)."""

from __future__ import annotations

import re
import shutil
import subprocess
from typing import Any

from ..models import EmailHit

EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.I,
)


def _find_binary() -> str | None:
    for name in ("theHarvester", "theharvester"):
        path = shutil.which(name)
        if path:
            return path
    return None


def harvest_domain(
    domain: str,
    *,
    sources: str = "bing,google",
    limit: int = 40,
    timeout: float = 120.0,
) -> tuple[list[EmailHit], list[str]]:
    binary = _find_binary()
    errors: list[str] = []
    if not binary:
        return [], ["theHarvester not on PATH — pip install theHarvester"]

    cmd = [
        binary,
        "-d",
        domain,
        "-b",
        sources,
        "-l",
        str(limit),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return [], ["theHarvester timed out"]
    except Exception as e:
        return [], [str(e)]

    out = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0 and not EMAIL_RE.search(out):
        errors.append(f"theHarvester exit {proc.returncode}")

    hits: dict[str, EmailHit] = {}
    for em in EMAIL_RE.findall(out):
        addr = em.lower()
        if domain.lower() not in addr:
            continue
        hits.setdefault(
            addr,
            EmailHit(email=addr, source="harvester", detail={"sources": sources}),
        )
    return list(hits.values()), errors
