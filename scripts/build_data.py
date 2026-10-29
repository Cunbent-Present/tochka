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
from datetime import datetime, timedelta, timezone

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


# Города из списка в Точке: собираются первыми и быстро (небольшая рамка вокруг города)
CITIES = [
    ("moscow", "Москва", 55.7558, 37.6173), ("spb", "Санкт-Петербург", 59.9343, 30.3351),
    ("novosibirsk", "Новосибирск", 55.0084, 82.9357), ("ekaterinburg", "Екатеринбург", 56.8389, 60.6057),
    ("kazan", "Казань", 55.7961, 49.1064), ("nnovgorod", "Нижний Новгород", 56.3269, 44.0059),
    ("chelyabinsk", "Челябинск", 55.1644, 61.4368), ("krasnoyarsk", "Красноярск", 56.0153, 92.8932),
    ("samara", "Самара", 53.1959, 50.1002), ("ufa", "Уфа", 54.7388, 55.9721),
    ("rostov", "Ростов-на-Дону", 47.2357, 39.7015), ("omsk", "Омск", 54.9885, 73.3242),
    ("krasnodar", "Краснодар", 45.0355, 38.9753), ("voronezh", "Воронеж", 51.6720, 39.1843),
    ("perm", "Пермь", 58.0105, 56.2502), ("volgograd", "Волгоград", 48.7080, 44.5133),
    ("tyumen", "Тюмень", 57.1530, 65.5343), ("sochi", "Сочи", 43.6028, 39.7342),
    ("kaliningrad", "Калининград", 54.7104, 20.4522), ("vladivostok", "Владивосток", 43.1155, 131.8855),
]
CITY_DAYS = 6          # город обновляется, если данным больше стольких дней
REGION_DAYS = 6        # регион без пропусков обновляется не чаще, чем раз в столько дней
# Регионы, где эти города: их собираем раньше остальных
PRIORITY = ["RU-MOW", "RU-SPE", "RU-MOS", "RU-LEN", "RU-KDA", "RU-NVS", "RU-SVE", "RU-TA", "RU-NIZ",
            "RU-KYA", "RU-SAM", "RU-BA", "RU-ROS", "RU-OMS", "RU-VOR", "RU-PER", "RU-VGG", "RU-TYU",
            "RU-KGD", "RU-PRI", "RU-CHE"]
TILE = 2.0             # если регион не отдаётся целиком — качаем кусками по 2°×2° (при ошибке — по 1°)
FILTER = ('nwr["shop"~"^(hairdresser|beauty|massage|tattoo)$"]{f};'
          'nwr["amenity"~"^(spa|massage)$"]{f};'
          'nwr["leisure"="spa"]{f};')


def fetch(q, timeout=600, tries=2):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(tries):
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
        if attempt + 1 < tries:
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


def region_query(rel, bbox=None, timeout=800):
    a = 3600000000 + rel
    f = "(area.a)" + (f"({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]})" if bbox else "")
    return (f"[out:json][timeout:{timeout}][maxsize:1073741824];area({a})->.a;("
            + FILTER.format(f=f) + ");out center tags;")


def bbox_query(s, w, n, e):
    return "[out:json][timeout:300];(" + FILTER.format(f=f"({s},{w},{n},{e})") + ");out center tags;"


def region_bounds(rel):
    data = fetch(f"[out:json][timeout:120];relation({rel});out bb;", timeout=180)
    b = (data.get("elements") or [{}])[0].get("bounds")
    if not b:
        raise RuntimeError("нет границ региона")
    return b["minlat"], b["minlon"], b["maxlat"], b["maxlon"]


def tiles(s, w, n, e, size):
    out, la = [], math.floor(s / size) * size
    while la < n:
        lo = math.floor(w / size) * size
        while lo < e:
            out.append((round(max(la, s), 4), round(max(lo, w), 4),
                        round(min(la + size, n), 4), round(min(lo + size, e), 4)))
            lo += size
        la += size
    return out


def fetch_region(reg):
    """Сначала весь регион одним запросом; не вышло — по кускам. Возвращает (элементы, все ли куски скачались)."""
    try:
        return fetch(region_query(reg["rel"], timeout=400), timeout=460, tries=1).get("elements", []), True
    except Exception as e:
        print(f"  целиком не отдаётся ({str(e)[:80]}) — качаю по кускам", flush=True)
    s, w, n, e = region_bounds(reg["rel"])
    if e - w > 180:  # регион пересекает 180° (Чукотка) — берём восточную часть Евразии
        w, e = 0, 180
    size = TILE if (n - s) * (e - w) / (TILE * TILE) <= 120 else 4.0
    got, whole = {}, True
    queue = [(t, size) for t in tiles(s, w, n, e, size)]
    while queue:
        t, sz = queue.pop(0)
        try:
            for el in fetch(region_query(reg["rel"], t, timeout=300), timeout=360, tries=1).get("elements", []):
                got[el["type"] + str(el["id"])] = el
        except Exception:
            if sz > 1:
                queue = [(x, sz / 2) for x in tiles(*t, sz / 2)] + queue
            else:
                whole = False
                print(f"    кусок {t} не скачался", file=sys.stderr, flush=True)
        time.sleep(3)
    return list(got.values()), whole


