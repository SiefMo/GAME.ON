import { test, expect } from '@playwright/test';

const unique = () => `qa_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

async function register(page: any, username: string, password: string) {
  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByLabel(/confirm password/i).fill(password);
  await page.getByRole('button', { name: /register|create account|sign up/i }).click();
}

test('user can register and reach the authenticated area', async ({ page }) => {
  const username = unique();
  await register(page, username, 'TestPassword_123!');
  await expect(page).not.toHaveURL(/register/);
  await expect(page.getByText(username)).toBeVisible();
});

test('invalid login is rejected', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill('definitely_missing_user');
  await page.getByLabel(/^password$/i).fill('wrong-password');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await expect(page.getByText(/invalid|wrong|failed|incorrect/i)).toBeVisible();
});
