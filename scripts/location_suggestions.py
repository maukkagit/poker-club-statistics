"""Final per-tournament location suggestions inferred from the
WhatsApp chat plus user clarifications:

Named locations:
  - "Meclun hooli"      → Amos's own apartment at Mechelininkatu 2 B
                          (he's been there continuously since
                          ~2023-12-15; no later move).
  - "Amos' parents Niemenmäenkuja 1 B" → Amos's parents' place.
  - "Otto Palkama's office Itämerenkatu 3" → Otto's office, Ruoholahti.
  - "Juho's parents Runeberginkatu 32" → Juho Korhonen's parents'
    place; Juho ("Don") himself later got his own apt in the same
    building at 32 C 38.
  - "Sibis (Sibeliuksenpuisto)" → outdoor games in Töölö park.

Hosts whose own apartment was confirmed in chat:
  Jamiro Lilja        Rudolfintie 14 C 416
  Tuomas Järvelä      Kettutie 10 A 21
  Roope Rättö         Tornitaso 1 as 41 (Tapiola, 2023)
                      Kirjokansi 1 A 35 (Iso Omena, 2024+)
  Jonis Heikkinen     Muurikuja 1 C 50
  Mauno Malmivaara    Eteläinen Rautatiekatu 14 B A4
  Maukka              Viherniemenkatu 9 A (new place, spring 2026)
  Amos Aaltio         Perustie 19 A 18 (early 2023)
                      Mechelininkatu 2 B 39  (Meclun hooli, 2023-12 →)
  Juho Korhonen       Runeberginkatu 32 C 38
  Vilko Repo          Nervanderinkatu 5 E

Naming rule (per user):
  - If host is known and they had told their own address earlier in
    chat: label as "<host> <address>".
  - If host is known but their address had NOT been told yet by that
    tournament's date: label as just "<host>".
  - Tournaments with no host evidence: no label (manual fill).
"""
SUGGESTIONS = {
    1:  dict(date="2022-12-30", host="Amos Aaltio",          address="Perustie 19 A",              label="Amos Aaltio Perustie 19 A",               confidence="high",    note="user-confirmed: Amos's old place"),
    2:  dict(date="2023-01-20", host="Juho's parents",       address="Runeberginkatu 32",          label="Juho's parents Runeberginkatu 32",        confidence="high",    note="user-confirmed"),
    3:  dict(date="2023-02-17", host="Amos Aaltio",          address="Perustie 19 A",              label="Amos Aaltio Perustie 19 A",               confidence="high",    note="Amos: 'Pelit mun luon klo 19' — Amos at Perustie (same period as T#1)"),
    4:  dict(date="2023-03-31", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    5:  dict(date="2023-06-10", host="Tuomas Järvelä",       address="Kettutie 10 A",              label="Tuomas Järvelä Kettutie 10 A",            confidence="high",    note="Roope: '@Tömö hostaa' + Tömö posted address"),
    6:  dict(date="2023-06-30", host="Amos Aaltio",          address="Perustie 19 A",              label="Amos Aaltio Perustie 19 A",               confidence="high",    note="Amos posted address + door code"),
    7:  dict(date="2023-07-07", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'Korjaus, meitsi houstaa'"),
    8:  dict(date="2023-07-22", host="Roope Rättö",          address=None,                         label="Roope Rättö",                              confidence="med",     note="Roope: 'meil enemmän tilaa' — Roope's own address wasn't told in chat until 2023-09-02"),
    9:  dict(date="2023-07-29", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    10: dict(date="2023-08-05", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Roope: '@Jamppa luona pelit koska doge'"),
    11: dict(date="2023-08-18", host="Amos Aaltio",          address="Perustie 19 A",              label="Amos Aaltio Perustie 19 A",               confidence="high",    note="Amos: 'mä voin houstaa' + 'Ovikoodi: 7248' (= Perustie door code)"),
    12: dict(date="2023-09-02", host="Roope Rättö",          address="Tornitaso 1 as 41",          label="Roope Rättö Tornitaso 1 (Tapiola)",       confidence="high",    note="Roope: 'lauantain meil' + 'Tornitaso 1 as 41 tervetuloo'"),
    13: dict(date="2023-09-22", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    14: dict(date="2023-10-13", host="Amos' parents",        address="Niemenmäenkuja 1 B",         label="Amos' parents Niemenmäenkuja 1 B",        confidence="high",    note="Amos posted address T-1"),
    15: dict(date="2023-10-21", host="Roope Rättö",          address="Tornitaso 1",                label="Roope Rättö Tornitaso 1 (Tapiola)",       confidence="high",    note="Roope: 'Meitsi voi vaik houstaa' + 'pelataa tääl viimeistään 20'"),
    16: dict(date="2023-11-03", host="Amos' parents",        address="Niemenmäenkuja 1 B",         label="Amos' parents Niemenmäenkuja 1 B",        confidence="high",    note="Amos: 'Mun porukoil' + 'niemenmäki 20:00'"),
    17: dict(date="2023-12-16", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos just moved into his own apt"),
    18: dict(date="2023-12-29", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    19: dict(date="2024-01-12", host="Tuomas Järvelä",       address="Kettutie 10 A",              label="Tuomas Järvelä Kettutie 10 A",            confidence="high",    note="address posted"),
    20: dict(date="2024-02-03", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    21: dict(date="2024-02-16", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    22: dict(date="2024-03-02", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Roope moved from Tornitaso to Kirjokansi"),
    23: dict(date="2024-03-08", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high"),
    24: dict(date="2024-03-23", host="Jonis Heikkinen",      address="Muurikuja 1 C",              label="Jonis Heikkinen Muurikuja 1 C",           confidence="high"),
    25: dict(date="2024-04-12", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    26: dict(date="2024-04-12", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="same day as T#25 — doubleheader/two sessions?"),
    27: dict(date="2024-04-27", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    28: dict(date="2024-05-17", host="Juho's parents",       address="Runeberginkatu 32",          label="Juho's parents Runeberginkatu 32",        confidence="high",    note="Juho: 'voidaa mennä mun porukoille tai sisäpihalle'; Amos relayed the address"),
    29: dict(date="2024-06-08", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Roope posted full directions"),
    30: dict(date="2024-06-08", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high"),
    31: dict(date="2024-06-15", host="Juho's parents",       address="Runeberginkatu 32",          label="Juho's parents Runeberginkatu 32",        confidence="high",    note="Amos: 'Donin porukoiden sisäpihal games' (Don = Juho)"),
    32: dict(date="2024-06-29", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    33: dict(date="2024-07-06", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Roope: 'Pelit La @Rättöcrib'"),
    34: dict(date="2024-07-06", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high"),
    35: dict(date="2024-07-11", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'mun luona klo 18:15 huomenna'"),
    36: dict(date="2024-07-25", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    37: dict(date="2024-07-27", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    38: dict(date="2024-07-27", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    39: dict(date="2024-08-17", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    40: dict(date="2024-08-30", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Lalli: 'Rudolfintie mikä?' Juho: '14c'"),
    41: dict(date="2024-09-14", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Mun luon?'"),
    42: dict(date="2024-10-04", host="Otto Palkama",         address="Itämerenkatu 3",             label="Otto Palkama's office Itämerenkatu 3",    confidence="high",    note="Amos: 'lokaatio olis sittenkin Ruoholahdessa, joinais Heikki, Palkama, Maukka, Zohis'"),
    43: dict(date="2024-10-18", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Roope posted full directions"),
    44: dict(date="2024-10-25", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'natsaa mut pitäs olla meil'"),
    45: dict(date="2024-11-15", host="Jonis Heikkinen",      address="Muurikuja 1 C",              label="Jonis Heikkinen Muurikuja 1 C",           confidence="high"),
    46: dict(date="2024-11-30", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    47: dict(date="2024-12-07", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Roope: 'Oisko lauantain pokernight meil?'"),
    48: dict(date="2024-12-07", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high"),
    49: dict(date="2025-01-10", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    50: dict(date="2025-01-17", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Halukkaat voi tulla klo 19 tähän meille'"),
    51: dict(date="2025-01-18", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Joonas: 'Teil @Amos?' Amos: 'Joo vaikka'"),
    52: dict(date="2025-01-31", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'Kaikki käy mut tääl vois pitää'"),
    53: dict(date="2025-02-08", host="Jonis Heikkinen",      address="Muurikuja 1 C",              label="Jonis Heikkinen Muurikuja 1 C",           confidence="high"),
    54: dict(date="2025-02-21", host=None,                    address=None,                         label=None,                                       confidence="unknown", note="no chat coverage in T-7..T+1"),
    55: dict(date="2025-02-22", host=None,                    address=None,                         label=None,                                       confidence="unknown", note="no chat coverage in T-7..T+1"),
    56: dict(date="2025-02-28", host="Jonis Heikkinen",      address="Muurikuja 1 C",              label="Jonis Heikkinen Muurikuja 1 C",           confidence="high",    note="Jamiro: 'pidetää ami pelit joniksella' (heads-up vs Amos)"),
    57: dict(date="2025-03-14", host="Roope Rättö",          address="Kirjokansi 1 A 35",          label="Roope Rättö Kirjokansi 1 A (Iso Omena)",  confidence="high",    note="Jamiro: 'Pelit siellä tapiolassa', Roope: 'Noniin kaikki tänne'"),
    58: dict(date="2025-03-22", host=None,                    address=None,                         label=None,                                       confidence="unknown", note="no chat coverage on T+0"),
    59: dict(date="2025-03-29", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    60: dict(date="2025-04-04", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    61: dict(date="2025-04-25", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'Houstaan sitte' + posted address"),
    62: dict(date="2025-05-10", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="user-confirmed"),
    63: dict(date="2025-05-30", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high"),
    64: dict(date="2025-06-06", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    65: dict(date="2025-06-27", host="Juho Korhonen",        address="Runeberginkatu 32 C 38",     label="Juho Korhonen Runeberginkatu 32 C",       confidence="high",    note="Juho posted own address"),
    66: dict(date="2025-07-05", host="Amos Aaltio",          address="Mechelininkatu 2 B 39",      label="Meclun hooli",                            confidence="high",    note="Amos: 'Mun luon' + posted address"),
    67: dict(date="2025-07-16", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Mun luona'"),
    68: dict(date="2025-07-18", host="outdoor",              address="Sibeliuksenpuisto (Töölö)",  label="Sibis (Sibeliuksenpuisto)",               confidence="high",    note="user-corrected: outdoor session (chat looked like Meclun hooli but the actual game moved to Sibis)"),
    69: dict(date="2025-07-25", host="outdoor",              address="Sibeliuksenpuisto (Töölö)",  label="Sibis (Sibeliuksenpuisto)",               confidence="high",    note="outdoor games — chat: 'Sibis klo 18'"),
    70: dict(date="2025-07-25", host="outdoor",              address="Sibeliuksenpuisto (Töölö)",  label="Sibis (Sibeliuksenpuisto)",               confidence="high"),
    71: dict(date="2025-08-16", host="Jamiro Lilja",         address="Rudolfintie 14 C 416",       label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'Meitsi voi houstaa' + posted address"),
    72: dict(date="2025-08-29", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="user-corrected"),
    73: dict(date="2025-08-30", host="Mauno Malmivaara",     address="Eteläinen Rautatiekatu 14 B",label="Mauno Malmivaara Eteläinen Rautatiekatu 14 B", confidence="high"),
    74: dict(date="2025-10-03", host="Mauno Malmivaara",     address="Eteläinen Rautatiekatu 14 B",label="Mauno Malmivaara Eteläinen Rautatiekatu 14 B", confidence="high",    note="Mauno posted address"),
    75: dict(date="2025-10-10", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Jamiro: 'klo 20 startti amilla'"),
    76: dict(date="2025-10-17", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Jalli: 'Ami onks teil pelit huome?' Amos: 'Sopii'"),
    77: dict(date="2025-10-24", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Klo 18, Mechelininkadun hooli'"),
    78: dict(date="2025-11-14", host="Amos Aaltio",          address="Mechelininkatu 2 B 39",      label="Meclun hooli",                            confidence="high",    note="Amos: 'Voidaan pelata mun luona' + posted address"),
    79: dict(date="2025-11-21", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Klo 18 Meclun hooli, jos ei muuta'"),
    80: dict(date="2025-12-05", host="Jamiro Lilja",         address="Rudolfintie 14 C 416",       label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Mauno's poll: 'Tänään pelit Jamirolla'"),
    81: dict(date="2025-12-19", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="Amos: 'Mun luona klo 18-19 startti'"),
    82: dict(date="2026-01-09", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="med",     note="small turnout; Amos was the only host candidate"),
    83: dict(date="2026-01-16", host="Vilko Repo",           address="Nervanderinkatu 5 E",        label="Vilko Repo Nervanderinkatu 5 E",          confidence="high",    note="user-corrected: Nervanderinkatu is Vilko's place (not Amos's). Vilko joined chat shortly before this."),
    84: dict(date="2026-01-31", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high",    note="Jamiro: 'Pelit laajikses' + 'Ovikoodi: 4462A'"),
    85: dict(date="2026-02-20", host="Jonis Heikkinen",      address="Muurikuja 1 C",              label="Jonis Heikkinen Muurikuja 1 C",           confidence="high"),
    86: dict(date="2026-03-20", host="Jamiro Lilja",         address="Rudolfintie 14 C",           label="Jamiro Lilja Rudolfintie 14 C",           confidence="high"),
    87: dict(date="2026-04-17", host="Maukka",               address="Viherniemenkatu 9 A",        label="Maukka Viherniemenkatu 9 A",              confidence="high",    note="user-confirmed: Maukka's new place"),
    88: dict(date="2026-05-09", host="Amos Aaltio",          address="Mechelininkatu 2 B",         label="Meclun hooli",                            confidence="high",    note="user-corrected"),
    89: dict(date="2026-05-15", host="Maukka",               address="Viherniemenkatu 9 A",        label="Maukka Viherniemenkatu 9 A",              confidence="high",    note="user-confirmed: Maukka's new place"),
}

if __name__ == "__main__":
    import sys, json, pathlib
    if "--json" in sys.argv:
        # Emit a JSON sidecar that the TypeScript backfill script consumes.
        # Keyed by date so doubleheaders share the same lookup entry (every
        # same-date pair in this dataset shares a single venue anyway).
        by_date: dict[str, dict] = {}
        for n, s in SUGGESTIONS.items():
            d = s["date"]
            if d in by_date and by_date[d]["label"] != s["label"]:
                raise SystemExit(f"Conflicting labels for {d}: {by_date[d]['label']!r} vs {s['label']!r}")
            by_date[d] = {"label": s["label"], "confidence": s["confidence"]}
        out = pathlib.Path("scripts/location_suggestions.json")
        out.write_text(json.dumps(by_date, indent=2, ensure_ascii=False))
        print(f"Wrote {out} ({len(by_date)} dates)")
    else:
        print(f"{'T#':<3} {'Date':<11} {'Conf':<7} {'Suggested location'}")
        print("-" * 90)
        for n, s in SUGGESTIONS.items():
            label = s["label"] or "—"
            note = f"  ({s['note']})" if s.get("note") and s["confidence"] != "high" else ""
            print(f"{n:<3} {s['date']:<11} {s['confidence']:<7} {label}{note}")
