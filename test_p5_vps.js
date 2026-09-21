import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testP5() {
  const pPath = path.join(__dirname, 'profiles', 'profile_5', 'state.json');
  console.log('Exists:', fs.existsSync(pPath));
  const data = JSON.parse(fs.readFileSync(pPath, 'utf8'));
  console.log('Cookie names:', data.cookies.map(c => c.name));

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    storageState: pPath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  const isLoggedIn = (await page.locator('svg[aria-label="Home"], svg[aria-label="Direct"]').count()) > 0;
  console.log('IsLoggedIn:', isLoggedIn);
  await browser.close();
}

testP5().catch(console.error);
