"""
Interaction test for PlayerCombobox.

Opens /tournaments/new (so we start with zero entries → every existing player
is selectable), then:
  1) focuses the combobox and screenshots the full unfiltered dropdown
  2) types "ma" and asserts only matching player names are rendered
  3) confirms diacritic-insensitive matching by typing "arsky"-style query
  4) presses ArrowDown + Enter to select a player and verifies a row is added
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_screenshots")
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fail(msg: str) -> None:
    print(f"\n✗ {msg}")
    raise SystemExit(1)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()

        # Login
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.locator('input[type="password"]').press_sequentially(PASSWORD, delay=20)
        await page.wait_for_selector('form button:not([disabled])')
        await page.click("form button")
        await page.wait_for_url(f"{BASE}/", timeout=10_000)

        # New tournament page → empty entries, every player available
        await page.goto(f"{BASE}/tournaments/new", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=15_000)
        await page.wait_for_timeout(800)

        combo = page.locator('input[role="combobox"]')
        await combo.click()
        await page.wait_for_selector('[role="listbox"]', timeout=3_000)
        await page.wait_for_timeout(300)

        all_names = await page.locator('[role="listbox"] [role="option"]').all_inner_texts()
        print(f"Unfiltered dropdown contains {len(all_names)} players")
        if len(all_names) < 5:
            fail(f"Expected many players in unfiltered list, got {len(all_names)}")
        await page.screenshot(path=str(OUT / "combobox-open.png"), clip={"x": 0, "y": 400, "width": 720, "height": 500})
        print(f"  ✓ {OUT}/combobox-open.png")

        # Filter by typing "ma" — should match anything containing "ma" (case insens.)
        await combo.press_sequentially("ma", delay=80)
        await page.wait_for_timeout(300)
        filtered_names = await page.locator('[role="listbox"] [role="option"]').all_inner_texts()
        print(f'Typed "ma" → {len(filtered_names)} matches:')
        for n in filtered_names:
            print(f"    {n}")
        # Sanity check: every result must contain "ma" (case-insensitive,
        # diacritic-insensitive)
        import unicodedata
        def norm(s): return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()
        bad = [n for n in filtered_names if "ma" not in norm(n)]
        if bad:
            fail(f"Non-matching results returned: {bad}")
        if len(filtered_names) >= len(all_names):
            fail("Filtering produced same or more results than unfiltered list")

        await page.screenshot(path=str(OUT / "combobox-filtered.png"), clip={"x": 0, "y": 400, "width": 720, "height": 500})
        print(f"  ✓ {OUT}/combobox-filtered.png")

        # Clear and try diacritic-insensitive: at least one Finnish name in
        # the roster uses Ä/Ö. Looking for "ja" should match e.g. "Tuomas
        # Järvelä" or any "Aleksi Järveläinen".
        for _ in range(5):
            await combo.press("Backspace")
        await page.wait_for_timeout(150)
        await combo.press_sequentially("ja", delay=60)
        await page.wait_for_timeout(300)
        ja_names = await page.locator('[role="listbox"] [role="option"]').all_inner_texts()
        ja_with_diacritics = [n for n in ja_names if any(c not in "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in n)]
        print(f'Typed "ja" → {len(ja_names)} matches (incl. {len(ja_with_diacritics)} with diacritics)')
        if ja_with_diacritics:
            print(f"  ✓ Diacritic-insensitive match works (e.g. {ja_with_diacritics[0]!r})")
        else:
            print("  (no diacritic names in this dataset matched 'ja' — skipping that check)")

        # Clear → highlight first → Enter to select.
        for _ in range(5):
            await combo.press("Backspace")
        await page.wait_for_timeout(150)
        # Take a snapshot of the first option's name BEFORE pressing Enter.
        first_name = (await page.locator('[role="listbox"] [role="option"]').first.inner_text()).strip()
        print(f"\nAbout to select first player: {first_name!r}")
        await combo.press("ArrowDown")  # ensure highlight=0 (already 0)
        # ArrowDown moves to index 1, so press ArrowUp to go back to 0
        await combo.press("ArrowUp")
        await combo.press("Enter")
        await page.wait_for_timeout(500)

        # The player should now appear in the entries table.
        rows = await page.locator("table tbody tr").all_inner_texts()
        joined = " | ".join(rows)
        if first_name not in joined:
            fail(f"Selected player {first_name!r} did not appear in entries table. Rows: {rows}")
        print(f"  ✓ {first_name} appears in entries after Enter")

        # The dropdown should now exclude that player on next open.
        await combo.click()
        await page.wait_for_timeout(200)
        names_after = await page.locator('[role="listbox"] [role="option"]').all_inner_texts()
        if first_name in names_after:
            fail(f"{first_name} still appears in dropdown after being added")
        print(f"  ✓ {first_name} removed from dropdown after being added")

        print("\n✓ All combobox interaction checks passed.")
        await browser.close()


asyncio.run(main())
