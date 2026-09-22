import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { db } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isWorkerRunning = false;
let logCallback = null;

export function setLogCallback(cb) {
  logCallback = cb;
}

function workerLog(msg, type = 'info') {
  if (logCallback) logCallback(msg, type);
  else console.log(`[WORKER] [${type.toUpperCase()}] ${msg}`);
}

function getProxyForProfile(profileName, jobRunId) {
  const num = profileName.replace(/[^0-9]/g, '') || '1';
  const runTag = jobRunId || String(Date.now()).slice(-4);
  const cleanId = `p${num}_${runTag}`.slice(0, 10);
  return {
    server: 'http://as.rapidproxy.io:5001',
    username: `s4chizw-residential-IN-session-${cleanId}`,
    password: 's4chizwhy'
  };
}

function cleanInstagramUrl(url) {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) {
    return url.trim().split('?')[0];
  }
}

function extractInstagramUsername(input) {
  if (!input) return '';
  let str = input.trim();
  str = str.split('?')[0].split('#')[0];
  if (str.includes('instagram.com/')) {
    const after = str.split('instagram.com/')[1];
    const parts = after.split('/').filter(Boolean);
    return parts[0] || '';
  }
  return str.replace(/^@+/, '').replace(/^\/+|\/+$/g, '').split('/')[0].trim();
}

async function safeGoto(page, url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 35000 });
      return true;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      workerLog(`⚠️ Connection glitch (${e.message.split('\n')[0]}). Retrying...`, 'warning');
      await page.waitForTimeout(2500);
    }
  }
}

async function postCommentOnPage(page, commentText) {
  workerLog(`[+] Waiting 5s for page to render...`, 'info');
  await page.waitForTimeout(5000);

  if (page.url().includes('/accounts/login') || page.url().includes('/accounts/suspended')) {
    throw new Error('Instagram account session expired or logged out.');
  }

  // Dismiss popups / cookie banners
  try {
    const closeBtn = page.locator('svg[aria-label="Close"], button:has(svg[aria-label="Close"]), div[role="dialog"] button').first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click({ force: true });
      await page.waitForTimeout(500);
    }
  } catch (_) {}
  await page.keyboard.press('Escape');

  // Click visible comment icon on reel
  try {
    const clicked = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg[aria-label="Comment"], svg[aria-label="Comments"], svg[aria-label*="comment"i]'));
      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight) {
          const clickable = svg.closest('div[role="button"]') || svg.closest('button') || svg.parentElement || svg;
          clickable.click();
          return true;
        }
      }
      if (svgs.length > 0) {
        const clickable = svgs[0].closest('div[role="button"]') || svgs[0].parentElement || svgs[0];
        clickable.click();
        return true;
      }
      return false;
    });
    if (clicked) {
      workerLog(`[✓] Clicked visible comment icon!`, 'info');
      await page.waitForTimeout(2500);
    }
  } catch (_) {}

  let focused = false;
  const inputSelectors = [
    'input[placeholder*="comment"i]',
    'input[placeholder*="Add a comment"i]',
    'textarea[placeholder*="comment"i]',
    'textarea[aria-label*="comment"i]',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    'textarea'
  ];

  workerLog(`[+] Waiting for comment box to render...`, 'info');
  const startWait = Date.now();
  while (Date.now() - startWait < 15000 && !focused) {
    for (const sel of inputSelectors) {
      try {
        const inputEl = page.locator(sel).first();
        if (await inputEl.isVisible({ timeout: 1000 })) {
          await inputEl.click({ force: true });
          focused = true;
          workerLog(`[✓] Focused comment box using selector: ${sel}`, 'info');
          break;
        }
      } catch (_) {}
    }

    if (!focused) {
      try {
        await page.evaluate(() => {
          const svgs = Array.from(document.querySelectorAll('svg[aria-label="Comment"], svg[aria-label="Comments"], svg[aria-label*="comment"i]'));
          for (const svg of svgs) {
            const rect = svg.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight) {
              (svg.closest('div[role="button"]') || svg.closest('button') || svg.parentElement || svg).click();
              return;
            }
          }
        });
      } catch (_) {}
      await page.waitForTimeout(1000);
    }
  }

  if (!focused) {
    try {
      await page.screenshot({ path: path.join(__dirname, 'public', 'last_error.png') });
    } catch (_) {}
    throw new Error('Could not locate comment input. Ensure account is logged into Instagram and post allows comments.');
  }

  workerLog(`[+] Typing comment: "${commentText}"...`, 'info');
  await page.keyboard.type(commentText, { delay: 60 });
  await page.waitForTimeout(1500);

  // Try post button
  try {
    const postBtn = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post"), button[type="submit"]:has-text("Post")').last();
    if (await postBtn.isVisible({ timeout: 2500 })) {
      await postBtn.click({ force: true });
      workerLog(`[✓] Clicked Post button!`, 'success');
      await page.waitForTimeout(4000);
      return true;
    }
  } catch (_) {}

  await page.keyboard.press('Enter');
  workerLog(`[✓] Submitted comment via Enter key!`, 'success');
  await page.waitForTimeout(4000);
  return true;
}

