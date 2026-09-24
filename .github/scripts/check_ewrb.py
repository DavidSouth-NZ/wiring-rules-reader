#!/usr/bin/env python3
"""Weekly check of EWRB news for Wiring Rules (AS/NZS 3000) amendments, rulings or new editions.
Adds anything new to updates.json so the app can show an alert. Standard library only."""
import json, re, sys, html, datetime, urllib.request

NEWS_URL = "https://www.ewrb.govt.nz/about-us/news-and-notices/"
BASE = "https://www.ewrb.govt.nz"
UPDATES = "updates.json"

TOPIC = re.compile(r"AS\s*/?\s*NZS\s*3000|wiring\s+rules", re.I)
CHANGE = re.compile(r"amend|ruling|new edition|edition|draft|public comment|consult|cited|citation|revis|published|released|update|change", re.I)
AMD_NUM = re.compile(r"amendment\s*(?:no\.?\s*)?(\d+)|\bamd\s*(\d+)|\bA(\d)\b", re.I)
RULING_NUM = re.compile(r"ruling\s*(?:no\.?\s*)?(\d+)", re.I)

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (WiringRulesReader update check; GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def news_items(page):
    """Return (title, url) for each news link on the EWRB news page."""
    out, seen = [], set()
    for m in re.finditer(r'<a\b[^>]*href="([^"]*?/about-us/news-and-notices/[^"#?]+?)"[^>]*>(.*?)</a>', page, re.S | re.I):
        href, inner = m.group(1), m.group(2)
        title = html.unescape(re.sub(r"<[^>]+>", " ", inner))
        title = re.sub(r"\s+", " ", title).strip()
        url = href if href.startswith("http") else BASE + href
        url = url.rstrip("/") + "/"
        if not title or url.rstrip("/").endswith("news-and-notices") or len(title) < 8 or title.lower() in ("read more", "show more news"):
            continue
        if url in seen:
            continue
        seen.add(url); out.append((title, url))
    return out

def relevant(title, body=""):
    if re.search(r"standard of the month|meeting agenda|decision", title, re.I):
        return False
    return bool(TOPIC.search(title) and (CHANGE.search(title) or re.search(r"amendment|ruling|new edition|public comment", body, re.I)))

DEFAULT = {
    "about": "Wiring Rules Reader update list. The app reads this file each time it opens online.",
    "updated": "", "standard": "AS/NZS 3000:2018",
    "items": [
        {"id": "AS3000-2018-A1", "type": "amendment", "num": 1, "title": "Amendment No. 1", "date": "January 2020"},
        {"id": "AS3000-2018-A2", "type": "amendment", "num": 2, "title": "Amendment No. 2", "date": "April 2021"},
        {"id": "AS3000-2018-A3", "type": "amendment", "num": 3, "title": "Amendment No. 3", "date": "May 2023"},
        {"id": "AS3000-2018-R1", "type": "ruling", "num": 1, "title": "Ruling 1", "date": "May 2024"}
    ],
    "notices": []
}

def load_updates():
    try:
        with open(UPDATES, encoding="utf-8") as f:
            return json.load(f), False
    except FileNotFoundError:
        print("::warning::updates.json was missing, so a new one has been created.")
        return json.loads(json.dumps(DEFAULT)), True
    except json.JSONDecodeError as e:
        print(f"::error::updates.json isn't valid JSON (line {e.lineno}, column {e.colno}): {e.msg}. Fix it on GitHub; nothing was changed.")
        sys.exit(1)

def main():
    data, created = load_updates()
    data.setdefault("items", []); data.setdefault("notices", [])
    known_ids = {x["id"] for x in data["items"] + data["notices"]}
    try:
        page = fetch(NEWS_URL)
    except Exception as e:
        print(f"::warning::Couldn't read the EWRB news page this time ({e}). It will try again next week.")
        if created:
            json.dump(data, open(UPDATES, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        return 0   # a temporary outage shouldn't fail the job
    items = news_items(page)
    print(f"Found {len(items)} news links")
    added = 0
    for title, url in items:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        nid = "ewrb-" + slug
        if nid in known_ids:
            continue
        body = ""
        if TOPIC.search(title):
            try: body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fetch(url)))[:6000]
            except Exception: pass
        if not relevant(title, body if TOPIC.search(title) else ""):
            continue
        text = title + " " + body
        am = [int(next(g for g in m.groups() if g)) for m in AMD_NUM.finditer(title)]
        ru = [int(m.group(1)) for m in RULING_NUM.finditer(title)]
        made_item = False
        if am and re.search(r"3000", text):
            n = max(am)
            if not any(x.get("type") == "amendment" and x.get("num") == n for x in data["items"]):
                data["items"].append({"id": f"AS3000-2018-A{n}", "type": "amendment", "num": n, "title": f"Amendment No. {n}",
                                      "date": datetime.date.today().strftime("%B %Y"), "url": url, "text": f"EWRB notice: {title}", "source": "ewrb-auto"})
                known_ids.add(f"AS3000-2018-A{n}"); added += 1; made_item = True
        elif ru and re.search(r"3000", text):
            n = max(ru)
            if not any(x.get("type") == "ruling" and x.get("num") == n for x in data["items"]):
                data["items"].append({"id": f"AS3000-2018-R{n}", "type": "ruling", "num": n, "title": f"Ruling {n}",
                                      "date": datetime.date.today().strftime("%B %Y"), "url": url, "text": f"EWRB notice: {title}", "source": "ewrb-auto"})
                known_ids.add(f"AS3000-2018-R{n}"); added += 1; made_item = True
        # record the notice (hidden when it already became an amendment/ruling alert, so users get one pop-up)
        data["notices"].append({"id": nid, "title": "EWRB: " + title, "text": "The Electrical Workers Registration Board has posted news about the Wiring Rules. Tap Details to read it.", "url": url, "source": "ewrb-auto", "hidden": made_item})
        known_ids.add(nid); added += 1
        print("Added:", title)
    if added or created:
        data["updated"] = datetime.date.today().isoformat()
        with open(UPDATES, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
    print("New entries:", added)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:   # report clearly instead of a bare crash
        import traceback; traceback.print_exc()
        print(f"::error::The EWRB check hit a problem: {type(e).__name__}: {e}")
        sys.exit(1)
