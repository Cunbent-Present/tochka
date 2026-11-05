#!/usr/bin/env python3
"""Проверяет, правда ли у заведений нет своего сайта (в OpenStreetMap поле «сайт» часто просто не заполнено).

Запускается каждый день на GitHub (см. .github/workflows/sites.yml), понемногу — сначала непроверенные.

Как проверяет заведение без своего сайта:
  1. Домен по названию: «OldBoy» → oldboy.ru, oldboy.com, old-boy.ru… Сайт засчитывается, только если
     на странице есть название заведения или его телефон (чтобы не принять чужой или припаркованный домен).
  2. ВКонтакте — если ссылка на сообщество уже известна и задан секрет VK_SERVICE_KEY: читаем поле «Сайт»
     сообщества (groups.getById, сервисный ключ — без входа в чей-то аккаунт).
Ссылку из ВК на Taplink, YCLIENTS, DIKIDI и т. п. считаем онлайн-записью, а не сайтом.

Результат: data/checks/<регион>.json — {id: [итог, ссылка, дата, как проверяли]}
  итог: "own" — нашли свой сайт, "rec" — только онлайн-запись, "none" — своего сайта не нашли.
  как: "d" — домен, "v" — ВКонтакте.
Точка подмешивает это в карточки и в оценку клиента. Данные © участники OpenStreetMap, лицензия ODbL.
"""
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "checks")
UA = "Mozilla/5.0 (compatible; TochkaSiteCheck/1.0; +https://tochka-klient.ru/)"
BUDGET_MIN = float(os.environ.get("BUDGET_MIN", "150"))
RECHECK_DAYS = 30
STARTED = time.time()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://aficnrxwryphxdgjmyfx.supabase.co")
VK_KEY = os.environ.get("VK_SERVICE_KEY", "").strip()

SITE_TAGS = ("website", "contact:website", "url")
# соцсети, онлайн-запись и каталоги — это не свой сайт (как SOCIAL_HOSTS в app.js)
SOCIAL = re.compile(r"(^|\.)(vk\.com|vk\.ru|vkontakte\.ru|instagram\.com|t\.me|telegram\.me|wa\.me|ok\.ru|youtube\.com|"
                    r"tiktok\.com|facebook\.com|2gis\.ru|yandex\.ru|avito\.ru|zoon\.ru|flamp\.ru)$", re.I)
BOOKING = re.compile(r"(^|\.)(taplink\.(cc|ws|at|ru)|yclients\.com|dikidi\.(net|ru|app)|linktr\.ee|booksy\.com|sonline\.su|"
                     r"easyweek\.(io|ru)|arnica\.pro|beauty\.dikidi\.net|n\d+\.yclients\.com|bio\.link|mssg\.me|hipolink\.(me|net))$", re.I)
PARKED = re.compile(r"домен\s+(продается|продаётся|не\s+делегирован|зарегистрирован)|domain\s+(is\s+)?(for\s+sale|parked)|"
                    r"this\s+domain|sedoparking|parking|reg\.ru/domain|купить\s+домен|сайт\s+в\s+разработке", re.I)
# слова, которые есть почти в каждом названии — по ним домен не угадать
GENERIC = {"барбершоп", "барбер", "салон", "красоты", "студия", "студии", "маникюр", "маникюра", "ногтей", "парикмахерская",
           "парикмахер", "бьюти", "beauty", "barbershop", "barber", "salon", "studio", "studia", "nail", "nails", "bar", "spa",
           "спа", "тату", "tattoo", "массаж", "massage", "brow", "brows", "lash", "lashes", "бровей", "ресниц", "и", "the", "by",
           "центр", "мастерская", "кабинет", "room", "house", "club", "клуб", "shop", "lab", "лаб", "lounge", "point"}
TR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
              ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "h",
               "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))


def translit(s):
    return "".join(TR.get(c, c) for c in s.lower())


def host_of(url):
    try:
        return urllib.parse.urlsplit(url if re.match(r"^[a-z]+://", url, re.I) else "https://" + url).hostname or ""
    except ValueError:
        return ""


