/**
 * Production build served from a subpath (/catan-web/, like GitHub Pages).
 * Run with `npm run e2e:pages`.
 */
import { expect, test } from '@playwright/test';
import { copyInviteLink, createRoom, joinViaLink, newPlayer } from './helpers';

test('subpath build: assets load, invite link keeps the subpath, guest joins', async ({ browser, baseURL }) => {
  expect(baseURL).toContain('/catan-web/');
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  await createRoom(host, './');
  expect(host.page.url()).toContain('/catan-web/#/room/');
  const link = await copyInviteLink(host);
  expect(link).toMatch(/^http:\/\/localhost:\d+\/catan-web\/#\/room\/[A-Z0-9]{6}$/);
  await joinViaLink(guest, link);
  await expect(host.page.locator('.player-row', { hasText: 'Bob' })).toBeVisible();

  // Deep links and the editor work from the subpath too.
  await guest.page.goto(new URL('#/editor', baseURL).toString());
  await expect(guest.page.getByText('Mod library')).toBeVisible();
  // No test hooks in a production build (unless ?testhooks is in the URL).
  expect(await host.page.evaluate(() => 'hexlands' in window || '__hexlands' in window)).toBe(false);

  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
});