async function followUserOnPage(page, targetUser) {
  workerLog(`[+] Waiting for profile page to render...`, 'info');
  try {
    await page.locator('header, main, section, [role="main"]').first().waitFor({ timeout: 15000 });
  } catch (_) {}
  await page.waitForTimeout(3000);

  if (page.url().includes('/accounts/login') || page.url().includes('/accounts/suspended')) {
    throw new Error('Instagram account session expired or logged out.');
  }

  try {
    const closeBtn = page.locator('svg[aria-label="Close"], button:has(svg[aria-label="Close"]), div[role="dialog"] button').first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click({ force: true });
    }
  } catch (_) {}
  await page.keyboard.press('Escape');

  // Check if already following
  try {
    const followingBtn = page.locator('button:has-text("Following"), div[role="button"]:has-text("Following"), button:has-text("Requested")').first();
    if (await followingBtn.isVisible({ timeout: 2000 })) {
      workerLog(`✅ Already following @${targetUser}!`, 'success');
      return true;
    }
  } catch (_) {}

  let clicked = false;
  const followSelectors = [
    'header button:has-text("Follow")',
    'button:has-text("Follow"):not(:has-text("Following"))',
    'div[role="button"]:has-text("Follow"):not(:has-text("Following"))'
  ];

  for (const sel of followSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click({ force: true });
        clicked = true;
        workerLog(`[✓] Clicked Follow button for @${targetUser}!`, 'success');
        break;
      }
    } catch (_) {}
  }

  if (!clicked) {
    try {
      await page.screenshot({ path: path.join(__dirname, 'public', 'last_error.png') });
    } catch (_) {}
    throw new Error(`Could not find Follow button for @${targetUser}. Check username.`);
  }

  await page.waitForTimeout(3000);
  return true;
}

