"""Confirm Save/Cancel/Delete buttons share a single row on mobile."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TID = "07b93b8e-c175-4f6b-9ba7-f71e3c91bc49"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", executable_path=CHROME, headless=True)
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.locator('input[type="password"]').press_sequentially(PASSWORD, delay=20)
        await page.wait_for_selector('form button:not([disabled])')
        await page.click("form button")
        await page.wait_for_url(f"{BASE}/", timeout=10_000)

        await page.goto(f"{BASE}/tournaments/{TID}", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=20_000)
        await page.wait_for_timeout(800)

        rects = await page.evaluate("""
            () => {
              const txt = (root, t) => Array.from(root.querySelectorAll('button'))
                .find(b => b.innerText.trim() === t);
              const save = txt(document, 'Save');
              const cancel = txt(document, 'Cancel');
              const del = txt(document, 'Delete');
              const g = (el) => el ? el.getBoundingClientRect() : null;
              return { save: g(save), cancel: g(cancel), delete: g(del) };
            }
        """)
        print("button rects (top-left x, top y, width):")
        for k, r in rects.items():
            print(f"  {k:7s}: x={r['x']:.0f}  y={r['y']:.0f}  w={r['width']:.0f}")

        ys = [r["y"] for r in rects.values() if r]
        # Allow ±2px tolerance for sub-pixel rounding differences between
        # buttons that share a flex row but have slightly different intrinsic
        # baselines.
        if max(ys) - min(ys) <= 2:
            print(f"\n✓ All three buttons share the same row (y spread: {max(ys) - min(ys):.2f}px).")
        else:
            print(f"\n✗ Buttons are on different rows: {ys}")
            raise SystemExit(1)

        # Check that Delete is right-aligned (ml-auto effect): it should be
        # further to the right than Save + Cancel combined.
        if rects["delete"]["x"] > rects["cancel"]["x"] + rects["cancel"]["width"] + 8:
            print("✓ Delete is right-aligned (ml-auto preserves visual separation).")
        await browser.close()


asyncio.run(main())
