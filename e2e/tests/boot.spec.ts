import { expect, test } from '@playwright/test';
import { APP_NAME } from '@shipfair/shared';

test('home page shows the app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(APP_NAME);
  await expect(page).toHaveTitle(APP_NAME);
});
