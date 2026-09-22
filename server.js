import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let currentJob = {
  id: null,
  status: 'idle',
  totalTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  logs: [],
  startTime: null,
  stopRequested: false
};

function getProxyForProfile(profileName, jobRunId) {
  // Rapidproxy session ID must be between 4 and 12 chars
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

async function safeGoto(page, url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 35000 });
      return true;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      addLog(`⚠️ Connection glitch (${e.message.split('\n')[0]}). Retrying...`, 'warning');
      await page.waitForTimeout(2000);
    }
  }
}

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { timestamp, message, type };
  currentJob.logs.unshift(logEntry);
  if (currentJob.logs.length > 500) currentJob.logs.pop();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
}

app.post('/api/restart', (req, res) => {
  res.json({ success: true, message: 'Restarting server...' });
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

function getProfiles() {
  const profilesDir = path.resolve(__dirname, 'profiles');
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }

  const dirs = fs.readdirSync(profilesDir).filter(file => {
    if (!file || !/^profile_\d+$/.test(file)) return false;
    try {
      return fs.statSync(path.join(profilesDir, file)).isDirectory();
    } catch (_) {
      return false;
    }
  });

  return dirs.map(name => {
    const pPath = path.join(profilesDir, name);
    const infoPath = path.join(pPath, 'account.json');
    const statePath = path.join(pPath, 'state.json');
    let username = name;
    let isLoggedIn = fs.existsSync(statePath) || fs.existsSync(infoPath);
    if (fs.existsSync(infoPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (data.username) username = data.username;
        if (typeof data.isLoggedIn === 'boolean') isLoggedIn = data.isLoggedIn;
      } catch (_) {}
    }
    return { name, username, isLoggedIn };
  });
}

function parseCookieHeader(cookieStr) {
  const cookies = [];
  const parts = cookieStr.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const name = part.substring(0, idx).trim();
      const value = part.substring(idx + 1).trim();
      if (name && value) {
        cookies.push({
          name,
          value,
          domain: '.instagram.com',
          path: '/',
          expires: Date.now() / 1000 + 31536000,
          httpOnly: name === 'sessionid',
          secure: true,
          sameSite: 'None'
        });
      }
    }
  }
  return cookies;
}

app.post('/api/save-session-cookie', (req, res) => {
  const { profileName, sessionId, username } = req.body;
  if (!profileName || !sessionId) {
    return res.status(400).json({ error: 'Profile name and Session ID required' });
  }

  const userDataDir = path.resolve(__dirname, 'profiles', profileName.trim());
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  let cookies = [];
  const rawInput = sessionId.trim();

  if (rawInput.includes('=')) {
    cookies = parseCookieHeader(rawInput);
  } else {
    cookies = [
      {
        name: 'sessionid',
        value: rawInput.replace(/^sessionid=/i, ''),
        domain: '.instagram.com',
        path: '/',
        expires: Date.now() / 1000 + 31536000,
        httpOnly: true,
        secure: true,
        sameSite: 'None'
      }
    ];
  }

  const stateData = { cookies, origins: [] };
  const statePath = path.join(userDataDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));

  const uName = username ? username.trim() : profileName;
  fs.writeFileSync(path.join(userDataDir, 'account.json'), JSON.stringify({ username: uName, loggedInAt: new Date().toISOString() }));

  addLog(`✅ Saved ${cookies.length} cookies for ${profileName} (@${uName})!`, 'success');
  res.json({ success: true, cookiesCount: cookies.length });
});

