"""Infer company email patterns from known addresses."""

from __future__ import annotations

import re
from collections import Counter

COMMON_PATTERNS = [
    "{first}.{last}",
    "{f}{last}",
    "{first}{last}",
    "{first}_{last}",
    "{first}",
    "{last}",
    "{first}{f_last}",
    "{f}.{last}",
]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def infer_pattern(emails: list[str], domain: str) -> str | None:
    domain = domain.lower().lstrip("@")
    votes: Counter[str] = Counter()
    for raw in emails:
        email = raw.lower().strip()
        if not email.endswith("@" + domain):
            continue
        local = email.split("@", 1)[0]
        parts = re.split(r"[._+\-]", local)
        if len(parts) >= 2:
            first, last = parts[0], parts[-1]
            if len(first) == 1 and len(parts) >= 2:
                votes["{f}.{last}"] += 1
                votes["{f}{last}"] += 1
            votes["{first}.{last}"] += 1
            votes["{first}_{last}"] += 1
            votes["{f}{last}"] += 1
            votes["{first}{last}"] += 1
        elif len(local) > 1:
            votes["{first}"] += 1
    if not votes:
        return None
    return votes.most_common(1)[0][0]


def apply_pattern(pattern: str, first: str, last: str) -> str:
    f = _norm(first)
    l = _norm(last)
    f_last = l[0] if l else ""
    local = (
        pattern.replace("{first}", f)
        .replace("{last}", l)
        .replace("{f}", f[:1] if f else "")
        .replace("{f_last}", f_last)
    )
    return local


def generate_candidates(
    first: str, last: str, domain: str, pattern: str | None, limit: int = 8
) -> list[str]:
    domain = domain.lower().lstrip("@")
    patterns = [pattern] if pattern else []
    for p in COMMON_PATTERNS:
        if p not in patterns:
            patterns.append(p)
    out: list[str] = []
    seen: set[str] = set()
    for p in patterns:
        if len(out) >= limit:
            break
        local = apply_pattern(p, first, last)
        if not local:
            continue
        email = f"{local}@{domain}"
        if email in seen:
            continue
        seen.add(email)
        out.append(email)
    return out
