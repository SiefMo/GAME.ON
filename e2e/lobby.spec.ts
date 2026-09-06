import { test, expect } from '@playwright/test';

const unique = () => `room_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

test('authenticated user can open rooms/lobby', async ({ page }) => {
  const username = unique();
  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/^password$/i).fill('TestPassword_123!');
  await page.getByLabel(/confirm password/i).fill('TestPassword_123!');
  await page.getByRole('button', { name: /register|create account|sign up/i }).click();
  await page.goto('/rooms');
  await expect(page.getByText(/rooms|lobby|create room/i).first()).toBeVisible();
});
