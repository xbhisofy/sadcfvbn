import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testComment() {
  const statePath = path.join(__dirname, 'profiles', 'profile_5', 'state.json');
  console.log('Testing comment on Reel with profile_5...');

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
  try {
    const link = 'https://www.instagram.com/reel/Dblz9YlRZW1/?stkn=dGZrZjU3eng0dm5i';
    console.log('Navigating to:', link);
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    // Close any popup/modal
    try {
      const closeBtn = page.locator('svg[aria-label="Close"], button:has(svg[aria-label="Close"]), div[role="dialog"] button').first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click({ force: true });
        console.log('Closed modal dialog');
        await page.waitForTimeout(1000);
      }
    } catch (_) {}
    await page.keyboard.press('Escape');

    // Click comment icon
    try {
      const commentIcon = page.locator('svg[aria-label="Comment"], svg[aria-label="Kommentieren"], div[role="button"]:has(svg[aria-label="Comment"])').first();
      if (await commentIcon.isVisible({ timeout: 3000 })) {
        await commentIcon.click({ force: true });
        console.log('Clicked comment icon');
        await page.waitForTimeout(2000);
      }
    } catch (_) {}

    // Find comment input
    const inputSelectors = [
      'input[placeholder*="comment"i]',
      'input[placeholder*="Add a comment"i]',
      'textarea[placeholder*="comment"i]',
      'textarea[aria-label*="comment"i]',
      'textarea',
      'div[contenteditable="true"]',
      'div[role="textbox"]'
    ];

    let focused = false;
    for (const sel of inputSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click({ force: true });
          focused = true;
          console.log('Focused input with selector:', sel);
          break;
        }
      } catch (_) {}
    }

    if (!focused) {
      const pText = page.getByText(/Add a comment/i).first();
      if (await pText.isVisible({ timeout: 2000 })) {
        await pText.click({ force: true });
        focused = true;
        console.log('Clicked Add a comment text');
      }
    }

    if (!focused) {
      await page.screenshot({ path: path.join(__dirname, 'public', 'test_p5_failed.png') });
      throw new Error('Could not find comment input for profile_5');
    }

    console.log('Typing comment: "top"...');
    await page.keyboard.type('top', { delay: 100 });
    await page.waitForTimeout(1500);

    let posted = false;
    try {
      const postBtn = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post")').last();
      if (await postBtn.isVisible({ timeout: 2500 })) {
        await postBtn.click({ force: true });
        posted = true;
        console.log('Clicked Post button!');
      }
    } catch (_) {}

    if (!posted) {
      await page.keyboard.press('Enter');
      console.log('Pressed Enter to post');
    }

    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(__dirname, 'public', 'test_p5_success.png') });
    console.log('🎉 COMMENT POSTED SUCCESSFULLY!');
  } catch (e) {
    console.error('Test error:', e.message);
  } finally {
    await browser.close();
  }
}

testComment();
