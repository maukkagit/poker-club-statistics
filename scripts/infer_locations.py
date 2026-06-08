"""
Walk the WhatsApp chat and produce a per-tournament host + address
inference for every [unknown]-location row, so we can manually review
the suggestions before writing anything back to the sheet.

Heuristic, in order of priority for each window [T-14d, T+1d]:
  1. Find the LAST message containing a host hint ("mun luona",
     "meil(le|lä)", "meitsille", "pelit X:n luona", "hostaa", etc.).
     The AUTHOR of that message is the inferred host.
  2. Find every address message in the same window — if it matches the
     host's known residence at that date, we attach the address.
  3. Without a window match, fall back to the host's residence timeline.
  4. Special case: Amos at Mechelininkatu → "Meclun hooli" instead of
     "Amos Aaltio Mechelininkatu 2 B".

Nickname / full-name aliases come from the user:
  Jamppa  = Jamiro Lilja
  Tömö    = Tuomas Järvelä
  Nikki   = Niklas Anttonen  (not in players table, but kept for context)
"""
import re
from datetime import date, timedelta
from pathlib import Path

CHAT_PATH = Path("legacy_files/_chat.txt")

LINE_RE = re.compile(r"^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2})\.(\d{1,2})\.(\d{1,2})\] ([^:]+): (.*)$")

ALIASES = {
    "Jamppa": "Jamiro Lilja",
    "Tömö": "Tuomas Järvelä",
    "Nikki": "Niklas Anttonen",
    "Amos": "Amos Aaltio",
    "Jonis": "Jonis Heikkinen",
}

HOST_RE = re.compile(
    r"(?:\bmun (?:luon|luona|luokse|luok|kämp|mestoil|kotona)\b"
    r"|\bmeil(?:l[äa]|le)?\b"
    r"|\bmeitsil(?:l[äa]|le)?\b"
    r"|\bmeitsille\b"
    r"|\bk[äa]mp[äp]ll[äa]\b"
    r"|\bmun mest(?:a|oilla|oille|alla|alle)\b"
    r"|\bmestoille\b"
    r"|\bhostaa\b"
    r"|\bj[äa]rjest[äa]\b"
    r"|\bis[äa]nn[öo]i\b"
    r"|\bluon[ae]\b"
    r"|\bluonan\b"
    r"|\bluokse\b"
    r"|\b(?:meill[äa]|meille)\b"
    r"|\bmulla\b"
    r"|\bpelit\s+mun\b"
    r"|\bbelit\s+mun\b"  # common typo / playful spelling
    r"|\bpelit\s+meill[äa]?\b"
    r")",
    re.IGNORECASE,
)

# "X:n luona" / "@X luona" / "@X hostaa" patterns name someone explicitly as host.
NAMED_HOST_RES = [
    re.compile(r"@(?:\u2068|\u2069)*([A-ZÄÖÅ][a-zA-ZÄÖÅäöå]+)(?:\u2068|\u2069)*\s+(?:hostaa|luona|sun\s+luona)", re.IGNORECASE),
    re.compile(r"\b([A-ZÄÖÅ][a-zA-ZÄÖÅäöå]+):n\s+luon", re.IGNORECASE),
    re.compile(r"@(?:\u2068|\u2069)*([A-ZÄÖÅ][a-zA-ZÄÖÅäöå]+)(?:\u2068|\u2069)*", re.IGNORECASE),  # generic @mention as weak signal
]
NAMED_HOST_RE = NAMED_HOST_RES[0]  # kept for backwards-compat with old infer()

ADDR_RE = re.compile(
    r"\b([A-ZÄÖÅ][a-zA-ZÄÖÅäöå]+(?:tie|katu|kuja|polku|tori|aukio|rinne|raitti|kaari|niitty|silta|ranta|linja|laita|valkama|portti|silmuke|kallio|harju|niemenmäenkuja))"
    r"\s*(\d+\s*[a-zA-Z]?)",
    re.IGNORECASE,
)

