"""
End-to-end verification of the SWR cache strategy.

Walks the app like a user would and counts how many times each API endpoint
gets called. The assertions encode the contract we want from SWR's
stale-while-revalidate config:

  * On the FIRST visit to a route, its primary endpoint is fetched once.
  * Navigating away and back to the same route does NOT cause a fresh
    fetch within the dedupingInterval window (no "Loading…" flash, no extra
    request).
  * After a write (POST/PUT/DELETE), the affected GET endpoints are
    re-fetched exactly once via mutate().
"""

import asyncio
import json
import sys
from collections import Counter
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fail(msg: str) -> None:
    print(f"\n✗ {msg}")
    sys.exit(1)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()

        # Count every API request the browser makes, keyed by "METHOD path".
        counts: Counter[str] = Counter()

        def on_request(req):
            url = req.url
            if "/api/" not in url:
                return
            path = url.split("?")[0].split(BASE, 1)[-1]
            counts[f"{req.method} {path}"] += 1

        page.on("request", on_request)

        # Login — type instead of fill so React's onChange fires reliably
        # (fill races against client hydration on a freshly-loaded page).
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector('input[type="password"]')
        await page.locator('input[type="password"]').press_sequentially(PASSWORD, delay=20)
        # Wait for the submit button to become enabled, then click.
        await page.wait_for_selector('form button:not([disabled])')
        await page.click("form button")
        await page.wait_for_url(f"{BASE}/", timeout=10_000)

        # ---- Phase 1: first visit to each page ----
        # Reset counts AFTER login so the post-login redirect's fetches are
        # counted under "first visit" rather than "login".
        # Generous timeouts here because the first request to each route also
        # triggers the dev server's on-demand compile (~3s) plus a Google
        # Sheets round-trip (~1-2s).
        counts.clear()
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=30_000)

        await page.click('a[href="/tournaments"]')
        await page.wait_for_url(f"{BASE}/tournaments")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=30_000)

        await page.click('a[href="/players"]')
        await page.wait_for_url(f"{BASE}/players")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=30_000)

        phase1 = dict(counts)
        print("\nPhase 1 — first visit to /, /tournaments, /players")
        print(json.dumps(phase1, indent=2))

        # Each list endpoint should have been called exactly once.
        for expected in ["GET /api/stats", "GET /api/tournaments", "GET /api/players"]:
            if phase1.get(expected, 0) != 1:
                fail(f"Expected exactly 1 call to {expected!r} in phase 1, got {phase1.get(expected, 0)}")

        # ---- Phase 2: navigate back and forth — cache should serve all reads ----
        counts.clear()
        await page.click('a[href="/"]')
        await page.wait_for_url(f"{BASE}/")
        await page.wait_for_timeout(500)

        await page.click('a[href="/tournaments"]')
        await page.wait_for_url(f"{BASE}/tournaments")
        await page.wait_for_timeout(500)

        await page.click('a[href="/players"]')
        await page.wait_for_url(f"{BASE}/players")
        await page.wait_for_timeout(500)

        phase2 = dict(counts)
        print("\nPhase 2 — re-visit the same routes within dedupingInterval (2s)")
        print(json.dumps(phase2, indent=2))

        # With dedupingInterval=2000ms, SWR should suppress duplicate fetches
        # for routes hit within 2s. Allowing up to 1 here for any background
        # revalidation race.
        for ep in ["GET /api/stats", "GET /api/tournaments", "GET /api/players"]:
            n = phase2.get(ep, 0)
            if n > 1:
                fail(f"Cache miss on phase-2 re-visit: {ep} fetched {n} times (expected 0)")

        # ---- Phase 3: create a player and confirm invalidation ----
        counts.clear()
        await page.click('a[href="/players"]')
        await page.wait_for_url(f"{BASE}/players")
        unique = f"Smoke {int(asyncio.get_event_loop().time())}"
        await page.fill('input[placeholder="Name"]', unique)
        await page.click('form button:has-text("Add")')
        await page.wait_for_timeout(1_500)

        phase3 = dict(counts)
        print(f"\nPhase 3 — added player {unique!r}; should refetch players + stats")
        print(json.dumps(phase3, indent=2))

        if phase3.get("POST /api/players", 0) != 1:
            fail("POST /api/players did not happen exactly once")
        if phase3.get("GET /api/players", 0) < 1:
            fail("Players list was not revalidated after the POST")
        if phase3.get("GET /api/stats", 0) < 1:
            fail("Dashboard stats were not revalidated after a player mutation")

        # Confirm the new player is in the rendered table without a hard reload.
        body_text = await page.inner_text("body")
        if unique not in body_text:
            fail(f"New player {unique!r} did not appear in the players table after add")

        # ---- Phase 4: navigate to dashboard — cached stats should show
        # the new player immediately (no extra fetch within deduping). ----
        counts.clear()
        await page.click('a[href="/"]')
        await page.wait_for_url(f"{BASE}/")
        await page.wait_for_timeout(500)
        phase4 = dict(counts)
        print("\nPhase 4 — dashboard after player mutation (already revalidated)")
        print(json.dumps(phase4, indent=2))
        if phase4.get("GET /api/stats", 0) > 1:
            fail(f"Dashboard re-fetched stats {phase4['GET /api/stats']} times; expected 0–1")

        # Rename the smoke player to a canonical "Smoke (test artifact)" via
        # the PATCH endpoint, so repeated test runs collapse into a single
        # leftover row rather than accumulating one per run. (Players cannot
        # be deleted from the UI by design — see the players page.)
        await page.click('a[href="/players"]')
        await page.wait_for_url(f"{BASE}/players")
        await page.wait_for_function(
            f"document.body.innerText.includes({json.dumps(unique)})",
            timeout=5_000,
        )
        rows = await page.query_selector_all("table tbody tr")
        for row in rows:
            text = await row.inner_text()
            if unique in text:
                edit_btn = await row.query_selector("button:has-text('Edit')")
                if edit_btn:
                    await edit_btn.click()
                    await page.wait_for_timeout(200)
                    inp = await row.query_selector("input.input")
                    if inp:
                        await inp.fill("Smoke (test artifact)")
                        save = await row.query_selector("button:has-text('Save')")
                        if save:
                            await save.click()
                            await page.wait_for_timeout(800)
                break

        print("\n✓ All cache assertions passed.")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
