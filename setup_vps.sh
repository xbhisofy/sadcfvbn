#!/bin/bash
set -e

echo "🚀 Starting Instagram Automation VPS Installer..."

# Create project directories
mkdir -p /root/insta-bot/public
mkdir -p /root/insta-bot/profiles/profile_1
mkdir -p /root/insta-bot/profiles/profile_2
mkdir -p /root/insta-bot/profiles/profile_3
mkdir -p /root/insta-bot/profiles/profile_4

cd /root/insta-bot

# 1. Write package.json
cat << 'EOF' > package.json
{
  "name": "instagram-vps-bot",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.50.0"
  }
}
EOF

# 2. Write server.js
cat << 'EOF' > server.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { timestamp, message, type };
  currentJob.logs.unshift(logEntry);
  if (currentJob.logs.length > 500) currentJob.logs.pop();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
}

function getProfiles() {
  const profilesDir = path.resolve(__dirname, 'profiles');
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  return fs.readdirSync(profilesDir).filter(file => {
    return fs.statSync(path.join(profilesDir, file)).isDirectory();
  });
}

async function postCommentOnPage(page, commentText) {
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  try {
    const commentIcon = page.locator('svg[aria-label="Comment"]').first();
    if (await commentIcon.isVisible({ timeout: 3000 })) {
      await commentIcon.click();
      await page.waitForTimeout(2000);
    }
  } catch (_) {}

  let clicked = false;
  try {
    const placeholder = page.getByPlaceholder(/add a comment/i).first();
    if (await placeholder.isVisible({ timeout: 4000 })) {
      await placeholder.click({ force: true });
      clicked = true;
    }
  } catch (_) {}

  if (!clicked) {
    try {
      const textEl = page.getByText(/Add a comment/i).last();
      if (await textEl.isVisible({ timeout: 3000 })) {
        await textEl.click({ force: true });
        clicked = true;
      }
    } catch (_) {}
  }

  if (!clicked) throw new Error('Could not find comment input box.');

  await page.waitForTimeout(800);
  await page.keyboard.type(commentText, { delay: 100 });
  await page.waitForTimeout(1000);

  try {
    const postBtn = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post")').last();
    if (await postBtn.isVisible({ timeout: 3000 })) {
      await postBtn.click({ force: true });
      await page.waitForTimeout(3000);
      return true;
    }
  } catch (_) {}

  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  return true;
}

app.get('/api/profiles', (req, res) => {
  res.json({ profiles: getProfiles() });
});

app.get('/api/status', (req, res) => {
  res.json(currentJob);
});

app.post('/api/stop-job', (req, res) => {
  if (currentJob.status === 'running') {
    currentJob.stopRequested = true;
    addLog('Stop requested by user...', 'warning');
    res.json({ success: true, message: 'Stopping job...' });
  } else {
    res.json({ success: false, message: 'No job running' });
  }
});