# Residence timelines. Each entry: (start_date_inclusive, end_date_exclusive, address)
# Refined from the chat + user clarifications:
#   Niemenmäenkuja 1 B  = Amos's parents' place
#   Itämerenkatu 3      = Otto Palkama's office (Ruoholahti)
#   The 2024-05-17 "Runeberginkatu 32" message turned out to be Juho's
#   parents' place (Juho said "mun porukoille"), so Amos didn't move
#   there — he was at Mechelininkatu the whole stretch 2023-12-15 →
#   2026-01-15.
RESIDENCE = {
    "Amos Aaltio": [
        (date(2000, 1, 1), date(2023, 6, 30), "Perustie 19 A"),  # pre-Perustie unclear
        (date(2023, 6, 30), date(2023, 12, 15), "Perustie 19 A"),
        (date(2023, 12, 15), date(2026, 1, 15), "Mechelininkatu 2 B"),
        (date(2026, 1, 15), date(2099, 1, 1), "Nervanderinkatu 5 E"),
    ],
    "Jamiro Lilja": [
        (date(2000, 1, 1), date(2099, 1, 1), "Rudolfintie 14 C"),
    ],
    "Tuomas Järvelä": [
        (date(2000, 1, 1), date(2099, 1, 1), "Kettutie 10 A"),
    ],
    "Roope Rättö": [
        # Roope said "Niemenmäenkuja 1 B" once in 2023 (same building as Amos
        # for a brief stretch?), then a long stretch of Kirjokansi.
        (date(2000, 1, 1), date(2024, 1, 1), "Niemenmäenkuja 1 B"),
        (date(2024, 1, 1), date(2099, 1, 1), "Kirjokansi 1 A"),
    ],
    "Heikki Jalo": [
        (date(2000, 1, 1), date(2099, 1, 1), "Itämerenkatu 3"),
    ],
    "Jonis Heikkinen": [
        (date(2000, 1, 1), date(2099, 1, 1), "Muurikuja 1 C"),
    ],
    "Mauno Malmivaara": [
        (date(2000, 1, 1), date(2026, 4, 17), "Eteläinen Rautatiekatu 14 B"),
        (date(2026, 4, 17), date(2099, 1, 1), "Viherniemenkatu 9 A"),
    ],
    "Juho Korhonen": [
        (date(2000, 1, 1), date(2099, 1, 1), "Runeberginkatu 32 C"),
    ],
}

def normalize_author(author: str) -> str:
    return ALIASES.get(author.strip(), author.strip())

def address_for(host: str, d: date) -> str | None:
    timeline = RESIDENCE.get(host)
    if not timeline:
        return None
    for start, end, addr in timeline:
        if start <= d < end:
            return addr
    return None

def display_location(host: str, d: date) -> str:
    addr = address_for(host, d)
    if host == "Amos Aaltio" and addr == "Mechelininkatu 2 B":
        return "Meclun hooli"
    if addr:
        return f"{host} {addr}"
    return f"{host} (address unknown)"

def parse_chat():
    messages = []
    current = None
    for raw in CHAT_PATH.open(encoding="utf-8"):
        line = raw.rstrip("\n").replace("\u200e", "")
        m = LINE_RE.match(line)
        if m:
            if current: messages.append(current)
            d_, mo, y, h, mi, s, author, text = m.groups()
            current = (date(int(y), int(mo), int(d_)), normalize_author(author), text)
        else:
            if current:
                current = (current[0], current[1], current[2] + " " + line)
    if current: messages.append(current)
    return messages

def infer(messages, t_date: date) -> dict:
    start = t_date - timedelta(days=14)
    end = t_date + timedelta(days=1)
    window = [m for m in messages if start <= m[0] <= end]

    # Self-host: speaker effectively says "at my place" / "my crib".
    self_hosts = [m for m in window if HOST_RE.search(m[2])]
    # Named-host: someone @-tags or refers to a specific person as host.
    named = []
    for md, author, text in window:
        # "@X hostaa" or "@X luona" — strongest named signal.
        for first in NAMED_HOST_RES[0].findall(text):
            named.append((md, author, normalize_author(first), "strong", text))
        # "X:n luona" — also strong.
        for first in NAMED_HOST_RES[1].findall(text):
            named.append((md, author, normalize_author(first), "strong", text))

    # Address mentions: the AUTHOR of an address dump on or right before
    # T+0 is almost certainly the host — they're posting their address so
    # the guests can find them.
    addrs_in_window = []
    for md, author, text in window:
        for street, num in ADDR_RE.findall(text):
            addrs_in_window.append((md, author, f"{street.title()} {num.strip()}", text[:80]))

    # Priority order (highest first):
    #   1. Author of the LATEST address message in the window (closest to T+0).
    #   2. Latest strong named-host signal (@X hostaa / X:n luona).
    #   3. Latest self-host message author (closest to T+0).
    inferred_host = None
    signal = None
    if addrs_in_window:
        addrs_sorted = sorted(addrs_in_window, key=lambda x: x[0])
        latest = addrs_sorted[-1]
        # Prefer an address posted on T-1 .. T+0 specifically.
        recent = [a for a in addrs_in_window if (t_date - a[0]).days <= 1 and a[0] <= t_date + timedelta(days=1)]
        if recent:
            inferred_host = recent[-1][1]
            signal = "address"
        else:
            inferred_host = latest[1]
            signal = "address-old"
    if not inferred_host and named:
        latest_named = sorted(named, key=lambda x: x[0])[-1]
        inferred_host = latest_named[2]
        signal = "named"
    if not inferred_host and self_hosts:
        self_hosts_sorted = sorted(self_hosts, key=lambda x: x[0])
        inferred_host = self_hosts_sorted[-1][1]
        signal = "self-host"

    return {
        "host": inferred_host,
        "signal": signal,
        "self_hosts": self_hosts,
        "named": named,
        "addresses": addrs_in_window,
        "window_size": len(window),
    }

