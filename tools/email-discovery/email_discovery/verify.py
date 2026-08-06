"""MX and optional SMTP verification."""

from __future__ import annotations

import re
import smtplib
import socket
from typing import Any

import dns.resolver
from email_validator import EmailNotValidError, validate_email

from .models import VerificationResult

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def verify_syntax(email: str) -> VerificationResult:
    try:
        validate_email(email, check_deliverability=False)
        return VerificationResult(status="unknown", detail={"syntax": "ok"})
    except EmailNotValidError as e:
        return VerificationResult(status="invalid", detail={"syntax": str(e)})


def verify_mx(email: str) -> VerificationResult:
    syn = verify_syntax(email)
    if syn.status == "invalid":
        return syn
    domain = email.split("@", 1)[1]
    try:
        answers = dns.resolver.resolve(domain, "MX")
        hosts = sorted(str(r.exchange).rstrip(".") for r in answers)
        if not hosts:
            return VerificationResult(status="invalid", detail={"mx": "none"})
        return VerificationResult(
            status="unknown",
            detail={"mx": hosts[:3], "syntax": "ok"},
        )
    except Exception as e:
        return VerificationResult(status="invalid", detail={"mx_error": str(e)})


def verify_smtp(
    email: str,
    timeout: float = 8.0,
    from_addr: str = "verify@followup.local",
) -> VerificationResult:
    mx = verify_mx(email)
    if mx.status == "invalid":
        return mx
    domain = email.split("@", 1)[1]
    try:
        answers = dns.resolver.resolve(domain, "MX")
        mx_host = str(sorted(answers, key=lambda r: r.preference)[0].exchange).rstrip(
            "."
        )
    except Exception as e:
        return VerificationResult(status="unknown", detail={"smtp": f"mx: {e}"})

    try:
        with smtplib.SMTP(timeout=timeout) as smtp:
            smtp.connect(mx_host, 25)
            smtp.helo(socket.getfqdn())
            smtp.mail(from_addr)
            code, _ = smtp.rcpt(email)
        if code in (250, 251):
            return VerificationResult(status="valid", detail={"smtp_code": code})
        if code in (450, 451, 452):
            return VerificationResult(status="unknown", detail={"smtp_code": code})
        if code == 552:
            return VerificationResult(status="accept_all", detail={"smtp_code": code})
        return VerificationResult(status="invalid", detail={"smtp_code": code})
    except Exception as e:
        return VerificationResult(status="unknown", detail={"smtp_error": str(e)})


def best_verification(
    email: str, *, smtp: bool = False, timeout: float = 8.0
) -> VerificationResult:
    if smtp:
        return verify_smtp(email, timeout=timeout)
    return verify_mx(email)
