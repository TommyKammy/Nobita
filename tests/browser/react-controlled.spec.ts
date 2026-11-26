import { expect, test } from '@playwright/test';
import type { CollaborationAdapter } from '../../packages/core/src';
type NavigationFixture = Window & {
  navigate(shared: boolean): void;
  oldAdapter: CollaborationAdapter;
  newAdapter: CollaborationAdapter | null;
};

test('a controlled React edit survives prop feedback with one undo entry', async ({
  page,
}) => {
  await page.goto('/react-controlled.html');
  const text = page.locator('[data-block-id="controlled"] .nb-text');
  await text.click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await expect(text).toHaveText('AlphaX');
  await page.keyboard.press('Control+z');
  await expect(text).toHaveText('Alpha');
  expect(
    await page.evaluate(
      () => (window as Window & { sources: string[] }).sources
    )
  ).not.toContain('replace');
});

for (const shared of [false, true]) {
  test(
    'React navigates and ' +
      (shared ? 'replaces' : 'disconnects') +
      ' the adapter in one render',
    async ({ page }) => {
      await page.goto('/react-controlled.html?navigate');
      const text = page.locator('.nb-text');
      await expect(text).toHaveText('First');
      await page.evaluate(async (shared) => {
        const host = document.querySelector('nobita-editor')!;
        await host.editor!.collaborationReady;
        (window as NavigationFixture).navigate(shared);
      }, shared);
      await expect(text).toHaveText('Second');
      await page.evaluate(
        () =>
          document.querySelector('nobita-editor')!.editor!.collaborationReady
      );
      await text.click();
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await expect(text).toHaveText('Second!');
      expect(
        await page.evaluate(() => [
          (window as NavigationFixture).oldAdapter.getDoc().blocks[0].text[0]
            .text,
          (window as NavigationFixture).newAdapter?.getDoc().blocks[0].text[0]
            .text ?? null,
        ])
      ).toEqual(['First', shared ? 'Second!' : null]);
    }
  );
}