app.post('/api/start-job', async (req, res) => {
  if (currentJob.status === 'running') {
    return res.status(400).json({ error: 'A job is already running' });
  }

  const { links, comments, selectedProfiles, delaySeconds = 15 } = req.body;

  if (!links || links.length === 0 || !comments || comments.length === 0 || !selectedProfiles || selectedProfiles.length === 0) {
    return res.status(400).json({ error: 'Links, comments, and profiles are required' });
  }

  const parsedLinks = links.map(l => l.trim()).filter(Boolean);
  const parsedComments = comments.map(c => c.trim()).filter(Boolean);

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
  addLog(`🚀 Job started (${links.length} links x ${profiles.length} profiles)...`, 'info');

  for (let pIdx = 0; pIdx < profiles.length; pIdx++) {
    const profileName = profiles[pIdx];
    if (currentJob.stopRequested) break;

    addLog(`👤 Launching profile: ${profileName}...`, 'info');
    const userDataDir = path.resolve(__dirname, 'profiles', profileName);

    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: [
          '--disable-session-crashed-bubble',
          '--no-first-run',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });
    } catch (err) {
      addLog(`❌ Could not launch ${profileName}: ${err.message}`, 'error');
      currentJob.failedTasks += links.length;
      continue;
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    for (let lIdx = 0; lIdx < links.length; lIdx++) {
      if (currentJob.stopRequested) break;

      const link = links[lIdx];
      const commentText = comments[(lIdx + pIdx) % comments.length];

      addLog(`🔗 [${profileName}] Opening: ${link}`, 'info');

      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
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

    try { await context.close(); } catch (_) {}
  }

  currentJob.status = currentJob.stopRequested ? 'stopped' : 'completed';
  addLog(`🎉 Job finished! Completed: ${currentJob.completedTasks}, Failed: ${currentJob.failedTasks}`, 'success');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard running on port ${PORT}`);
});
EOF

# 3. Write public/index.html
cat << 'EOF' > public/index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InstaAuto VPS — Instagram Multi-Account Commenter</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(255, 255, 255, 0.1);
      --primary-gradient: linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%);
      --accent-purple: #8b5cf6;
      --accent-pink: #ec4899;
      --accent-green: #10b981;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
    body { background: var(--bg-dark); color: var(--text-main); min-height: 100vh; padding: 2rem 1rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--card-border); }
    .logo-box { display: flex; align-items: center; gap: 12px; }
    .logo-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--primary-gradient); display: flex; align-items: center; justify-content: center; font-size: 22px; }
    h1 { font-size: 1.6rem; font-weight: 700; }
    .vps-status-badge { display: flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; color: var(--accent-green); }
    .pulse-dot { width: 8px; height: 8px; background: var(--accent-green); border-radius: 50%; box-shadow: 0 0 10px var(--accent-green); }
    .grid-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    @media (max-width: 900px) { .grid-layout { grid-template-columns: 1fr; } }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; }
    .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-bottom: 0.5rem; }
    textarea, input { width: 100%; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--card-border); border-radius: 10px; padding: 0.75rem 1rem; color: #fff; font-size: 0.9rem; outline: none; margin-bottom: 1rem; }
    textarea { min-height: 110px; resize: vertical; }
    .profiles-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; margin-bottom: 1rem; }
    .profile-checkbox-item { display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--card-border); padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
    .profile-checkbox-item input { width: auto; margin-bottom: 0; }
    .btn-group { display: flex; gap: 12px; margin-top: 1rem; }
    .btn { flex: 1; padding: 0.85rem 1.5rem; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .btn-primary { background: var(--primary-gradient); color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .progress-bar-container { background: rgba(15, 23, 42, 0.8); border-radius: 10px; height: 12px; overflow: hidden; margin: 1rem 0; }
    .progress-bar-fill { height: 100%; width: 0%; background: var(--primary-gradient); transition: width 0.4s ease; }
    .stats-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted); }
    .logs-console { background: #090d16; border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; height: 380px; overflow-y: auto; font-family: monospace; font-size: 0.82rem; }
    .log-entry { margin-bottom: 6px; }
    .log-info { color: #38bdf8; } .log-success { color: #4ade80; } .log-warning { color: #fbbf24; } .log-error { color: #f87171; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-box">
        <div class="logo-icon">💬</div>
        <div>
          <h1>InstaAuto VPS Dashboard</h1>
          <p style="font-size: 0.8rem; color: var(--text-muted);">24/7 Cloud Instagram Commenter</p>
        </div>
      </div>
      <div class="vps-status-badge">
        <div class="pulse-dot"></div>
        <span>VPS Online 24/7</span>
      </div>
    </header>
    <div class="grid-layout">
      <div class="card">
        <div class="card-title">⚙️ Task Setup</div>
        <label>1. Select Accounts / Profiles:</label>
        <div class="profiles-grid" id="profilesList">Loading...</div>
        <label for="postLinks">2. Instagram Post Links (One per line):</label>
        <textarea id="postLinks" placeholder="https://www.instagram.com/p/Cxxxxxxx/"></textarea>
        <label for="customComments">3. Custom Comments (One per line):</label>
        <textarea id="customComments" placeholder="Awesome post! 🔥&#10;Love this! ❤️"></textarea>
        <label for="delaySec">4. Delay Between Comments (Seconds):</label>
        <input type="number" id="delaySec" value="15" min="5">
        <div class="btn-group">
          <button class="btn btn-primary" id="btnStart" onclick="startJob()">🚀 Start Auto-Commenting</button>
          <button class="btn btn-danger" id="btnStop" onclick="stopJob()" disabled>🛑 Stop</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">📊 Live Status & Logs</div>
        <div class="stats-row">
          <span>Status: <strong id="jobStatusText" style="color: var(--accent-purple);">IDLE</strong></span>
          <span>Progress: <strong id="progressText">0 / 0 Tasks</strong></span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="progressBar"></div>
        </div>
        <div class="logs-console" id="logsConsole">
          <div class="log-entry log-info">[System] Dashboard Ready.</div>
        </div>
      </div>
    </div>
  </div>
  <script>
    let pollInterval = null;
    async function loadProfiles() {
      try {
        const res = await fetch('/api/profiles');
        const data = await res.json();
        if (data.profiles && data.profiles.length > 0) {
          document.getElementById('profilesList').innerHTML = data.profiles.map(p => `
            <label class="profile-checkbox-item">
              <input type="checkbox" value="${p}" checked>
              <span>${p}</span>
            </label>
          `).join('');
        } else {
          document.getElementById('profilesList').innerHTML = '<span style="color:#f87171">No profiles found</span>';
        }
      } catch(e) {
        document.getElementById('profilesList').innerHTML = '<span style="color:#f87171">Error loading profiles</span>';
      }
    }

    async function startJob() {
      const links = document.getElementById('postLinks').value.trim().split('\n').filter(Boolean);
      const comments = document.getElementById('customComments').value.trim().split('\n').filter(Boolean);
      const delaySeconds = parseInt(document.getElementById('delaySec').value) || 15;
      const checkedProfiles = Array.from(document.querySelectorAll('#profilesList input[type="checkbox"]:checked')).map(cb => cb.value);

      if (!checkedProfiles.length || !links.length || !comments.length) {
        return alert('Select at least 1 profile, enter post links & comments!');
      }

      await fetch('/api/start-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links, comments, selectedProfiles: checkedProfiles, delaySeconds })
      });
      startPolling();
    }

    async function stopJob() {
      await fetch('/api/stop-job', { method: 'POST' });
    }

    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        const status = await res.json();
        document.getElementById('jobStatusText').innerText = status.status.toUpperCase();
        const total = status.totalTasks || 0;
        const current = (status.completedTasks || 0) + (status.failedTasks || 0);
        document.getElementById('progressText').innerText = `${current} / ${total} Tasks`;
        document.getElementById('progressBar').style.width = `${total > 0 ? Math.round((current / total) * 100) : 0}%`;
        document.getElementById('btnStart').disabled = status.status === 'running';
        document.getElementById('btnStop').disabled = status.status !== 'running';
        if (status.logs) {
          document.getElementById('logsConsole').innerHTML = status.logs.map(l => `
            <div class="log-entry log-${l.type}"><span style="color:#64748b">[${l.timestamp}]</span> ${l.message}</div>
          `).join('');
        }
      } catch (e) {}
    }

    function startPolling() {
      if (!pollInterval) pollInterval = setInterval(updateStatus, 2000);
      updateStatus();
    }

    loadProfiles();
    startPolling();
  </script>
</body>
</html>
EOF

echo "📦 Installing npm dependencies & Playwright Chromium..."
npm install
npx playwright install chromium

echo "🔥 Opening Firewall Port 3000..."
ufw allow 3000/tcp || true

echo "🚀 Launching PM2 Server..."
pm2 stop insta-bot 2>/dev/null || true
pm2 start server.js --name "insta-bot"
pm2 save
pm2 startup || true

echo ""
echo "=================================================="
echo "✅ SETUP COMPLETE! Instagram Web Dashboard is LIVE!"
echo "🌐 Open in browser: http://$(curl -s ifconfig.me):3000"
echo "=================================================="
