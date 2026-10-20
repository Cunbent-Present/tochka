#!/usr/bin/env python3
"""Собирает базу салонов Точки по крупным городам России из OpenStreetMap.

Запускается раз в неделю на GitHub (см. .github/workflows/data.yml).
Результат:
  data/index.json   — список городов, их границы и число заведений
  data/<город>.json — заведения города: [[id, lat, lon, {теги}], ...]

Теги отдаются почти «как есть», а разбор (категория, адрес, телефон) делает
сама Точка той же функцией parseEl, что и для живой загрузки, — правила в одном месте.
Данные © участники OpenStreetMap, лицензия ODbL.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
# slug, название, центр, «радиус» в градусах (широта, долгота)
CITIES = [
    ("moscow", "Москва", 55.7558, 37.6173, 0.30, 0.50),
    ("spb", "Санкт-Петербург", 59.9343, 30.3351, 0.22, 0.42),
    ("novosibirsk", "Новосибирск", 55.0084, 82.9357, 0.15, 0.26),
    ("ekaterinburg", "Екатеринбург", 56.8389, 60.6057, 0.14, 0.25),
    ("kazan", "Казань", 55.7961, 49.1064, 0.14, 0.24),
    ("nnovgorod", "Нижний Новгород", 56.3269, 44.0059, 0.13, 0.24),
    ("chelyabinsk", "Челябинск", 55.1644, 61.4368, 0.13, 0.22),
    ("krasnoyarsk", "Красноярск", 56.0153, 92.8932, 0.12, 0.25),
    ("samara", "Самара", 53.1959, 50.1002, 0.16, 0.22),
    ("ufa", "Уфа", 54.7388, 55.9721, 0.15, 0.22),
    ("rostov", "Ростов-на-Дону", 47.2357, 39.7015, 0.12, 0.20),
    ("omsk", "Омск", 54.9885, 73.3242, 0.13, 0.22),
    ("krasnodar", "Краснодар", 45.0355, 38.9753, 0.12, 0.18),
    ("voronezh", "Воронеж", 51.6720, 39.1843, 0.12, 0.18),
    ("perm", "Пермь", 58.0105, 56.2502, 0.14, 0.26),
    ("volgograd", "Волгоград", 48.7080, 44.5133, 0.22, 0.30),
    ("tyumen", "Тюмень", 57.1530, 65.5343, 0.10, 0.18),
    ("sochi", "Сочи", 43.6028, 39.7342, 0.20, 0.30),
    ("kaliningrad", "Калининград", 54.7104, 20.4522, 0.08, 0.14),
    ("vladivostok", "Владивосток", 43.1155, 131.8855, 0.12, 0.16),
]
KEEP = {
    "name", "shop", "amenity", "leisure", "male", "female", "hairdresser", "beauty",
    "addr:street", "addr:housenumber", "addr:city", "phone", "contact:phone",
    "website", "contact:website", "url", "email", "contact:email", "opening_hours",
    "contact:vk", "contact:telegram", "contact:instagram", "operator",
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UA = "TochkaDataBuilder/1.0 (+https://github.com/Cunbent-Present/tochka)"


def query(bbox):
    b = ",".join(f"{v:.4f}" for v in bbox)
    return (
        "[out:json][timeout:180];("
        f'nwr["shop"~"^(hairdresser|beauty|massage|tattoo)$"]({b});'
        f'nwr["amenity"~"^(spa|massage)$"]({b});'
        f'nwr["leisure"="spa"]({b});'
        ");out center tags;"
    )


def fetch(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(3):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)
            except Exception as e:  # сервер занят — пробуем другой, потом ждём
                last = e
                print(f"    {url}: {e}", file=sys.stderr)
        time.sleep(30 * (attempt + 1))
    raise last


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


def main():
    os.makedirs(OUT, exist_ok=True)
    index_path = os.path.join(OUT, "index.json")
    old = {}
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            old = {c["slug"]: c for c in json.load(f).get("cities", [])}

    only = set(sys.argv[1:])  # можно собрать только часть городов: build_data.py moscow kazan
    cities = []
    for slug, name, lat, lon, dlat, dlon in CITIES:
        bbox = (lat - dlat, lon - dlon, lat + dlat, lon + dlon)
        entry = {"slug": slug, "name": name, "lat": lat, "lon": lon,
                 "s": bbox[0], "w": bbox[1], "n": bbox[2], "e": bbox[3]}
        if only and slug not in only:
            if slug in old:
                cities.append(old[slug])
            continue
        print(f"{name}…", flush=True)
        try:
            data = fetch(query(bbox))
        except Exception as e:
            print(f"  не удалось: {e}. Оставляю прошлую версию.", file=sys.stderr)
            if slug in old:
                cities.append(old[slug])
            continue
        rows = [r for r in (compact(el) for el in data.get("elements", [])) if r]
        rows.sort(key=lambda r: r[0])
        with open(os.path.join(OUT, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        entry["count"] = len(rows)
        entry["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cities.append(entry)
        print(f"  {len(rows)} заведений", flush=True)
        time.sleep(8)  # бережём бесплатный сервер

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({"cities": cities, "license": "© OpenStreetMap contributors, ODbL"},
                  f, ensure_ascii=False, indent=1)
    total = sum(c.get("count", 0) for c in cities)
    print(f"Готово: {len(cities)} городов, {total} заведений")
    if not cities:
        sys.exit(1)


if __name__ == "__main__":
    main()
