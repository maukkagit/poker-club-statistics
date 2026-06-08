"""Capture screenshots demonstrating the new dashboard toggle and stats table.

Renders:
  - Dashboard with include-special toggle OFF (default)
  - Dashboard with include-special toggle ON
  - Tournaments list (showing Special badge on the 5 imported events)
  - Tournament edit page for one of the special tournaments
"""

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_specials")
OUT.mkdir(exist_ok=True)

BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
SPECIAL_TOURNAMENT_ID = "9ffb1808-6a9d-4829-b5b8-4472093ce2b7"  # 2026 NLH 6-Max Winter Classic

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fetch_session_cookie() -> dict:
    """Hit /api/auth/login and grab the session cookie so we can skip the
    React form dance entirely. Returns a dict suitable for Playwright's
    context.add_cookies()."""
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"password": PASSWORD}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(f"login failed: {resp.status}")
        for header, value in resp.headers.items():
            if header.lower() == "set-cookie" and value.startswith("pc_session="):
                cookie_value = value.split(";", 1)[0].split("=", 1)[1]
                return {
                    "name": "pc_session",
                    "value": cookie_value,
                    "url": BASE,
                }
    raise RuntimeError("no pc_session cookie in login response")


async def main():
    cookie = fetch_session_cookie()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="chrome", executable_path=CHROME, headless=True
        )

        # Desktop viewport — the table is wide enough that mobile would clip
        # the columns we want to show off.
        ctx = await browser.new_context(
            viewport={"width": 1400, "height": 1000},
            device_scale_factor=1,
        )
        await ctx.add_cookies([cookie])
        page = await ctx.new_page()

        async def shot(name: str):
            path = OUT / f"{name}.png"
            await page.wait_for_load_state("networkidle")
            await asyncio.sleep(0.6)
            await page.screenshot(path=str(path), full_page=True)
            print(f"  -> {path}")

        # Dashboard — default (toggle off)
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_function(
            "!document.body.innerText.includes('Loading…')", timeout=15_000
        )
        await shot("dashboard-default")

        # Flip the toggle on
        toggle = page.locator("label", has_text="Include special tournaments")
        await toggle.locator("input[type=checkbox]").check()
        await shot("dashboard-include-specials")

        # Tournaments list
        await page.goto(f"{BASE}/tournaments", wait_until="networkidle")
        await page.wait_for_function(
            "!document.body.innerText.includes('Loading…')", timeout=15_000
        )
        await shot("tournaments-list")

        # Edit page for a special tournament (badge + Type checkbox visible)
        await page.goto(
            f"{BASE}/tournaments/{SPECIAL_TOURNAMENT_ID}", wait_until="networkidle"
        )
        await page.wait_for_function(
            "!document.body.innerText.includes('Loading…')", timeout=15_000
        )
        await shot("edit-special")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
