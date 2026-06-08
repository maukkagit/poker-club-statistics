"""
Reproduce the two reported bugs and screenshot the evidence.

1. Date input overflows the card on mobile.
2. Integer inputs gain an un-removable leading zero after erasing and
   re-typing a value.
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_screenshots")
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TOURNAMENT_ID = "07b93b8e-c175-4f6b-9ba7-f71e3c91bc49"


async def login(page):
    await page.goto(f"{BASE}/login", wait_until="networkidle")
    await page.locator('input[type="password"]').press_sequentially(PASSWORD, delay=20)
    await page.wait_for_selector('form button:not([disabled])')
    await page.click("form button")
    await page.wait_for_url(f"{BASE}/", timeout=10_000)


async def repro_date_overflow():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            is_mobile=True,
            has_touch=True,
        )
        page = await ctx.new_page()
        await login(page)
        await page.goto(f"{BASE}/tournaments/{TOURNAMENT_ID}", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=20_000)
        await page.wait_for_timeout(700)

        # Measure the date input vs. its card to assess overflow.
        m = await page.evaluate("""
            () => {
              const date = document.querySelector('input[type="date"]');
              if (!date) return null;
              let card = date.parentElement;
              while (card && !card.classList.contains('card')) card = card.parentElement;
              if (!card) return null;
              const cr = card.getBoundingClientRect();
              const dr = date.getBoundingClientRect();
              return {
                cardLeft: cr.left, cardRight: cr.right, cardWidth: cr.width,
                dateLeft: dr.left, dateRight: dr.right, dateWidth: dr.width,
                dateOverflowRight: dr.right - cr.right,
              };
            }
        """)
        print("\n[date overflow check]")
        print(m)

        # Crop a screenshot to the top of the card so the difference is obvious.
        await page.screenshot(path=str(OUT / "bug-date-overflow.png"), full_page=False, clip={"x": 0, "y": 0, "width": 390, "height": 320})
        print(f"  ✓ {OUT}/bug-date-overflow.png")
        await browser.close()


async def repro_leading_zero():
    """Reproduce the leading-zero bug on the Buy-in (€) field.

    Steps: focus the input, select all, backspace to clear, then type '5'.
    Capture the resulting value.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()
        await login(page)
        await page.goto(f"{BASE}/tournaments/{TOURNAMENT_ID}", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=20_000)
        await page.wait_for_timeout(500)

        # Target the Buy-in (€) input (it sits next to a <label> with that text).
        buyin = page.locator('label:has-text("Buy-in (€)") + input').first
        before = await buyin.input_value()
        # Click + select all + delete + type
        await buyin.click()
        await page.keyboard.press("Control+A")  # macOS supports this too, Meta+A on Mac
        await page.keyboard.press("Meta+A")
        await page.keyboard.press("Delete")
        await page.wait_for_timeout(100)
        after_clear = await buyin.input_value()
        await page.keyboard.type("5", delay=80)
        await page.wait_for_timeout(150)
        after_type = await buyin.input_value()

        print(f"\n[leading zero check]")
        print(f"  before:      {before!r}")
        print(f"  after clear: {after_clear!r}")
        print(f"  after type:  {after_type!r}    (expected: '5')")

        if after_type != "5":
            print(f"  ⚠ BUG REPRODUCED — value should be '5' but is {after_type!r}")
        else:
            print("  (clean — bug not reproduced in headless Chrome)")

        await browser.close()


async def main():
    await repro_date_overflow()
    await repro_leading_zero()


if __name__ == "__main__":
    asyncio.run(main())
