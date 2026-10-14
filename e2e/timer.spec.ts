/** Turn timer: when it runs out, the host moves the game on for the idle player. */
import { expect, test } from '@playwright/test';
import { copyInviteLink, createRoom, hostGame, joinViaLink, newPlayer, closePlayers } from './helpers';

test.afterEach(closePlayers);

test('an idle player is moved on when the timer runs out', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  // Control the host's clock so we don't have to wait a real minute.
  await host.page.clock.install();
  await createRoom(host);
  await joinViaLink(guest, await copyInviteLink(host));
  await host.page.locator('.setting-row', { hasText: 'Turn timer' }).locator('select').selectOption('60');
  await guest.page.getByRole('button', { name: "I'm ready" }).click();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.page.locator('.g-root')).toBeVisible();

  const g0 = await hostGame(host);
  expect(g0.phase).toBe('setup');
  const first = g0.prompts[0].player;
  // Nobody touches anything for a minute: the first player's settlement + road get placed.
  await host.page.clock.runFor(61_000);
  await expect.poll(async () => (await hostGame(host)).pieces.filter((p) => p.owner === first).length).toBe(2);
  const g1 = await hostGame(host);
  expect(g1.prompts[0].player).not.toBe(first);
  // The chat explains what happened.
  await guest.page.getByRole('tab', { name: 'Chat' }).click();
  await expect(guest.page.locator('.g-logchat')).toContainText("Time's up");
  expect(host.errors).toEqual([]);
});
