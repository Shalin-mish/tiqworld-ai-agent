import { test, expect } from '@playwright/test';

// Each test gets a fresh browser context — no localStorage bleed between tests.
test.use({ storageState: { cookies: [], origins: [] } });

// ── Helpers ──────────────────────────────────────────────────────────────────
async function completeIdentity(page, name = 'TestUser') {
  await page.goto('/');
  const overlay = page.locator('#id-overlay');
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await page.fill('#id-input', name);
  await page.click('#id-submit');
  await expect(overlay).toBeHidden({ timeout: 3000 });
}

// ── Page load ────────────────────────────────────────────────────────────────
test.describe('Page load', () => {
  test('loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AI Agent/);
  });

  test('shows identity modal on first visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#id-overlay')).toBeVisible();
  });

  test('identity modal has English text only', async ({ page }) => {
    await page.goto('/');
    const modalText = await page.locator('#id-box').innerText();
    // Must not contain Hindi/Urdu characters or known Hindi phrases
    expect(modalText).not.toMatch(/kaun|naam|daalo|tum\?/i);
    expect(modalText).toContain('Who are you');
  });

  test('header renders logo and badges', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo')).toContainText('Agent'); // dynamic logo: "CodebaseAI Agent"
    await expect(page.locator('#tool-count-badge')).toBeVisible();
  });
});

// ── Identity flow ─────────────────────────────────────────────────────────────
test.describe('Identity modal', () => {
  test('dismisses on name submit', async ({ page }) => {
    await page.goto('/');
    await page.fill('#id-input', 'Shalini');
    await page.click('#id-submit');
    await expect(page.locator('#id-overlay')).toBeHidden();
  });

  test('dismisses on Enter key', async ({ page }) => {
    await page.goto('/');
    await page.fill('#id-input', 'Shalini');
    await page.press('#id-input', 'Enter');
    await expect(page.locator('#id-overlay')).toBeHidden();
  });

  test('does not dismiss with empty name', async ({ page }) => {
    await page.goto('/');
    await page.click('#id-submit');
    await expect(page.locator('#id-overlay')).toBeVisible();
  });

  test('shows user label in header after login', async ({ page }) => {
    await page.goto('/');
    await page.fill('#id-input', 'Shalini');
    await page.click('#id-submit');
    await expect(page.locator('#user-label')).toContainText('Shalini');
  });
});

// ── API status ────────────────────────────────────────────────────────────────
test.describe('API health', () => {
  test('/api/status returns ok:true', async ({ request }) => {
    const res = await request.get('/api/status');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tool_count).toBeGreaterThan(0);
  });

  test('/api/me returns authMode', async ({ request }) => {
    const res  = await request.get('http://localhost:3001/api/me');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('authMode');
  });

  test('/api/activity returns entries array', async ({ request }) => {
    const res  = await request.get('/api/activity');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

// ── Layout ────────────────────────────────────────────────────────────────────
test.describe('3-column layout', () => {
  test.beforeEach(async ({ page }) => {
    await completeIdentity(page);
  });

  test('sidebar is visible', async ({ page }) => {
    await expect(page.locator('#sidebar')).toBeVisible();
  });

  test('context panel is visible', async ({ page }) => {
    // Panel starts collapsed by default; toggle it open then verify
    await page.click('#right-panel-toggle');
    await expect(page.locator('#ctx-panel')).not.toHaveClass(/collapsed/);
  });

  test('sidebar can be collapsed', async ({ page }) => {
    await page.click('#left-panel-toggle');
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  });

  test('tool items are clickable and populate input', async ({ page }) => {
    // Ensure sidebar is expanded before clicking
    const sidebar = page.locator('#sidebar');
    if (await sidebar.evaluate(el => el.classList.contains('collapsed'))) {
      await page.click('#left-panel-toggle');
      await expect(sidebar).not.toHaveClass(/collapsed/);
    }
    const first = page.locator('.tool-item').first();
    await expect(first).toBeVisible();
    const q = await first.getAttribute('data-q');
    await first.click();
    await expect(page.locator('#input')).toHaveValue(q ?? '');
  });

  test('quick-start chips populate input', async ({ page }) => {
    const chip = page.locator('.qa-chip').first();
    await expect(chip).toBeVisible();
    const q = await chip.getAttribute('data-q');
    await chip.click();
    await expect(page.locator('#input')).toHaveValue(q ?? '');
  });
});

// ── Brand colors ──────────────────────────────────────────────────────────────
test.describe('Brand colors', () => {
  test('uses TIQ World background color #0d1219', async ({ page }) => {
    await page.goto('/');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    expect(bg).toBe('#0d1219');
  });

  test('uses TIQ World orange accent #f09247', async ({ page }) => {
    await page.goto('/');
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('#f09247');
  });

  test('uses TIQ World teal #20c9c9', async ({ page }) => {
    await page.goto('/');
    const teal = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--teal').trim());
    expect(teal).toBe('#20c9c9');
  });
});

// ── Chat input ────────────────────────────────────────────────────────────────
test.describe('Chat input', () => {
  test.beforeEach(async ({ page }) => {
    await completeIdentity(page);
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await expect(page.locator('#send-btn')).toBeDisabled();
  });

  test('send button enables when text is typed', async ({ page }) => {
    await page.fill('#input', 'hello');
    await expect(page.locator('#send-btn')).toBeEnabled();
  });

  test('Ctrl+/ focuses the input', async ({ page }) => {
    await page.keyboard.press('Control+/');
    await expect(page.locator('#input')).toBeFocused();
  });
});

// ── Session memory ────────────────────────────────────────────────────────────
test.describe('/api/session/:id/memory', () => {
  test('returns ok:false for unknown session', async ({ request }) => {
    const res  = await request.get('/api/session/no-such-session-xyz/memory');
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('returns session data after identify', async ({ page, request }) => {
    await page.goto('/');
    const sid = await page.evaluate(() => window.SESSION_ID);
    await page.fill('#id-input', 'E2EUser');
    await page.click('#id-submit');
    // Wait for identify call to complete
    await page.waitForTimeout(300);
    const res  = await request.get(`/api/session/${sid}/memory`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toBe('E2EUser');
    expect(body.summary).toHaveProperty('tool_calls');
  });

  test('window.SESSION_ID is defined on page', async ({ page }) => {
    await page.goto('/');
    const sid = await page.evaluate(() => window.SESSION_ID);
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
  });
});

// ── Admin panel ───────────────────────────────────────────────────────────────
test.describe('Admin panel', () => {
  test('/admin redirects to main page with admin tab', async ({ page }) => {
    await page.goto('/admin');
    // Redirects to /?tab=admin — title is the main app title (dynamic: "<project> · AI Agent")
    await expect(page).toHaveTitle(/AI Agent/);
    await expect(page).toHaveURL(/tab=admin/);
  });

  test('admin tab panel is visible after redirect', async ({ page }) => {
    await page.goto('/?tab=admin');
    await expect(page.locator('#tab-admin')).toBeVisible();
  });

  test('admin tab has activity log section', async ({ page }) => {
    await page.goto('/?tab=admin');
    await expect(page.locator('#tab-admin')).toContainText('Activity');
  });
});