app.post('/api/upload-tar', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  try {
    const tarPath = path.resolve(__dirname, 'update.tar.gz');
    fs.writeFileSync(tarPath, req.body);
    addLog(`📦 Received archive (${req.body.length} bytes). Extracting update...`, 'info');
    execSync(`tar -xzf ${tarPath} -C ${__dirname}`);
    addLog(`✅ Successfully extracted update on VPS! Restarting process...`, 'success');
    res.json({ success: true, message: 'Extracted successfully' });
    setTimeout(() => {
      process.kill(process.pid, 'SIGKILL');
    }, 300);
  } catch (err) {
    addLog(`❌ Tar extract failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/free-comment', async (req, res) => {
  const { link, comment, quantity } = req.body;
  if (!link || !comment) {
    return res.status(400).json({ error: 'Post link and custom comment are required' });
  }

  const allProfiles = getProfiles();
  // Filter for all active logged-in accounts (exclude old inactive test profiles)
  let candidateProfiles = allProfiles.filter(p => p.isLoggedIn && !['profile_1', 'profile_2', 'profile_3'].includes(p.name));
  if (candidateProfiles.length === 0) {
    candidateProfiles = allProfiles.filter(p => p.isLoggedIn);
  }
  if (candidateProfiles.length === 0) {
    return res.status(400).json({ error: 'No active accounts available right now. Please connect an account.' });
  }

  // Sort candidate profiles numerically so it starts from earliest active accounts (e.g. profile_5, profile_6...)
  candidateProfiles.sort((a, b) => {
    const numA = parseInt(a.name.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.name.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  const requestedQty = Math.max(1, parseInt(quantity, 10) || 1);
  // Pick starting active accounts up to requested quantity
  const selectedProfiles = candidateProfiles.slice(0, requestedQty).map(p => p.name);

  if (currentJob.status === 'running') {
    return res.json({ success: true, message: 'Another task is currently running! Order queued.' });
  }

  currentJob = {
    id: Date.now().toString(),
    status: 'running',
    totalTasks: selectedProfiles.length,
    requestedQty: requestedQty,
    completedTasks: 0,
    failedTasks: 0,
    logs: [],
    startTime: new Date().toISOString(),
    stopRequested: false
  };

  const statusNote = selectedProfiles.length < requestedQty
    ? `Starting ${selectedProfiles.length} comments (only ${selectedProfiles.length} active accounts connected right now)`
    : `Starting ${selectedProfiles.length} comments across ${selectedProfiles.length} accounts`;

  res.json({
    success: true,
    message: statusNote,
    availableAccounts: candidateProfiles.length,
    executingAccounts: selectedProfiles.length,
    requestedQty: requestedQty
  });

  runAutomationTask([link.trim()], [comment.trim()], selectedProfiles, 10);
});

app.post('/api/free-follower', async (req, res) => {
  const { username, quantity } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Instagram username or profile link is required' });
  }

  const allProfiles = getProfiles();
  let candidateProfiles = allProfiles.filter(p => p.isLoggedIn && !['profile_1', 'profile_2', 'profile_3'].includes(p.name));
  if (candidateProfiles.length === 0) {
    candidateProfiles = allProfiles.filter(p => p.isLoggedIn);
  }
  if (candidateProfiles.length === 0) {
    return res.status(400).json({ error: 'No active accounts available right now. Please connect an account.' });
  }

  // Sort candidate profiles numerically so it starts from earliest active accounts
  candidateProfiles.sort((a, b) => {
    const numA = parseInt(a.name.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.name.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  const requestedQty = Math.max(1, parseInt(quantity, 10) || 1);
  // Pick starting active accounts up to requested quantity
  const selectedProfiles = candidateProfiles.slice(0, requestedQty).map(p => p.name);

  if (currentJob.status === 'running') {
    return res.json({ success: true, message: 'Another task is currently running! Order queued.' });
  }

  currentJob = {
    id: Date.now().toString(),
    status: 'running',
    totalTasks: selectedProfiles.length,
    requestedQty: requestedQty,
    completedTasks: 0,
    failedTasks: 0,
    logs: [],
    startTime: new Date().toISOString(),
    stopRequested: false
  };

  const statusNote = selectedProfiles.length < requestedQty
    ? `Starting ${selectedProfiles.length} followers (only ${selectedProfiles.length} active accounts connected right now)`
    : `Starting ${selectedProfiles.length} followers across ${selectedProfiles.length} accounts`;

  res.json({
    success: true,
    message: statusNote,
    availableAccounts: candidateProfiles.length,
    executingAccounts: selectedProfiles.length,
    requestedQty: requestedQty
  });

  runFollowAutomationTask(username.trim(), selectedProfiles);
});

async function followUserOnPage(page, targetUser) {
  addLog(`[+] Waiting for profile page to render...`, 'info');
  try {
    await page.locator('header, main, section, [role="main"]').first().waitFor({ timeout: 15000 });
  } catch (_) {}
  await page.waitForTimeout(3000);

  if (page.url().includes('/accounts/login') || page.url().includes('/accounts/suspended')) {
    throw new Error('Instagram account session expired or logged out. Please update account session in Admin.');
  }

  // Dismiss any popups or modals
  try {
    const closeBtn = page.locator('svg[aria-label="Close"], button:has(svg[aria-label="Close"]), div[role="dialog"] button').first();
    if (await closeBtn.isVisible({ timeout: 2500 })) {
      await closeBtn.click({ force: true });
      addLog(`[✓] Dismissed popup dialog`, 'info');
      await page.waitForTimeout(1000);
    }
  } catch (_) {}
  await page.keyboard.press('Escape');

  // Check if already following
  try {
    const followingBtn = page.locator('button:has-text("Following"), div[role="button"]:has-text("Following"), button:has-text("Requested")').first();
    if (await followingBtn.isVisible({ timeout: 2000 })) {
      addLog(`✅ Already following @${targetUser}!`, 'success');
      return true;
    }
  } catch (_) {}

  // Look for Follow button
  let clicked = false;
  const followSelectors = [
    'header button:has-text("Follow")',
    'button:has-text("Follow"):not(:has-text("Following"))',
    'div[role="button"]:has-text("Follow"):not(:has-text("Following"))',
    'button:has-text("Folgen")',
    'button:has-text("Seguir")'
  ];

  for (const sel of followSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click({ force: true });
        clicked = true;
        addLog(`[✓] Clicked Follow button for @${targetUser}!`, 'success');
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

async function postCommentOnPage(page, commentText) {
  addLog(`[+] Waiting 5s for page to render...`, 'info');
  await page.waitForTimeout(5000);

  if (page.url().includes('/accounts/login') || page.url().includes('/accounts/suspended')) {
    throw new Error('Instagram account session expired or logged out. Please update account session in Admin.');
  }

  // Close any popup/modal dialog (like "Never miss a post from...")
  try {
    const closeBtn = page.locator('svg[aria-label="Close"], button:has(svg[aria-label="Close"]), div[role="dialog"] button').first();
    if (await closeBtn.isVisible({ timeout: 2500 })) {
      await closeBtn.click({ force: true });
      addLog(`[✓] Dismissed popup modal dialog`, 'info');
      await page.waitForTimeout(1000);
    }
  } catch (_) {}

  // Handle Cookie consent modal if present
  try {
    const cookieBtns = page.locator('button:has-text("Allow"), button:has-text("Accept"), button:has-text("Alle zulassen"), button:has-text("Cookies")');
    const count = await cookieBtns.count();
    for (let i = 0; i < count; i++) {
      const btn = cookieBtns.nth(i);
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ force: true });
        addLog(`[✓] Dismissed Cookie Consent banner`, 'info');
        await page.waitForTimeout(1500);
        break;
      }
    }
  } catch (_) {}

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Click comment icon if present (especially on Reels layout)
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
      addLog(`[✓] Clicked visible comment icon!`, 'info');
      await page.waitForTimeout(3000);
    }
  } catch (_) {}

  let focused = false;
  const inputSelectors = [
    'input[placeholder*="comment"i]',
    'input[placeholder*="Add a comment"i]',
    'input[placeholder*="Kommentar"i]',
    'textarea[placeholder*="comment"i]',
    'textarea[aria-label*="comment"i]',
    'form textarea',
    'form input[type="text"]',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    'textarea'
  ];

  // Poll for up to 15 seconds to let Instagram GraphQL load comment drawer
  addLog(`[+] Waiting for comment box to render...`, 'info');
  const startWait = Date.now();
  while (Date.now() - startWait < 15000 && !focused) {
    for (const sel of inputSelectors) {
      try {
        const inputEl = page.locator(sel).first();
        if (await inputEl.isVisible({ timeout: 1200 })) {
          await inputEl.click({ force: true });
          focused = true;
          addLog(`[✓] Focused input box using selector: ${sel}`, 'info');
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
      addLog(`📸 Saved error screenshot: https://whopgrow.online/last_error.png`, 'warning');
    } catch (_) {}
    throw new Error('Could not locate comment input. Ensure account is logged into Instagram and post allows comments.');
  }

  await page.waitForTimeout(1000);
  addLog(`[+] Typing comment: "${commentText}"...`, 'info');
  await page.keyboard.type(commentText, { delay: 100 });
  await page.waitForTimeout(1500);

  // Try post button
  try {
    const postBtn = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post"), button[type="submit"]:has-text("Post")').last();
    if (await postBtn.isVisible({ timeout: 3000 })) {
      await postBtn.click({ force: true });
      addLog(`[✓] Clicked Post button!`, 'success');
      await page.waitForTimeout(4000);
      return true;
    }
  } catch (_) {}

  await page.keyboard.press('Enter');
  addLog(`[✓] Submitted comment via Enter key!`, 'success');
  await page.waitForTimeout(4000);
  return true;
}

