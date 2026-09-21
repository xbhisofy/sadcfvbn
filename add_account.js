import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const profileName = process.argv[2] || 'profile_2';
const username = process.argv[3] || 'profile_2';
const sessionIdInput = process.argv[4];

if (!sessionIdInput) {
  console.log('Usage: node add_account.js <profile_name> <username> <sessionid_cookie_value>');
  process.exit(1);
}

const rawInput = sessionIdInput.trim();
let cookies = [];

if (rawInput.includes('=')) {
  const parts = rawInput.split(';');
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

const userDataDir = path.resolve(__dirname, 'profiles', profileName.trim());
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const stateData = { cookies, origins: [] };
fs.writeFileSync(path.join(userDataDir, 'state.json'), JSON.stringify(stateData, null, 2));
fs.writeFileSync(path.join(userDataDir, 'account.json'), JSON.stringify({ username: username.trim(), loggedInAt: new Date().toISOString() }));

console.log(`✅ Saved ${cookies.length} session cookies for ${profileName} (@${username})!`);
