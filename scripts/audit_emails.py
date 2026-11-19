#!/usr/bin/env python3
"""Remove undeliverable venue email domains from existing Supabase contacts."""

import json
import os
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from email_validation import assess_address


BASE = os.environ.get("SUPABASE_URL", "https://aficnrxwryphxdgjmyfx.supabase.co").rstrip("/")
raw_key = os.environ.get("SUPABASE_SECRET_KEY", "")
match = re.search(r"sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", raw_key)
KEY = match.group() if match else raw_key.strip()
if not KEY:
    raise SystemExit("SUPABASE_SECRET_KEY is required")

HEADERS = {"apikey": KEY, "Content-Type": "application/json", "User-Agent": "TochkaEmailAudit/1.0"}
if KEY.startswith("eyJ"):
    HEADERS["Authorization"] = "Bearer " + KEY


def request(method, query, body=None):
    url = BASE + "/rest/v1/place_contacts?" + query
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response) if method == "GET" else None


def main():
    last_id = ""
    examined = removed = corrected = uncertain = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        while True:
            params = {"select": "id,email", "email": "not.is.null", "order": "id.asc", "limit": "500"}
            if last_id:
                params["id"] = "gt." + last_id
            rows = request("GET", urllib.parse.urlencode(params))
            if not rows:
                break
            last_id = rows[-1]["id"]
            assessed = list(pool.map(lambda row: assess_address(row["email"]), rows))
            bad_ids = []
            for row, (address, dns_uncertain) in zip(rows, assessed):
                examined += 1
                if dns_uncertain:
                    uncertain += 1
                elif address is None:
                    bad_ids.append(row["id"])
                elif address != row["email"]:
                    # Individual PATCH changes only the email column.
                    request("PATCH", urllib.parse.urlencode({"id": "eq." + row["id"]}), {"email": address})
                    corrected += 1
            for start in range(0, len(bad_ids), 80):
                ids = bad_ids[start:start + 80]
                request("PATCH", urllib.parse.urlencode({"id": "in.(" + ",".join(ids) + ")"}), {"email": None})
                removed += len(ids)
            print(f"Проверено {examined}, удалено {removed}, исправлено {corrected}, DNS временно недоступен {uncertain}", flush=True)
    print(f"Готово: проверено {examined}, удалено {removed}, исправлено {corrected}, DNS временно недоступен {uncertain}")


if __name__ == "__main__":
    main()
