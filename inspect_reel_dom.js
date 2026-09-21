import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectReel() {
  const statePath = path.join(__dirname, 'profiles', 'profile_5', 'state.json');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    storageState: statePath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  const url = 'https://www.instagram.com/reel/DbUcoVPNN2_/?utm_source=ig_web_copy_link&stkn=MzRIC';
  console.log('Visiting URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);

  // Click comment icon
  try {
    const commentIcon = page.locator('svg[aria-label="Comment"], svg[aria-label="Kommentieren"], div[role="button"]:has(svg[aria-label="Comment"])').first();
    if (await commentIcon.isVisible({ timeout: 3000 })) {
      await commentIcon.click({ force: true });
      console.log('Clicked comment icon');
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    console.log('Error clicking comment icon:', e.message);
  }

  // Dump all text in dialog or page
  const text = await page.evaluate(() => {
    return {
      bodyText: document.body.innerText.substring(0, 2000),
      inputs: Array.from(document.querySelectorAll('input, textarea, [contenteditable], form')).map(el => ({
        tag: el.tagName,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        type: el.type,
        className: el.className
      }))
    };
  });

  console.log('INPUTS FOUND:\n', JSON.stringify(text.inputs, null, 2));
  console.log('\nBODY TEXT SAMPLE:\n', text.bodyText);

  await page.screenshot({ path: path.join(__dirname, 'public', 'inspect_reel.png') });
  await browser.close();
}

inspectReel().catch(console.error);
