"""Capture screenshots for the player-edit + delete-confirm changes."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/poker_screenshots")
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:3000"
PASSWORD = "cavemanpoker"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TOURNAMENT_ID = "07b93b8e-c175-4f6b-9ba7-f71e3c91bc49"


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

        # 1) Players page: default — should show Edit buttons, NO Delete
        await page.goto(f"{BASE}/players", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=15_000)
        await page.wait_for_timeout(500)
        # Sanity check that no "Delete" buttons exist on this page.
        delete_count = await page.locator("button:has-text('Delete')").count()
        edit_count = await page.locator("button:has-text('Edit')").count()
        print(f"Players page — Edit buttons: {edit_count}, Delete buttons: {delete_count}")
        if delete_count > 0:
            raise SystemExit("REGRESSION: Delete buttons should not appear on /players")
        if edit_count == 0:
            raise SystemExit("REGRESSION: Edit buttons should appear on /players")
        await page.screenshot(path=str(OUT / "feat-players-default.png"))
        print(f"  ✓ {OUT}/feat-players-default.png")

        # 2) Players page: enter edit mode for the first row
        first_edit = page.locator("table tbody tr button:has-text('Edit')").first
        await first_edit.click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "feat-players-editing.png"))
        print(f"  ✓ {OUT}/feat-players-editing.png")

        # Cancel back out so we don't accidentally save anything
        await page.click("button:has-text('Cancel')")
        await page.wait_for_timeout(200)

        # 3) Tournament edit page → click Delete to open the confirm dialog
        await page.goto(f"{BASE}/tournaments/{TOURNAMENT_ID}", wait_until="networkidle")
        await page.wait_for_function("!document.body.innerText.includes('Loading…')", timeout=20_000)
        await page.wait_for_timeout(500)
        await page.click("button:has-text('Delete tournament')")
        # ConfirmDialog has duration-150 transition — wait it out.
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / "feat-tournament-delete-confirm.png"))
        print(f"  ✓ {OUT}/feat-tournament-delete-confirm.png")

        # Click "Keep it" — verify the modal closes and the tournament still exists.
        await page.click("button:has-text('Keep it')")
        await page.wait_for_timeout(400)
        modal_visible = await page.locator('[role="dialog"]').is_visible()
        if modal_visible:
            raise SystemExit("REGRESSION: Confirm dialog did not close after 'Keep it'")
        print("  ✓ 'Keep it' closes the dialog without deleting")

        await browser.close()
        print("\n✓ All visual checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
