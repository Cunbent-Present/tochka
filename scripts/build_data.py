#!/usr/bin/env python3
"""Собирает базу салонов Точки по всем регионам России из OpenStreetMap.

Запускается раз в неделю на GitHub (см. .github/workflows/data.yml).

Как работает:
  1. Берёт из OSM список регионов (административные границы 4-го уровня с кодом RU-…).
  2. По очереди скачивает заведения каждого региона — сначала те, что давно не обновлялись.
  3. После каждого региона сразу сохраняет файл и индекс, поэтому обрыв сборки
     ничего не портит: следующий запуск продолжит с самых старых регионов.

Результат:
  data/index.json      — список регионов: число заведений, дата, сетка покрытия (клетки 1°×1°)
  data/<регион>.json   — заведения: [[id, lat, lon, {теги}], ...]

Теги отдаются почти «как есть», а разбор (категория, адрес, телефон) делает
сама Точка функцией parseEl — правила в одном месте.
Данные © участники OpenStreetMap, лицензия ODbL.
"""
import json
import math
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
KEEP = {
    "name", "shop", "amenity", "leisure", "male", "female", "hairdresser", "beauty",
    "addr:street", "addr:housenumber", "addr:city", "phone", "contact:phone",
    "website", "contact:website", "url", "email", "contact:email", "opening_hours",
    "contact:vk", "contact:telegram", "contact:instagram", "operator",
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UA = "TochkaDataBuilder/2.0 (+https://github.com/Cunbent-Present/tochka)"
# Сколько минут можно работать за один запуск (остальное — в следующий раз)
BUDGET_MIN = float(os.environ.get("BUDGET_MIN", "270"))
PAUSE = 12  # секунд между запросами — бережём бесплатный сервер


def fetch(q, timeout=600):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(2):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    data = json.load(r)
                if data.get("remark", "").lower().startswith("runtime error"):
                    raise RuntimeError(data["remark"][:200])
                return data
            except Exception as e:  # сервер занят — пробуем другой, потом ждём
                last = e
                print(f"    {url}: {e}", file=sys.stderr, flush=True)
        time.sleep(45 * (attempt + 1))
    raise last


def list_regions():
    q = ('[out:json][timeout:180];'
         'relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^RU-"];'
         'out tags;')
    regions = {}
    for el in fetch(q, timeout=300).get("elements", []):
        t = el.get("tags", {})
        iso = t.get("ISO3166-2", "")
        if not iso.startswith("RU-"):
            continue
        slug = iso.lower()
        # если у региона в OSM две записи с одним кодом — берём первую
        regions.setdefault(slug, {"slug": slug, "iso": iso, "rel": el["id"],
                                  "name": t.get("name:ru") or t.get("name") or iso})
    return sorted(regions.values(), key=lambda r: r["slug"])


def region_query(rel):
    a = 3600000000 + rel
    return (
        f"[out:json][timeout:800][maxsize:1073741824];area({a})->.a;("
        'nwr["shop"~"^(hairdresser|beauty|massage|tattoo)$"](area.a);'
        'nwr["amenity"~"^(spa|massage)$"](area.a);'
        'nwr["leisure"="spa"](area.a);'
        ");out center tags;"
    )


def compact(el):
    tags = el.get("tags") or {}
    if not tags.get("name"):
        return None
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    t = {k: v for k, v in tags.items() if k in KEEP and v}
    return [el["type"][0] + str(el["id"]), round(lat, 6), round(lon, 6), t]


def cells_of(rows):
    """Клетки 1°×1°, где у региона есть заведения: так Точка понимает, какой файл грузить."""
    return sorted({f"{math.floor(r[1])}:{math.floor(r[2])}" for r in rows})


def push_progress(msg):
    """На GitHub сохраняем промежуточный результат, чтобы новые регионы появлялись в Точке сразу."""
    if os.environ.get("GIT_PUSH") != "1":
        return
    sh = lambda *a: subprocess.run(a, cwd=os.path.join(OUT, ".."), capture_output=True, text=True)
    sh("git", "add", "data")
    if sh("git", "diff", "--cached", "--quiet").returncode == 0:
        return
    sh("git", "commit", "-m", msg)
    for _ in range(3):
        sh("git", "pull", "--rebase", "-X", "theirs", "origin", "main")
        if sh("git", "push", "origin", "HEAD:main").returncode == 0:
            print("  (промежуточный результат сохранён на GitHub)", flush=True)
            return
        time.sleep(10)


def load_index():
    path = os.path.join(OUT, "index.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_index(idx):
    idx["regions"] = sorted(idx.get("regions", []), key=lambda r: -r.get("count", 0))
    idx["total"] = sum(r.get("count", 0) for r in idx["regions"])
    idx["license"] = "© OpenStreetMap contributors, ODbL"
    tmp = os.path.join(OUT, "index.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, os.path.join(OUT, "index.json"))


def main():
    started = time.time()
    os.makedirs(OUT, exist_ok=True)
    idx = load_index()
    done = {r["slug"]: r for r in idx.get("regions", [])}

    regions = list_regions()
    print(f"Регионов в OSM: {len(regions)}", flush=True)
    if not regions:
        sys.exit("Не удалось получить список регионов")
    # сначала регионы без данных, потом самые старые
    regions.sort(key=lambda r: done.get(r["slug"], {}).get("updated", ""))

    ok = fail = 0
    for reg in regions:
        if (time.time() - started) / 60 > BUDGET_MIN:
            print("Время запуска вышло — остальные регионы обновятся в следующий раз.", flush=True)
            break
        print(f"{reg['name']} ({reg['iso']})…", flush=True)
        try:
            data = fetch(region_query(reg["rel"]))
        except Exception as e:
            print(f"  не удалось: {e}", file=sys.stderr, flush=True)
            fail += 1
            time.sleep(PAUSE)
            continue
        rows = sorted((r for r in (compact(el) for el in data.get("elements", [])) if r), key=lambda r: r[0])
        with open(os.path.join(OUT, f"{reg['slug']}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        done[reg["slug"]] = {
            "slug": reg["slug"], "name": reg["name"], "count": len(rows), "cells": cells_of(rows),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M"),
        }
        idx["regions"] = list(done.values())
        save_index(idx)  # сохраняем после каждого региона
        ok += 1
        print(f"  {len(rows)} заведений", flush=True)
        if ok % 12 == 0:
            push_progress(f"База салонов: {len(done)} регионов ({datetime.now(timezone.utc):%Y-%m-%d})")
        time.sleep(PAUSE)

    # Когда собраны все регионы — убираем старую базу «по городам» (её заменили регионы)
    all_slugs = {r["slug"] for r in regions}
    if all_slugs <= set(done) and idx.get("cities"):
        for c in idx.pop("cities"):
            p = os.path.join(OUT, f"{c['slug']}.json")
            if c["slug"] not in all_slugs and os.path.exists(p):
                os.remove(p)
        save_index(idx)
        print("Старая база по городам удалена — теперь всё по регионам.")

    push_progress(f"База салонов: {len(done)} регионов ({datetime.now(timezone.utc):%Y-%m-%d})")
    print(f"Готово за {round((time.time() - started) / 60)} мин: обновлено {ok}, ошибок {fail}, "
          f"в базе {len(done)} регионов, {idx.get('total', 0)} заведений", flush=True)
    if ok == 0 and fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
