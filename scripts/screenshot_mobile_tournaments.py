"""Quick mobile screenshot of /tournaments to verify the special-star swap."""

import asyncio
import json
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_specials")
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fetch_session_cookie() -> dict:
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"password": PASSWORD}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        for header, value in resp.headers.items():
            if header.lower() == "set-cookie" and value.startswith("pc_session="):
                return {
                    "name": "pc_session",
                    "value": value.split(";", 1)[0].split("=", 1)[1],
                    "url": BASE,
                }
    raise RuntimeError("no pc_session cookie")


async def main():
    cookie = fetch_session_cookie()
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            is_mobile=True,
            has_touch=True,
        )
        await ctx.add_cookies([cookie])
        page = await ctx.new_page()
        await page.goto(f"{BASE}/tournaments", wait_until="networkidle")
        await page.wait_for_function(
            "!document.body.innerText.includes('Loading…')", timeout=15_000
        )
        await asyncio.sleep(0.4)
        path = OUT / "mobile-tournaments-star.png"
        await page.screenshot(path=str(path), full_page=True)
        print(f"  -> {path}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
