"""Conservative checks for public business contact addresses.

DNS proves only that a domain can receive mail; it cannot prove that an
individual mailbox exists. Temporary DNS failures never invalidate an address.
"""

import json
import re
import urllib.parse
import urllib.request
from functools import lru_cache


ADDRESS = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$")
LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def candidates(raw):
    if not isinstance(raw, str):
        return []
    return [part.strip().removeprefix("mailto:").strip() for part in re.split(r"[;,\s]+", raw) if part.strip()]


def domain_of(address):
    match = ADDRESS.fullmatch(address)
    if not match or len(address) > 254:
        return None
    local, domain = address.rsplit("@", 1)
    if len(local) > 64 or len(domain) > 253 or not all(LABEL.fullmatch(label) for label in domain.split(".")):
        return None
    return domain.lower()


def _lookup(domain, record_type):
    query = urllib.parse.urlencode({"name": domain, "type": record_type})
    request = urllib.request.Request("https://dns.google/resolve?" + query,
                                     headers={"User-Agent": "TochkaEmailAudit/1.0"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


@lru_cache(maxsize=100000)
def mail_domain_status(domain):
    """Return True (mail route), False (no route), or None (DNS uncertain)."""
    try:
        mx = _lookup(domain, "MX")
        if mx.get("Status") == 3:  # NXDOMAIN
            return False
        if mx.get("Status") != 0:
            return None
        answers = [item.get("data", "") for item in mx.get("Answer", []) if item.get("type") == 15]
        if answers:
            return not (len(answers) == 1 and answers[0].strip().endswith(" ."))
        # RFC 5321: if there is no MX, SMTP may use the domain's A/AAAA address.
        uncertain = False
        for kind, number in (("A", 1), ("AAAA", 28)):
            result = _lookup(domain, kind)
            if any(item.get("type") == number for item in result.get("Answer", [])):
                return True
            if result.get("Status") not in (0, 3):
                uncertain = True
        return None if uncertain else False
    except (OSError, ValueError, KeyError):
        return None


def checked_address(raw):
    """Return first address with a mail route; None if none can be confirmed."""
    for address in candidates(raw):
        domain = domain_of(address)
        if domain and mail_domain_status(domain) is True:
            return address
    return None


def assess_address(raw):
    """Return (deliverable address, uncertain); preserve old data on DNS errors."""
    uncertain = False
    for address in candidates(raw):
        domain = domain_of(address)
        if not domain:
            continue
        status = mail_domain_status(domain)
        if status is True:
            return address, False
        if status is None:
            uncertain = True
    return None, uncertain