def kind_of(url):
    h = host_of(url).removeprefix("www.")
    if not h:
        return None
    if BOOKING.search(h):
        return "rec"
    if SOCIAL.search(h):
        return "social"
    return "own"


def name_words(name):
    words = re.findall(r"[a-zа-яё0-9]+", name.lower().replace("ё", "е"))
    return [w for w in words if w not in GENERIC]


def domain_candidates(name):
    """Несколько вариантов домена по названию; пусто, если название слишком общее."""
    words = name_words(name)
    if not words:
        return []
    lat = [translit(w) for w in words]
    joined, dashed = "".join(lat), "-".join(lat)
    if len(joined) < 4 or not re.fullmatch(r"[a-z0-9-]+", dashed):
        return []
    bases = [joined] + ([dashed] if dashed != joined else [])
    if "h" in joined and any("х" in w for w in words):   # «х» пишут и как h, и как kh
        bases.append(joined.replace("h", "kh"))
    return [f"{b}.{tld}" for b in bases[:3] for tld in ("ru", "com")]


BEAUTY = re.compile(r"стрижк|барбер|маникюр|педикюр|ногт|парикмахер|окрашиван|салон|бров|ресниц|массаж|спа\b|тату|"
                    r"космет|запис|barber|haircut|manicure|nail|beauty|salon|lash|brow|massage|tattoo|spa\b", re.I)


def stem(s):
    """Основа названия города или региона для поиска на странице: «Калининградская область» → «калинингр»."""
    w = re.findall(r"[а-яё]+", (s or "").lower().replace("ё", "е"))
    w = [x for x in w if x not in ("область", "край", "республика", "автономный", "округ", "город", "г")]
    return w[0][:max(4, len(w[0]) - 3)] if w else ""


def town_of(tags, region_town):
    return stem(tags.get("addr:city", "")) or region_town


def page_matches(text, name, phone, town):
    """Свой сайт заведения, если на странице есть его телефон — или название, слова про красоту и город."""
    t = text.lower().replace("ё", "е")
    digits = re.sub(r"\D", "", phone or "")[-7:]
    if len(digits) == 7 and digits in re.sub(r"\D", "", t):
        return True
    words = name_words(name)
    has_name = bool(words) and (" ".join(words) in t or "".join(translit(w) for w in words) in re.sub(r"[^a-z0-9]", "", t))
    return has_name and bool(BEAUTY.search(t)) and bool(town) and town in t


