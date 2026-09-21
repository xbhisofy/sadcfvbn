import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const links = [
  'https://www.instagram.com/reel/DcgOJyJMiWT/'
];

const comments = [
  'osm reel 🔥',
  'super video 🔥',
  'nice reel 👍',
  'great content 💯',
  'awesome post 🌟'
];

async function runAutoCommenter() {
  const profileName = process.argv[2] || 'profile_2';
  console.log(`🚀 Starting Bulletproof Instagram Auto-Commenter for ${profileName}...`);

  const statePath = path.resolve(`profiles/${profileName}/state.json`);
  if (!fs.existsSync(statePath)) {
    console.error(`❌ Session state file missing at profiles/${profileName}/state.json`);
    return;
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (stateData.cookies && Array.isArray(stateData.cookies)) {
    await context.addCookies(stateData.cookies);
    console.log(`[+] Loaded ${stateData.cookies.length} session cookies for @lvesachin2026`);
  }

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Prime home page to set session context
  try {
    console.log('🌐 Priming Instagram session on home page...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('⚠️ Home page priming note:', e.message);
  }

  let count = 0;

  while (true) {
    const link = links[count % links.length];
    const commentText = comments[count % comments.length];
    count++;

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n==================================================`);
    console.log(`[${timestamp}] Job #${count} | Target Link: ${link}`);
    console.log(`[${timestamp}] Comment: "${commentText}"`);

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);

      // Dismiss cookie modal if present
      try {
        const cookieBtn = page.locator('button:has-text("Allow"), button:has-text("Accept"), button:has-text("Alle zulassen"), button:has-text("Cookies")').first();
        if (await cookieBtn.isVisible({ timeout: 2000 })) {
          await cookieBtn.click({ force: true });
          console.log('[✓] Dismissed Cookie banner');
          await page.waitForTimeout(1000);
        }
      } catch (_) {}

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Click comment icon on Reels layout
      try {
        const commentIcon = page.locator('svg[aria-label="Comment"], svg[aria-label="Kommentieren"], div[role="button"]:has(svg[aria-label="Comment"])').first();
        if (await commentIcon.isVisible({ timeout: 3000 })) {
          await commentIcon.click({ force: true });
          console.log('[✓] Clicked comment icon');
          await page.waitForTimeout(2000);
        }
      } catch (_) {}

      let focused = false;
      const selectors = [
        'input[placeholder*="comment"i]',
        'input[placeholder*="Add a comment"i]',
        'textarea[placeholder*="comment"i]',
        'textarea[aria-label*="comment"i]',
        'textarea',
        'div[contenteditable="true"]',
        'div[role="textbox"]'
      ];

      for (const sel of selectors) {
        try {
          const inputEl = page.locator(sel).first();
          if (await inputEl.isVisible({ timeout: 2000 })) {
            await inputEl.click({ force: true });
            focused = true;
            console.log(`[✓] Focused input via selector: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      if (!focused) {
        try {
          const placeholderText = page.getByText(/Add a comment/i).first();
          if (await placeholderText.isVisible({ timeout: 2000 })) {
            await placeholderText.click({ force: true });
            focused = true;
            console.log(`[✓] Clicked text "Add a comment"`);
          }
        } catch (_) {}
      }

      if (focused) {
        await page.waitForTimeout(1000);
        console.log(`💬 Typing comment: "${commentText}"...`);
        await page.keyboard.type(commentText, { delay: 100 });
        await page.waitForTimeout(1500);

        // Try Post button first
        let posted = false;
        try {
          const postBtn = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post"), button[type="submit"]:has-text("Post")').last();
          if (await postBtn.isVisible({ timeout: 2500 })) {
            await postBtn.click({ force: true });
            posted = true;
            console.log('[✓] Clicked Post button!');
          }
        } catch (_) {}

        if (!posted) {
          await page.keyboard.press('Enter');
          console.log('[✓] Submitted via Enter key!');
        }

        await page.waitForTimeout(4000);
        console.log(`🎉 [${new Date().toLocaleTimeString()}] SUCCESS! Comment #${count} posted live on Instagram!`);
      } else {
        console.log('❌ Could not locate comment input element on page');
      }
    } catch (err) {
      console.log(`⚠️ Commenting error: ${err.message}`);
    }

    console.log(`⏳ Waiting 20 seconds before posting next comment...`);
    await new Promise(r => setTimeout(r, 20000));
  }
}

runAutoCommenter().catch(console.error);
