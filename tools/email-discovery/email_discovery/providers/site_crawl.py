"""Lightweight public site email extraction (Photon-style, minimal deps)."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from ..models import EmailHit

EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.I,
)

DEFAULT_PATHS = (
    "/",
    "/contact",
    "/contact-us",
    "/about",
    "/about-us",
    "/team",
    "/people",
    "/company",
    "/careers",
)


def _same_site(base: str, url: str) -> bool:
    try:
        return urlparse(url).netloc == urlparse(base).netloc
    except Exception:
        return False


def crawl_domain(
    domain: str,
    *,
    max_pages: int = 12,
    timeout: float = 10.0,
    user_agent: str = "FollowUpEmailDiscovery/0.1",
) -> list[EmailHit]:
    domain = domain.lower().lstrip("@")
    base = f"https://{domain}"
    session = requests.Session()
    session.headers["User-Agent"] = user_agent
    seen_urls: set[str] = set()
    emails: dict[str, EmailHit] = {}

    seeds = [urljoin(base, p) for p in DEFAULT_PATHS]
    queue = list(seeds)
    pages = 0

    while queue and pages < max_pages:
        url = queue.pop(0)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            res = session.get(url, timeout=timeout, allow_redirects=True)
        except requests.RequestException:
            continue
        if res.status_code >= 400:
            continue
        pages += 1
        text = res.text
        soup = BeautifulSoup(text, "html.parser")
        for a in soup.select('a[href^="mailto:"]'):
            href = a.get("href") or ""
            addr = href.split(":", 1)[-1].split("?")[0].strip()
            if addr and "@" in addr:
                emails.setdefault(
                    addr.lower(),
                    EmailHit(email=addr.lower(), source="site_crawl", detail={"url": url}),
                )
        for match in EMAIL_RE.findall(text):
            em = match.lower()
            if em.endswith(f"@{domain}") or domain in em.split("@")[-1]:
                emails.setdefault(
                    em,
                    EmailHit(email=em, source="site_crawl", detail={"url": url}),
                )
        for a in soup.find_all("a", href=True):
            href = urljoin(url, a["href"])
            if _same_site(base, href) and href not in seen_urls and len(queue) < 30:
                if any(
                    x in href.lower()
                    for x in ("/contact", "/about", "/team", "/people", "/leadership")
                ):
                    queue.append(href)

    return list(emails.values())
