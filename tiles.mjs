import { chromium } from "playwright";

// One viewport-tall PNG per scroll position, so the judge sees the page the way a
// reader does: a screen at a time, at the width it was actually laid out for.
async function tilesAt(page, { width, height, max }) {
  await page.setViewportSize({ width, height });
  await settle(page);
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const tiles = [];
  let y = 0;
  while (y < scrollHeight && tiles.length < max) {
    // fullPage plus clip errors when the clip runs past the document; clamp the last tile.
    const clip = { x: 0, y, width, height: Math.min(height, scrollHeight - y) };
    tiles.push(await page.screenshot({ clip, fullPage: true, type: "png" }));
    y += height;
  }
  const omitted = Math.max(0, Math.ceil(scrollHeight / height) - tiles.length);
  return { tiles, truncated: omitted > 0, omitted };
}

// Walk the page once so lazy images load and scroll-driven timelines run, then return to
// the top. Same walk as qa.mjs's invisibleText, minus the text audit.
async function settle(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await wait(150);
    }
    window.scrollTo(0, 0);
    await wait(150);
  });
}

export async function captureTiles(
  pageUrl,
  { desktop = { width: 1440, height: 900, max: 8 }, phone = { width: 375, height: 812, max: 10 } } = {},
) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: desktop.width, height: desktop.height } });
    await page.goto(pageUrl);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const desktopResult = await tilesAt(page, desktop);
    const phoneResult = await tilesAt(page, phone);
    return {
      desktop: desktopResult.tiles,
      phone: phoneResult.tiles,
      truncated: { desktop: desktopResult.truncated, phone: phoneResult.truncated },
      omitted: { desktop: desktopResult.omitted, phone: phoneResult.omitted },
    };
  } finally {
    await browser.close();
  }
}