def fetch_page(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if "html" not in (r.headers.get("Content-Type") or "html"):
            return r.geturl(), ""
        raw = r.read(300_000)
    return r.geturl(), raw.decode("utf-8", errors="ignore")


def check_domain(name, phone, town):
    """Ищет свой сайт по названию. Возвращает адрес или ''."""
    for dom in domain_candidates(name):
        for scheme in ("https", "http"):
            try:
                final, text = fetch_page(f"{scheme}://{dom}/")
            except Exception:
                continue
            if text and not PARKED.search(text[:20000]) and kind_of(final) == "own" and page_matches(text, name, phone, town):
                return final
            break   # домен ответил, но это не их сайт — http уже не пробуем
    return ""


TAPLINK = re.compile(r"(^|\.)taplink\.(cc|at|ws|ru)$", re.I)


def link_alive(url):
    """Открывается ли указанный у заведения сайт или Taplink.
    True — да, False — точно нет (домена не существует, 404, припаркован, Taplink кинул на свою главную),
    None — не понять (сервер не ответил вовремя) — такие не помечаем, чтобы не ошибиться."""
    for attempt in range(3):   # сервер не успел ответить — пробуем ещё, с паузой
        try:
            final, text = fetch_page(url, timeout=15)
            break
        except urllib.error.HTTPError as e:
            return False if e.code in (404, 410) else None
        except urllib.error.URLError as e:
            if isinstance(getattr(e, "reason", None), socket.gaierror):
                return False
        except Exception:
            pass
        time.sleep(4 * (attempt + 1))
    else:
        return None
    host = host_of(final)
    if TAPLINK.search(host) and not host.endswith(".taplink.ws"):
        # удалённую страницу Taplink перекидывает на свою главную (taplink.at/en/)
        return urllib.parse.urlsplit(final).path.strip("/") not in ("", "en", "ru")
    return not PARKED.search(text[:20000])


def vk_sites(screen_names):
    """Поле «Сайт» сообществ ВКонтакте: {screen_name: site}. Нужен сервисный ключ VK_SERVICE_KEY."""
    out = {}
    names = sorted(set(screen_names))
    for i in range(0, len(names), 400):
        q = urllib.parse.urlencode({"group_ids": ",".join(names[i:i + 400]), "fields": "site", "access_token": VK_KEY, "v": "5.199"})
        try:
            with urllib.request.urlopen(urllib.request.Request("https://api.vk.com/method/groups.getById?" + q,
                                                               headers={"User-Agent": UA}), timeout=30) as r:
                data = json.load(r)
        except Exception as e:
            print(f"  ВКонтакте не ответил: {e}", file=sys.stderr, flush=True)
            continue
        if "error" in data:
            print(f"  ВКонтакте: {data['error'].get('error_msg')}", file=sys.stderr, flush=True)
            break
        groups = (data.get("response") or {}).get("groups") or data.get("response") or []
        for g in groups:
            for key in (g.get("screen_name"), f"club{g.get('id')}", f"public{g.get('id')}"):
                if key:
                    out[key.lower()] = (g.get("site") or "").strip()
        time.sleep(0.4)
    return out


def vk_screen_name(link):
    m = re.search(r"(?:vk\.com|vk\.ru|vkontakte\.ru)/([A-Za-z0-9_.]+)", link or "") or re.fullmatch(r"@?([A-Za-z0-9_.]+)", link or "")
    return m.group(1).lower() if m else ""


def vk_links():
    """Телефоны и ссылки на ВК заведений: {id: (phone, vk)}. Они лежат в Supabase (place_contacts), а не в открытых файлах."""
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    m = re.search(r"sb_secret_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", key)
    if not m:
        return {}
    key = m.group()
    headers = {"apikey": key, "User-Agent": UA, **({"Authorization": "Bearer " + key} if key.startswith("eyJ") else {})}
    out, start = {}, 0
    while True:
        url = SUPABASE_URL.rstrip("/") + f"/rest/v1/place_contacts?select=id,phone,vk&order=id&offset={start}&limit=1000"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                rows = json.load(r)
        except Exception as e:
            print(f"Контакты из Supabase не получены: {e}", file=sys.stderr, flush=True)
            return out
        out.update({r["id"]: (r.get("phone") or "", r.get("vk") or "") for r in rows})
        if len(rows) < 1000:
            return out
        start += 1000


def push(msg):
    if os.environ.get("GIT_PUSH") != "1":
        return
    import subprocess
    sh = lambda *a: subprocess.run(a, cwd=ROOT, capture_output=True, text=True)
    sh("git", "add", "data/checks")
    if sh("git", "diff", "--cached", "--quiet").returncode == 0:
        return
    sh("git", "commit", "-m", msg)
    for _ in range(3):
        sh("git", "pull", "--rebase", "-X", "theirs", "origin", "main")
        if sh("git", "push", "origin", "HEAD:main").returncode == 0:
            print("  (сохранено на GitHub)", flush=True)
            return
        time.sleep(10)


def main():
    os.makedirs(OUT, exist_ok=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stale = (datetime.now(timezone.utc) - timedelta(days=RECHECK_DAYS)).strftime("%Y-%m-%d")
    contacts = vk_links()
    vk = {pid: v for pid, (_, v) in contacts.items() if v} if VK_KEY else {}
    print(f"Телефонов из Supabase: {sum(1 for p, _ in contacts.values() if p)}", flush=True)
    if VK_KEY:
        print(f"Ссылок на ВКонтакте в базе: {len(vk)}", flush=True)
    else:
        print("Секрета VK_SERVICE_KEY нет — ВКонтакте не проверяю, только домены.", flush=True)

    regions = {r["slug"]: r.get("name", "") for r in json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8")).get("regions", [])}
    files = sorted(f for f in os.listdir(DATA) if f.startswith("ru-") and f.endswith(".json"))
    done_total = found_total = 0
    for fname in files:
        if (time.time() - STARTED) / 60 > BUDGET_MIN:
            print("Время запуска вышло — остальное проверю в следующий раз.", flush=True)
            break
        slug = fname[:-5]
        path = os.path.join(OUT, fname)
        checks = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        rows = json.load(open(os.path.join(DATA, fname), encoding="utf-8"))
        region_town = stem(regions.get(slug, ""))
        links = checks.setdefault("_links", {})   # {id: ["ok" | "dead", дата]} — открывается ли указанный сайт или Taplink
        todo, link_todo = [], []
        for pid, _lat, _lon, t in rows:
            site = re.split(r"\s*;\s*", next((t[k] for k in SITE_TAGS if t.get(k)), ""))[0]   # несколько через «;» — первый
            if site and kind_of(site) in ("own", "rec") and not (pid in links and links[pid][1] > stale):
                link_todo.append((pid, site if re.match(r"^https?://", site, re.I) else "https://" + site))
            if site and kind_of(site) == "own":
                continue          # свой сайт уже указан в OSM
            old = checks.get(pid)
            if old and old[2] > stale:
                continue          # проверяли недавно
            phone = (contacts.get(pid) or ("", ""))[0] or t.get("phone") or t.get("contact:phone") or ""
            todo.append((pid, t.get("name", ""), "" if phone == "*" else phone, town_of(t, region_town)))
        if not todo and not link_todo:
            continue
        print(f"{slug}: ищу сайт у {len(todo)}, проверяю ссылки у {len(link_todo)}", flush=True)

        # 0) указанные сайты и Taplink — живы ли
        dead = 0
        if link_todo:
            with ThreadPoolExecutor(max_workers=6) as pool:   # Taplink не любит много запросов сразу
                alive = list(pool.map(lambda x: link_alive(x[1]), link_todo))
            for (pid, _), ok in zip(link_todo, alive):
                if ok is not None:
                    links[pid] = ["ok" if ok else "dead", today]
                    dead += not ok
            print(f"  мёртвых ссылок: {dead}", flush=True)

        # 1) ВКонтакте: поле «Сайт» у известных сообществ
        by_vk = {}
        names = {pid: vk_screen_name(vk[pid]) for pid, *_ in todo if pid in vk}
        names = {pid: n for pid, n in names.items() if n}
        if names:
            sites = vk_sites(names.values())
            for pid, n in names.items():
                s = sites.get(n, "")
                if s:
                    first = re.split(r"[\s,;]+", s)[0]
                    k = kind_of(first)
                    if k in ("own", "rec"):
                        by_vk[pid] = [k, first if re.match(r"^https?://", first) else "https://" + first, today, "v"]

        # 2) домен по названию — параллельно, у каждого сайта свой сервер
        rest = [x for x in todo if x[0] not in by_vk or by_vk[x[0]][0] != "own"]
        with ThreadPoolExecutor(max_workers=24) as pool:
            urls = list(pool.map(lambda x: check_domain(x[1], x[2], x[3]), rest))
        for (pid, name, *_), url in zip(rest, urls):
            if url:
                checks[pid] = ["own", url, today, "d"]
            elif pid in by_vk:
                checks[pid] = by_vk[pid]
            elif domain_candidates(name) or pid in names:
                checks[pid] = ["none", "", today, "dv" if pid in names else "d"]
            # слишком общее название без ВК — проверить нечем, ничего не пишем
        for pid, v in by_vk.items():
            if v[0] == "own":
                checks[pid] = v

        found = sum(1 for pid, *_ in todo if pid in checks and checks[pid][0] in ("own", "rec") and checks[pid][2] == today)
        done_total += len(todo); found_total += found
        with open(path, "w", encoding="utf-8") as f:
            json.dump(checks, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        print(f"  нашёл сайт или запись: {found}", flush=True)
        push(f"Проверка сайтов: {slug} ({today})")

    push(f"Проверка сайтов ({today})")
    print(f"Готово: проверено {done_total}, найдено сайтов и записи {found_total}", flush=True)


if __name__ == "__main__":
    main()