app.get('/api/profiles', (req, res) => {
  if (req.query.reboot === 'true') {
    res.json({ success: true, message: 'Rebooting process...' });
    setTimeout(() => { process.exit(0); }, 300);
    return;
  }
  res.json({ profiles: getProfiles() });
});

app.get('/api/inspect', (req, res) => {
  res.json({
    dirname: __dirname,
    filename: __filename,
    serverFileSnippet: fs.readFileSync(__filename, 'utf8').substring(7500, 8200)
  });
});

app.get('/api/status', (req, res) => {
  res.json(currentJob);
});

let activeBrowserInstance = null;

app.post('/api/reset-job', (req, res) => {
  currentJob = {
    id: null,
    status: 'idle',
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    logs: [],
    startTime: null,
    stopRequested: false
  };
  res.json({ success: true, message: 'Job reset' });
});

app.post('/api/stop-job', async (req, res) => {
  currentJob.stopRequested = true;
  currentJob.status = 'stopped';
  addLog('🛑 Job stop requested by user! Force closing browser...', 'warning');
  if (activeBrowserInstance) {
    try {
      await activeBrowserInstance.close();
    } catch (_) {}
    activeBrowserInstance = null;
  }
  res.json({ success: true, message: 'Job stopped instantly' });
});

app.post('/api/start-job', async (req, res) => {
  const { links, comments, selectedProfiles, delaySeconds = 15 } = req.body;

  if (!links || links.length === 0 || !comments || comments.length === 0 || !selectedProfiles || selectedProfiles.length === 0) {
    return res.status(400).json({ error: 'Links, comments, and profiles are required' });
  }

  const parsedLinks = links.map(l => String(l).trim()).filter(Boolean);
  const parsedComments = comments.map(c => String(c).trim()).filter(Boolean);

  currentJob = {
    id: Date.now().toString(),
    status: 'running',
    totalTasks: parsedLinks.length * selectedProfiles.length,
    completedTasks: 0,
    failedTasks: 0,
    logs: [],
    startTime: new Date().toISOString(),
    stopRequested: false
  };

  res.json({ success: true, message: 'Job started' });

  runAutomationTask(parsedLinks, parsedComments, selectedProfiles, delaySeconds);
});

