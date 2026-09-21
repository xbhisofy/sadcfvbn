import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkProfile(name) {
  const statePath = path.join(__dirname, 'profiles', name, 'state.json');
  if (!fs.existsSync(statePath)) return { name, exists: false };

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const title = await page.title();
    const url = page.url();
    const isLoggedIn = !url.includes('/accounts/login') && (await page.locator('svg[aria-label="Home"], svg[aria-label="Direct"], a[href*="/direct/"]').count()) > 0;
    await page.screenshot({ path: path.join(__dirname, `public/check_${name}.png`) });
    await browser.close();
    return { name, url, title, isLoggedIn };
  } catch (e) {
    await browser.close();
    return { name, error: e.message };
  }
}

async function run() {
  console.log('Testing profile_2...');
  console.log('profile_2:', await checkProfile('profile_2'));
  console.log('Testing profile_5...');
  console.log('profile_5:', await checkProfile('profile_5'));
}

run();