TOURNAMENTS = [
    (date(2022, 12, 30), 1),
    (date(2023, 1, 20), 2),
    (date(2023, 2, 17), 3),
    (date(2023, 3, 31), 4),
    (date(2023, 6, 10), 5),
    (date(2023, 6, 30), 6),
    (date(2023, 7, 7), 7),
    (date(2023, 7, 22), 8),
    (date(2023, 7, 29), 9),
    (date(2023, 8, 5), 10),
    (date(2023, 8, 18), 11),
    (date(2023, 9, 2), 12),
    (date(2023, 9, 22), 13),
    (date(2023, 10, 13), 14),
    (date(2023, 10, 21), 15),
    (date(2023, 11, 3), 16),
    (date(2023, 12, 16), 17),
    (date(2023, 12, 29), 18),
    (date(2024, 1, 12), 19),
    (date(2024, 2, 3), 20),
    (date(2024, 2, 16), 21),
    (date(2024, 3, 2), 22),
    (date(2024, 3, 8), 23),
    (date(2024, 3, 23), 24),
    (date(2024, 4, 12), 25),
    (date(2024, 4, 12), 26),
    (date(2024, 4, 27), 27),
    (date(2024, 5, 17), 28),
    (date(2024, 6, 8), 29),
    (date(2024, 6, 8), 30),
    (date(2024, 6, 15), 31),
    (date(2024, 6, 29), 32),
    (date(2024, 7, 6), 33),
    (date(2024, 7, 6), 34),
    (date(2024, 7, 11), 35),
    (date(2024, 7, 25), 36),
    (date(2024, 7, 27), 37),
    (date(2024, 7, 27), 38),
    (date(2024, 8, 17), 39),
    (date(2024, 8, 30), 40),
    (date(2024, 9, 14), 41),
    (date(2024, 10, 4), 42),
    (date(2024, 10, 18), 43),
    (date(2024, 10, 25), 44),
    (date(2024, 11, 15), 45),
    (date(2024, 11, 30), 46),
    (date(2024, 12, 7), 47),
    (date(2024, 12, 7), 48),
    (date(2025, 1, 10), 49),
    (date(2025, 1, 17), 50),
    (date(2025, 1, 18), 51),
    (date(2025, 1, 31), 52),
    (date(2025, 2, 8), 53),
    (date(2025, 2, 21), 54),
    (date(2025, 2, 22), 55),
    (date(2025, 2, 28), 56),
    (date(2025, 3, 14), 57),
    (date(2025, 3, 22), 58),
    (date(2025, 3, 29), 59),
    (date(2025, 4, 4), 60),
    (date(2025, 4, 25), 61),
    (date(2025, 5, 10), 62),
    (date(2025, 5, 30), 63),
    (date(2025, 6, 6), 64),
    (date(2025, 6, 27), 65),
    (date(2025, 7, 5), 66),
    (date(2025, 7, 16), 67),
    (date(2025, 7, 18), 68),
    (date(2025, 7, 25), 69),
    (date(2025, 7, 25), 70),
    (date(2025, 8, 16), 71),
    (date(2025, 8, 29), 72),
    (date(2025, 8, 30), 73),
    (date(2025, 10, 3), 74),
    (date(2025, 10, 10), 75),
    (date(2025, 10, 17), 76),
    (date(2025, 10, 24), 77),
    (date(2025, 11, 14), 78),
    (date(2025, 11, 21), 79),
    (date(2025, 12, 5), 80),
    (date(2025, 12, 19), 81),
    (date(2026, 1, 9), 82),
    (date(2026, 1, 16), 83),
    (date(2026, 1, 31), 84),
    (date(2026, 2, 20), 85),
    (date(2026, 3, 20), 86),
    (date(2026, 4, 17), 87),
    (date(2026, 5, 9), 88),
    (date(2026, 5, 15), 89),
]

def main():
    messages = parse_chat()
    print(f"# Loaded {len(messages)} messages")
    print()
    print(f"{'T#':<3} {'Date':<11} {'Day':<3} {'Host':<22} {'Address':<32} {'Suggested location'}")
    print("-" * 130)
    for d, n in TOURNAMENTS:
        info = infer(messages, d)
        host = info["host"] or "(unknown)"
        addr = address_for(host, d) if host in RESIDENCE else None
        location = display_location(host, d) if host in RESIDENCE else "(unknown)"
        day = d.strftime("%a")
        signal = info["signal"] or "none"
        print(f"{n:<3} {d.isoformat():<11} {day:<3} {host:<22} {addr or '?':<32} {location:<40} [{signal}]")

if __name__ == "__main__":
    main()