async function runAutomationTask(links, comments, profiles, delaySec) {
  const jobRunId = Math.floor(1000 + Math.random() * 9000);
  addLog(`🚀 Job started (${links.length} links x ${profiles.length} profiles) via India Residential Proxy...`, 'info');

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

  activeBrowserInstance = browser;

  try {
    for (let pIdx = 0; pIdx < profiles.length; pIdx++) {
      const profileName = profiles[pIdx];
      if (currentJob.stopRequested) break;

      const profileProxy = getProxyForProfile(profileName, jobRunId);
      addLog(`👤 Launching profile: ${profileName} [🛡️ India Residential IP via ${profileProxy.username}]...`, 'info');
      const userDataDir = path.resolve(__dirname, 'profiles', profileName);
      const statePath = path.join(userDataDir, 'state.json');

      const contextOpts = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        proxy: profileProxy,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      };

      if (fs.existsSync(statePath)) {
        contextOpts.storageState = statePath;
      }

      const context = await browser.newContext(contextOpts);

      // Block heavy video streams to conserve bandwidth without breaking React hydration
      await context.route('**/*.{mp4,webm,avi}', route => route.abort());

      if (fs.existsSync(statePath)) {
        try {
          const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (stateData.cookies && Array.isArray(stateData.cookies)) {
            await context.addCookies(stateData.cookies);
            addLog(`[+] Loaded ${stateData.cookies.length} session cookies for ${profileName}`, 'info');
          }
        } catch (e) {
          addLog(`⚠️ Failed reading state.json: ${e.message}`, 'warning');
        }
      }

      const page = await context.newPage();

      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      for (let lIdx = 0; lIdx < links.length; lIdx++) {
        if (currentJob.stopRequested) break;

        const rawLink = links[lIdx];
        const link = cleanInstagramUrl(rawLink);
        const commentText = comments[(lIdx + pIdx) % comments.length];

        addLog(`🔗 [${profileName}] Opening: ${link}`, 'info');

        try {
          await safeGoto(page, link, 2);
          await page.waitForTimeout(3000);
          addLog(`💬 [${profileName}] Commenting: "${commentText}"`, 'info');
          await postCommentOnPage(page, commentText);
          currentJob.completedTasks++;
          addLog(`✅ [${profileName}] Posted successfully!`, 'success');
        } catch (err) {
          currentJob.failedTasks++;
          addLog(`❌ [${profileName}] Error: ${err.message}`, 'error');
        }

        if (lIdx < links.length - 1 && !currentJob.stopRequested) {
          addLog(`⏳ Delaying ${delaySec}s...`, 'info');
          await new Promise(r => setTimeout(r, delaySec * 1000));
        }
      }

      try {
        await Promise.race([
          context.close(),
          new Promise(r => setTimeout(r, 2000))
        ]);
      } catch (_) {}

      if (pIdx < profiles.length - 1 && !currentJob.stopRequested) {
        addLog(`⏳ Waiting 5s before switching to next account (${profiles[pIdx + 1]})...`, 'info');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } catch (err) {
    addLog(`⚠️ Automation interrupted: ${err.message}`, 'warning');
  } finally {
    activeBrowserInstance = null;
    try {
      await Promise.race([
        browser.close(),
        new Promise(r => setTimeout(r, 2000))
      ]);
    } catch (_) {}
    currentJob.status = currentJob.stopRequested ? 'stopped' : (currentJob.completedTasks > 0 ? 'completed' : 'failed');
    addLog(`Job finished! Completed: ${currentJob.completedTasks}, Failed: ${currentJob.failedTasks}`, currentJob.completedTasks > 0 ? 'success' : 'error');
  }
}

async function runFollowAutomationTask(rawTarget, profiles) {
  let username = rawTarget.trim();
  username = username.replace(/^@/, '');
  if (username.includes('instagram.com/')) {
    const match = username.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
    if (match) username = match[1];
  }
  username = username.split('/')[0].split('?')[0];

  const jobRunId = Math.floor(1000 + Math.random() * 9000);
  addLog(`🚀 Follow job started for @${username} (${profiles.length} profiles) via India Residential Proxy...`, 'info');

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

  activeBrowserInstance = browser;

  try {
    for (let pIdx = 0; pIdx < profiles.length; pIdx++) {
      const profileName = profiles[pIdx];
      if (currentJob.stopRequested) break;

      const profileProxy = getProxyForProfile(profileName, jobRunId);
      addLog(`👤 Launching profile: ${profileName} [🛡️ India Residential IP via ${profileProxy.username}]...`, 'info');
      const userDataDir = path.resolve(__dirname, 'profiles', profileName);
      const statePath = path.join(userDataDir, 'state.json');

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

      // Block heavy video streams to conserve bandwidth without breaking React hydration
      await context.route('**/*.{mp4,webm,avi}', route => route.abort());

      if (fs.existsSync(statePath)) {
        try {
          const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (stateData.cookies && Array.isArray(stateData.cookies)) {
            await context.addCookies(stateData.cookies);
            addLog(`[+] Loaded ${stateData.cookies.length} session cookies for ${profileName}`, 'info');
          }
        } catch (e) {}
      }

      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      try {
        const cleanUser = username.trim().replace(/^@/, '').split('/')[0];
        const profileUrl = `https://www.instagram.com/${cleanUser}/`;
        addLog(`🔗 [${profileName}] Opening profile: ${profileUrl}`, 'info');
        await safeGoto(page, profileUrl, 2);
        await page.waitForTimeout(3000);
        await followUserOnPage(page, cleanUser);
        currentJob.completedTasks++;
        addLog(`✅ [${profileName}] Followed @${cleanUser} successfully!`, 'success');
      } catch (err) {
        currentJob.failedTasks++;
        addLog(`❌ [${profileName}] Error: ${err.message}`, 'error');
      }

      try {
        await Promise.race([context.close(), new Promise(r => setTimeout(r, 2000))]);
      } catch (_) {}

      if (pIdx < profiles.length - 1 && !currentJob.stopRequested) {
        addLog(`⏳ Waiting 5s before switching to next account (${profiles[pIdx + 1]})...`, 'info');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } catch (err) {
    addLog(`⚠️ Follow task interrupted: ${err.message}`, 'warning');
  } finally {
    activeBrowserInstance = null;
    try {
      await Promise.race([browser.close(), new Promise(r => setTimeout(r, 2000))]);
    } catch (_) {}
    currentJob.status = currentJob.stopRequested ? 'stopped' : (currentJob.completedTasks > 0 ? 'completed' : 'failed');
    addLog(`🎉 Follow job finished! Completed: ${currentJob.completedTasks}, Failed: ${currentJob.failedTasks}`, currentJob.completedTasks > 0 ? 'success' : 'error');
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard running on port ${PORT}`);
});