// Execute a single action for an order using a chosen profile
async function executeOrderAction(order, account) {
  const jobRunId = Math.floor(1000 + Math.random() * 9000);
  const profileProxy = getProxyForProfile(account.profile_name, jobRunId);
  const userDataDir = path.resolve(__dirname, 'profiles', account.profile_name);
  const statePath = path.join(userDataDir, 'state.json');

  workerLog(`🚀 Order #${order.id} [${order.service_type.toUpperCase()}]: Assigning to ${account.profile_name} (${account.actions_today || 0}/25 today) [🛡️ Proxy: ${profileProxy.username}]`, 'info');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  try {
    const contextOpts = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      proxy: profileProxy,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
    };

    if (fs.existsSync(statePath)) {
      contextOpts.storageState = statePath;
    }

    const context = await browser.newContext(contextOpts);
    await context.route('**/*.{mp4,webm,avi}', route => route.abort());

    if (fs.existsSync(statePath)) {
      try {
        const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (stateData.cookies && Array.isArray(stateData.cookies)) {
          await context.addCookies(stateData.cookies);
        }
      } catch (_) {}
    }

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (order.service_type === 'comment') {
      const targetUrl = cleanInstagramUrl(order.target);
      workerLog(`🔗 [${account.profile_name}] Navigating to: ${targetUrl}`, 'info');
      await safeGoto(page, targetUrl, 3);

      let commentToSend = order.content || 'Awesome post 🔥';
      if (order.content && order.content.includes('\n')) {
        const lines = order.content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (lines.length > 0) {
          commentToSend = lines[order.completed_count % lines.length] || lines[0];
        }
      }

      await postCommentOnPage(page, commentToSend);
      workerLog(`✅ [${account.profile_name}] Comment delivered for Order #${order.id}!`, 'success');
    } else {
      const cleanUser = extractInstagramUsername(order.target);
      if (!cleanUser) {
        throw new Error(`Invalid Instagram username or profile link: ${order.target}`);
      }
      const profileUrl = `https://www.instagram.com/${cleanUser}/`;
      workerLog(`🔗 [${account.profile_name}] Navigating to: ${profileUrl}`, 'info');
      await safeGoto(page, profileUrl, 3);
      await followUserOnPage(page, cleanUser);
      workerLog(`✅ [${account.profile_name}] Follow delivered for Order #${order.id}!`, 'success');
    }

    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    return { success: true };
  } catch (err) {
    await browser.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

// Master Autonomous Queue Dispatcher Loop
export async function startQueueWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  workerLog('⚡ Enterprise Queue Dispatcher Worker initialized and running!', 'success');

  while (isWorkerRunning) {
    try {
      const order = db.getNextPendingOrder();
      if (!order) {
        // No pending tasks in queue, sleep lightly
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      // Check if order is already completed
      if (order.completed_count >= order.quantity) {
        db.updateOrder(order.id, { status: 'completed' });
        continue;
      }

      // Multi-Cycle Round-Robin Rotation for Orders with Quantity > Account Count
      const activePool = Object.values(db.data.accounts)
        .filter(a => a.is_active && a.status !== 'offline' && a.status !== 'error' && a.status !== 'suspended')
        .map(a => a.profile_name);
      
      const poolSize = activePool.length || 1;
      
      // Calculate which accounts have already acted in the current round/cycle
      const completedInCurrentCycle = order.completed_count % poolSize;
      const cycleStartIndex = order.completed_count - completedInCurrentCycle;
      const excludedInCurrentCycle = (order.assigned_accounts || []).slice(cycleStartIndex);
      const failedAccounts = order.failed_accounts || [];
      const totalExcluded = [...new Set([...excludedInCurrentCycle, ...failedAccounts])];

      let account = db.getEligibleAccount(totalExcluded);

      // If all accounts have acted in this cycle, or accounts are in cooldown, try any eligible non-failed account
      if (!account) {
        const anyAccount = db.getEligibleAccount(failedAccounts);
        if (!anyAccount) {
          workerLog(`⏳ Order #${order.id} (${order.completed_count}/${order.quantity}): All healthy accounts are resting in cooldown. Waiting 15s...`, 'info');
          await new Promise(r => setTimeout(r, 15000));
          continue;
        } else {
          account = anyAccount;
        }
      }

      // Mark order in progress
      db.updateOrder(order.id, { status: 'in_progress' });

      // Execute action
      const result = await executeOrderAction(order, account);

      if (result.success) {
        db.recordAccountAction(account.profile_name, true);
        const newCompleted = order.completed_count + 1;
        const newAssigned = [...(order.assigned_accounts || []), account.profile_name];
        const isDone = newCompleted >= order.quantity;

        db.updateOrder(order.id, {
          completed_count: newCompleted,
          assigned_accounts: newAssigned,
          status: isDone ? 'completed' : 'in_progress',
          error: null
        });

        if (isDone) {
          workerLog(`🎉 Order #${order.id} [${order.service_type}] fully completed (${newCompleted}/${order.quantity})!`, 'success');
        } else {
          // Safe human-like interval between comments (20 to 35 seconds)
          const safeDelayMs = Math.floor(20000 + Math.random() * 15000);
          workerLog(`⏳ [Safety Engine] Delivered (${newCompleted}/${order.quantity}). Waiting ${Math.round(safeDelayMs / 1000)}s safe interval before next account...`, 'info');
          await new Promise(r => setTimeout(r, safeDelayMs));
        }
      } else {
        workerLog(`⚠️ Action failed on ${account.profile_name} for Order #${order.id}: ${result.error}`, 'warning');
        db.recordAccountAction(account.profile_name, false);

        const errorMsg = (result.error || '').toLowerCase();
        const isAccountDead = 
          errorMsg.includes('session expired') || 
          errorMsg.includes('logged out') ||
          errorMsg.includes('suspended') ||
          errorMsg.includes('challenge') ||
          errorMsg.includes('checkpoint') ||
          errorMsg.includes('compromised') ||
          errorMsg.includes('disabled');

        if (isAccountDead) {
          db.markAccountError(account.profile_name, result.error);
          workerLog(`🛡️ [Auto-Filter] Account ${account.profile_name} marked as suspended (${result.error}). Isolated from pool!`, 'warning');
        }

        // Exclude this bad account from this order so we don't loop on it
        const failedAccs = [...new Set([...(order.failed_accounts || []), account.profile_name])];

        // Check if there are other healthy accounts available in pool
        const remainingHealthyAccounts = Object.values(db.data.accounts).filter(a => 
          a.is_active && 
          a.status !== 'offline' && 
          a.status !== 'error' && 
          a.status !== 'suspended' && 
          !failedAccs.includes(a.profile_name)
        );

        if (isAccountDead && remainingHealthyAccounts.length > 0) {
          // Instantly switch to next healthy account without burning order retries!
          workerLog(`🔄 [Auto-Switch] Order #${order.id}: Bypassing dead ${account.profile_name} -> Switching to remaining ${remainingHealthyAccounts.length} healthy accounts!`, 'info');
          db.updateOrder(order.id, {
            failed_accounts: failedAccs,
            error: `Auto-switched from ${account.profile_name} (${result.error})`
          });
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        // Check if retry is feasible
        const retries = (order.retries || 0) + 1;
        if (retries > 5 || (isAccountDead && remainingHealthyAccounts.length === 0)) {
          db.updateOrder(order.id, {
            status: order.completed_count > 0 ? 'partial' : 'failed',
            error: remainingHealthyAccounts.length === 0 && isAccountDead 
              ? `All available accounts suspended or exhausted: ${result.error}` 
              : result.error,
            retries,
            failed_accounts: failedAccs
          });
          workerLog(`❌ Order #${order.id} stopped after ${retries} attempts: ${result.error}`, 'error');
        } else {
          db.updateOrder(order.id, { retries, error: result.error, failed_accounts: failedAccs });
          // Wait 5s before next attempt
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    } catch (err) {
      workerLog(`Worker loop exception: ${err.message}`, 'error');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
