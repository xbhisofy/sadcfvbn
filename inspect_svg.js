import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    storageState: '/root/insta-bot/profiles/profile_6/state.json',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/reel/DaMg0ZMMV3b/', { waitUntil: 'commit', timeout: 35000 });
  await page.waitForTimeout(6000);
  const svgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('svg')).map(s => ({
      ariaLabel: s.getAttribute('aria-label'),
      role: s.getAttribute('role'),
      title: s.querySelector('title')?.textContent || null,
      parentRole: s.parentElement ? s.parentElement.getAttribute('role') : null,
      parentAria: s.parentElement ? s.parentElement.getAttribute('aria-label') : null,
      parentTag: s.parentElement ? s.parentElement.tagName : null
    })).filter(x => x.ariaLabel || x.parentAria || x.title);
  });
  console.log('SVGS WITH LABELS:');
  console.log(JSON.stringify(svgs, null, 2));
  await browser.close();
}

main().catch(console.error);
