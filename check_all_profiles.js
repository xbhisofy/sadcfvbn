import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function check(name) {
  const statePath = path.join(__dirname, 'profiles', name, 'state.json');
  if (!fs.existsSync(statePath)) return { name, exists: false };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      storageState: statePath,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const url = page.url();
    const isLogin = !url.includes('/accounts/login') && (await page.locator('svg[aria-label="Home"], svg[aria-label="Direct"]').count()) > 0;
    let username = name;
    try {
      // Find profile link or username
      const profileLink = await page.locator('a[href^="/"]:has(img[alt*="profile picture"])').first().getAttribute('href');
      if (profileLink) username = profileLink.replace(/\//g, '');
    } catch (_) {}
    await browser.close();
    return { name, isLogin, username, url };
  } catch (e) {
    await browser.close();
    return { name, isLogin: false, error: e.message };
  }
}

async function run() {
  const profiles = ['profile_1', 'profile_2', 'profile_3', 'profile_4', 'profile_5'];
  for (const p of profiles) {
    const res = await check(p);
    console.log(p, '=>', res);
  }
}

run();