def build_cities(idx, started):
    """Города из списка Точки — быстрые запросы по рамке вокруг центра. Не трогаем свежие."""
    have = {c["slug"]: c for c in idx.get("cities", [])}
    today = datetime.now(timezone.utc)
    for slug, name, lat, lon in CITIES:
        old = have.get(slug)
        fresh = old and old.get("count") and os.path.exists(os.path.join(OUT, f"{slug}.json")) and \
            (today - datetime.fromisoformat(old["updated"][:10]).replace(tzinfo=timezone.utc)).days < CITY_DAYS
        if fresh:
            continue
        if (time.time() - started) / 60 > BUDGET_MIN:
            break
        dlat, dlon = 0.3, 0.5
        s, w, n, e = round(lat - dlat, 4), round(lon - dlon, 4), round(lat + dlat, 4), round(lon + dlon, 4)
        print(f"Город {name}…", flush=True)
        try:
            data = fetch(bbox_query(s, w, n, e), timeout=360)
        except Exception as ex:
            print(f"  не удалось: {ex}", file=sys.stderr, flush=True)
            continue
        rows = sorted((r for r in (compact(el) for el in data.get("elements", [])) if r), key=lambda r: r[0])
        with open(os.path.join(OUT, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        have[slug] = {"slug": slug, "name": name, "lat": lat, "lon": lon, "s": s, "w": w, "n": n, "e": e,
                      "count": len(rows), "updated": today.strftime("%Y-%m-%d")}
        idx["cities"] = [have[c[0]] for c in CITIES if c[0] in have] + \
            [c for k, c in have.items() if k not in {x[0] for x in CITIES}]
        save_index(idx)
        print(f"  {len(rows)} заведений", flush=True)
        time.sleep(PAUSE)
    push_progress(f"База салонов: города из списка ({today:%Y-%m-%d})")


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
    if os.environ.get("SKIP_CITIES") != "1":
        build_cities(idx, started)
    done = {r["slug"]: r for r in idx.get("regions", [])}

    regions = list_regions()
    print(f"Регионов в OSM: {len(regions)}", flush=True)
    if not regions:
        sys.exit("Не удалось получить список регионов")
    # сначала регионы без данных (регионы городов из списка — первыми), потом недокачанные, потом самые старые
    pri = {iso: i for i, iso in enumerate(PRIORITY)}
    def order(r):
        d = done.get(r["slug"])
        if not d:
            return (0, pri.get(r["iso"], 99), "")
        return (1 if d.get("partial") else 2, pri.get(r["iso"], 99) if d.get("partial") else 0, d.get("updated", ""))
    regions.sort(key=order)

    ok = fail = 0
    now_s = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    fresh_after = (datetime.now(timezone.utc) - timedelta(days=REGION_DAYS)).strftime("%Y-%m-%dT%H:%M")
    for reg in regions:
        d = done.get(reg["slug"])
        if d and not d.get("partial") and d.get("updated", "") > fresh_after:
            print("Остальные регионы свежие — обновятся, когда им будет больше недели.", flush=True)
            break   # список отсортирован от старых к свежим — дальше только свежие
        if (time.time() - started) / 60 > BUDGET_MIN:
            print("Время запуска вышло — остальные регионы обновятся в следующий раз.", flush=True)
            break
        print(f"{reg['name']} ({reg['iso']})…", flush=True)
        try:
            elements, whole = fetch_region(reg)
        except Exception as e:
            print(f"  не удалось: {e}", file=sys.stderr, flush=True)
            fail += 1
            time.sleep(PAUSE)
            continue
        rows = sorted((r for r in (compact(el) for el in elements) if r), key=lambda r: r[0])
        old = done.get(reg["slug"])
        if not whole and old and old.get("count", 0) > len(rows):
            print(f"  скачалось меньше прежнего ({len(rows)} < {old['count']}) — оставляю старые данные", flush=True)
            fail += 1
            continue
        with open(os.path.join(OUT, f"{reg['slug']}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        done[reg["slug"]] = {
            "slug": reg["slug"], "name": reg["name"], "count": len(rows), "cells": cells_of(rows),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M"),
        }
        if not whole:
            done[reg["slug"]]["partial"] = True
        idx["regions"] = list(done.values())
        save_index(idx)  # сохраняем после каждого региона
        ok += 1
        print(f"  {len(rows)} заведений", flush=True)
        if ok % 6 == 0:
            push_progress(f"База салонов: {len(done)} регионов ({datetime.now(timezone.utc):%Y-%m-%d})")
        time.sleep(PAUSE)

    push_progress(f"База салонов: {len(done)} регионов ({datetime.now(timezone.utc):%Y-%m-%d})")
    print(f"Готово за {round((time.time() - started) / 60)} мин: обновлено {ok}, ошибок {fail}, "
          f"в базе {len(done)} регионов, {idx.get('total', 0)} заведений", flush=True)
    if ok == 0 and fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
