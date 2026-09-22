import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, 'queue_database.json');
const LOCK_FILE = path.join(__dirname, 'queue_database.json.tmp');

class Database {
  constructor() {
    this.data = {
      nextOrderId: 10001,
      orders: [],
      accounts: {},
      settings: {
        maxDailyActionsPerAccount: 25,
        accountCooldownSeconds: 300, // 5 minutes safe gap between actions on SAME account
        interOrderDelaySeconds: 15    // 15 seconds gap between consecutive queue jobs
      }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('⚠️ Warning reading database, initializing clean state:', err.message);
      this.save();
    }
  }

  save() {
    try {
      const serialized = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(LOCK_FILE, serialized, 'utf8');
      fs.renameSync(LOCK_FILE, DB_FILE); // Atomic write
    } catch (err) {
      console.error('❌ Failed saving database:', err.message);
    }
  }

  getTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // --- ORDER MANAGEMENT ---

  createOrder({ service_type, target, content = '', quantity = 1, source = 'api' }) {
    const today = this.getTodayStr();
    const order = {
      id: this.data.nextOrderId++,
      service_type: service_type.toLowerCase(), // 'comment' | 'follower'
      target: target.trim(),
      content: content ? content.trim() : '',
      quantity: Math.max(1, parseInt(quantity, 10) || 1),
      completed_count: 0,
      status: 'pending', // 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial'
      assigned_accounts: [],
      source,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null
    };

    this.data.orders.push(order);
    this.save();
    return order;
  }

  getOrder(orderId) {
    const numId = parseInt(orderId, 10);
    return this.data.orders.find(o => o.id === numId) || null;
  }

  getNextPendingOrder() {
    return this.data.orders.find(o => o.status === 'pending' || o.status === 'in_progress');
  }

  updateOrder(orderId, updates) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    Object.assign(order, updates);
    order.updated_at = new Date().toISOString();
    this.save();
    return order;
  }

  getOrderStats() {
    const orders = this.data.orders;
    return {
      total: orders.length,
      pending: orders.filter(o => o.status === 'pending').length,
      in_progress: orders.filter(o => o.status === 'in_progress').length,
      completed: orders.filter(o => o.status === 'completed').length,
      failed: orders.filter(o => o.status === 'failed').length
    };
  }

  // --- ACCOUNT POOL & SMART ROTATION ---

  syncAccountsFromDisk(profileDirs) {
    const today = this.getTodayStr();
    for (const p of profileDirs) {
      if (!this.data.accounts[p.name]) {
        this.data.accounts[p.name] = {
          profile_name: p.name,
          username: p.username || '',
          is_active: p.isLoggedIn,
          actions_today: 0,
          total_actions: 0,
          last_action_at: null,
          last_reset_date: today,
          status: p.isLoggedIn ? 'ready' : 'offline'
        };
      } else {
        this.data.accounts[p.name].is_active = p.isLoggedIn;
        if (p.username) this.data.accounts[p.name].username = p.username;
        if (!p.isLoggedIn) this.data.accounts[p.name].status = 'offline';
        else if (this.data.accounts[p.name].status === 'offline') {
          this.data.accounts[p.name].status = 'ready';
        }
      }

      // Reset daily quota if new day
      if (this.data.accounts[p.name].last_reset_date !== today) {
        this.data.accounts[p.name].actions_today = 0;
        this.data.accounts[p.name].last_reset_date = today;
        if (this.data.accounts[p.name].status === 'quota_exceeded') {
          this.data.accounts[p.name].status = 'ready';
        }
      }
    }
    this.save();
  }

  getEligibleAccount(excludedAccountNames = []) {
    const today = this.getTodayStr();
    const now = Date.now();
    const maxDaily = this.data.settings.maxDailyActionsPerAccount || 25;
    const cooldownMs = (this.data.settings.accountCooldownSeconds || 300) * 1000;

    const candidates = Object.values(this.data.accounts).filter(acc => {
      if (!acc.is_active || acc.status === 'offline' || acc.status === 'error') return false;
      if (excludedAccountNames.includes(acc.profile_name)) return false;

      // Check daily reset
      if (acc.last_reset_date !== today) {
        acc.actions_today = 0;
        acc.last_reset_date = today;
        acc.status = 'ready';
      }

      // Check daily limit
      if (acc.actions_today >= maxDaily) {
        acc.status = 'quota_exceeded';
        return false;
      }

      // Check cooldown (5 minutes between actions on this account)
      if (acc.last_action_at) {
        const timeSince = now - new Date(acc.last_action_at).getTime();
        if (timeSince < cooldownMs) {
          acc.status = 'cooldown';
          return false;
        }
      }

      acc.status = 'ready';
      return true;
    });

    if (candidates.length === 0) return null;

    // Round-robin: Pick the account that has been resting the longest
    candidates.sort((a, b) => {
      const timeA = a.last_action_at ? new Date(a.last_action_at).getTime() : 0;
      const timeB = b.last_action_at ? new Date(b.last_action_at).getTime() : 0;
      return timeA - timeB;
    });

    return candidates[0];
  }

  recordAccountAction(profileName, success = true) {
    const acc = this.data.accounts[profileName];
    if (!acc) return;

    if (success) {
      acc.actions_today = (acc.actions_today || 0) + 1;
      acc.total_actions = (acc.total_actions || 0) + 1;
      acc.last_action_at = new Date().toISOString();
      const maxDaily = this.data.settings.maxDailyActionsPerAccount || 25;
      acc.status = acc.actions_today >= maxDaily ? 'quota_exceeded' : 'cooldown';
    } else {
      acc.last_action_at = new Date().toISOString();
    }
    this.save();
  }

  markAccountError(profileName, errorReason) {
    const acc = this.data.accounts[profileName];
    if (!acc) return;
    acc.status = 'error';
    acc.error_reason = errorReason;
    this.save();
  }
}

export const db = new Database();
