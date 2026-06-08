"""
One-shot mobile screenshot capture for the poker-club UI audit.

Uses Playwright with the system-installed Google Chrome (no Chromium download
needed) and an iPhone 14 viewport (390 x 844, devicePixelRatio 3).
"""

import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_screenshots")
OUT.mkdir(exist_ok=True)

BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
TOURNAMENT_ID = "07b93b8e-c175-4f6b-9ba7-f71e3c91bc49"

PAGES = [
    ("dashboard", f"{BASE}/"),
    ("tournaments", f"{BASE}/tournaments"),
    ("tournament-edit", f"{BASE}/tournaments/{TOURNAMENT_ID}"),
    ("tournament-new", f"{BASE}/tournaments/new"),
    ("players", f"{BASE}/players"),
]

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


async def main(label: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="chrome", executable_path=CHROME, headless=True
        )
        # iPhone 14 viewport. Use a tall viewport so full_page works without
        # excessive stitching artifacts.
        context = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            is_mobile=True,
            has_touch=True,
        )
        page = await context.new_page()

        # Log in
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.fill('input[type="password"]', PASSWORD)
        await page.click('button[type="submit"], form button')
        await page.wait_for_url(f"{BASE}/", timeout=10_000)

        for name, url in PAGES:
            await page.goto(url, wait_until="networkidle")
            # Wait until the "Loading…" placeholder is gone (every page renders
            # it during the initial fetch). Then give recharts/react another
            # beat to actually paint.
            try:
                await page.wait_for_function(
                    "!document.body.innerText.includes('Loading…')",
                    timeout=8_000,
                )
            except Exception:
                pass
            await page.wait_for_timeout(1_500)
            out = OUT / f"{label}-{name}.png"
            await page.screenshot(path=str(out), full_page=True)
            print(f"  ✓ {out}")

        # Bonus: capture the hamburger drawer open on the dashboard.
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_timeout(1_000)
        try:
            await page.click('button[aria-label="Open menu"]')
            # Wait for the slide-in + fade-in (duration-200) to fully complete.
            await page.wait_for_timeout(1_200)
            out = OUT / f"{label}-drawer-open.png"
            await page.screenshot(path=str(out), full_page=False)
            print(f"  ✓ {out}")
        except Exception as e:
            print(f"  ! drawer screenshot failed: {e}")

        await browser.close()


if __name__ == "__main__":
    label = sys.argv[1] if len(sys.argv) > 1 else "before"
    asyncio.run(main(label))
    print(f"\nDone — files in {OUT}/{label}-*.png")
