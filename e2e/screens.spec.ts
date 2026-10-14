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

for (const [sz, viewport] of SIZES) {
  for (const [name, hash] of PAGES) {
    test(`screenshot ${name} @${sz}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.goto(`/${hash}`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/.shots/${name}-${sz}.png` });
      if (errors.length) throw new Error(`console errors on ${name}@${sz}:\n  ${errors.join('\n  ')}`);
    });
  }

  test(`screenshot editor with a mod open @${sz}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/editor');
    await page.getByRole('button', { name: /New mod/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/.shots/editor-mod-${sz}.png` });
    await page.locator('.me-tab', { hasText: 'Pieces' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/.shots/editor-pieces-${sz}.png` });
  });
}
