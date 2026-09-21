import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const profileName = process.argv[2] || 'profile_1';
const userDataDir = path.resolve(__dirname, 'profiles', profileName);
if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

const statePath = path.join(userDataDir, 'state.json');

console.log(`\n==================================================`);
console.log(`🔑 Instagram Local Session Saver (${profileName})`);
console.log(`==================================================`);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 }
});

const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

console.log(`[+] Opening Instagram...`);
await page.goto('https://www.instagram.com/');

console.log(`[+] Automatically saving session state...`);

const saveState = async () => {
  try {
    await context.storageState({ path: statePath });
    console.log(`✅ Session state saved to ${statePath}`);
  } catch (_) {}
};

setInterval(saveState, 4000);
await saveState();
