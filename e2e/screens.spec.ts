import { test } from '@playwright/test';

/** Visual smoke: screenshots of the static pages at desktop and phone widths (written to e2e/.shots). */
const PAGES: [string, string][] = [
  ['home', '#/'],
  ['editor', '#/editor'],
  ['devgame', '#/dev/game'],
  ['notfound', '#/nope'],
];
const SIZES = [
  ['desktop', { width: 1400, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const;

for (const [name, hash] of PAGES) {
  for (const [sz, viewport] of SIZES) {
    test(`screenshot ${name} @${sz}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.goto(`/${hash}`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `e2e/.shots/${name}-${sz}.png`, fullPage: false });
      if (errors.length) console.log(`[${name}@${sz}] console errors:\n  ${errors.join('\n  ')}`);
    });
  }
}
