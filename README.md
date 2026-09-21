# Playwright Multi-Profile Instagram Manager

A simple, secure setup for managing multiple authorized Instagram accounts locally using separate Playwright persistent browser contexts (`launchPersistentContext()`).

Each profile is maintained in an isolated directory inside `profiles/` (e.g. `profiles/profile_1`, `profiles/profile_2`), ensuring cookies, local storage, and session data remain entirely separate and persisted locally on your machine.

---

## Security & Privacy Guidelines
- **No Credentials Handling**: This tool does **NOT** extract, display, copy, store, or inject Instagram passwords, session tokens, cookies, or 2FA codes.
- **Manual Authentication**: All logins are performed directly by you inside the official browser interface.
- **No Spam / Automation**: This codebase contains no scraping, mass messaging, automated commenting, or bot actions.

---

## Step-by-Step Usage Guide

### Step 1: Launch Profile 1
To launch the first browser profile (where your existing login is stored):
```bash
npm run profile:1
```
- A visible Chromium window will open directly to `https://www.instagram.com/`.
- If you are already logged in, your session will be active immediately.

---

### Step 2: Launch Profile 2 (Or Profile 3, Profile 4, etc.)
To launch a second, separate browser profile:
```bash
npm run profile:2
```
For additional profiles:
```bash
npm run profile:3
npm run profile:4
npm run profile:5
```
Or launch a custom-named profile dynamically:
```bash
npm run profile -- my_custom_account
```

---

### Step 3: Log Into Each Account
1. When the browser window opens for the chosen profile, enter your credentials into Instagram's login interface.
2. Complete any required 2FA verification manually.
3. Verify that you are signed into the correct account for that profile.

---

### Step 4: Close the Browser Window
When you are done using an account:
- Simply close the browser window or press `Ctrl+C` in your terminal.
- Playwright automatically persists your session state, cookies, and local data into the corresponding `profiles/<profile_name>` folder.

---

### Step 5: Reopen the Profile Later
Whenever you want to access that account again in the future:
```bash
npm run profile:2
```
The browser will launch using the saved persistent context, opening Instagram already signed into that account—without requiring re-authentication.
