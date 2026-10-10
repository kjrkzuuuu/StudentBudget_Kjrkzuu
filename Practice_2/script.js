/* =========================================================
   StudentBudget
   Vanilla JavaScript, no libraries. Data lives in localStorage.

   1. Constants            7. Calculations
   2. DOM helpers          8. Notifications and dialogs
   3. Dates                9. Rendering
   4. Money and input     10. Feature handlers
   5. Data validation     11. Navigation
   6. Storage             12. Start-up
   ========================================================= */
(() => {
  'use strict';

  /* ---------- 1. Constants ---------- */
  const STORAGE_KEY = 'studentbudget.v1';
  const UNREADABLE_KEY = 'studentbudget.v1.unreadable';
  const BACKUP_APP = 'StudentBudget';
  const BACKUP_VERSION = 1;
  const MAX_AMOUNT = 9999999.99;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const PAGE_SIZE = 100;

  const VIEWS = {
    dashboard: 'Dashboard',
    allowance: 'Allowance',
    expenses: 'Expenses',
    savings: 'Savings',
    history: 'History and reports',
    settings: 'Settings'
  };

  const CATEGORIES = [
    'Food',
    'Transportation',
    'School Supplies',
    'Load and Internet',
    'Personal Needs',
    'Entertainment',
    'Other'
  ];

  const CURRENCIES = [
    ['PHP', 'Philippine Peso'],
    ['USD', 'US Dollar'],
    ['EUR', 'Euro'],
    ['GBP', 'British Pound'],
    ['AUD', 'Australian Dollar'],
    ['CAD', 'Canadian Dollar'],
    ['SGD', 'Singapore Dollar'],
    ['HKD', 'Hong Kong Dollar'],
    ['CNY', 'Chinese Yuan'],
    ['INR', 'Indian Rupee'],
    ['MYR', 'Malaysian Ringgit'],
    ['THB', 'Thai Baht'],
    ['AED', 'UAE Dirham']
  ];

  const COLLECTION_LABELS = {
    allowances: 'Allowance record',
    expenses: 'Expense',
    goals: 'Savings goal',
    savingsActivities: 'Savings activity'
  };

  /* ---------- 2. DOM helpers ---------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  function appendChildren(node, children) {
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child);
    }
  }

  // Builds an element. User text always goes through "text" (textContent), never innerHTML.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    appendChildren(node, children);
    return node;
  }

  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    appendChildren(node, children);
    return node;
  }

  function icon(name) {
    const svg = svgEl('svg', { class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(svgEl('use', { href: `#i-${name}` }));
    return svg;
  }

  function iconButton(iconName, label, action, id, extraClass = '') {
    const button = el('button', {
      class: `btn-icon ${extraClass}`.trim(),
      type: 'button',
      'aria-label': label,
      title: label,
      dataset: { action, id }
    });
    button.append(icon(iconName));
    return button;
  }

  function chip(category) {
    return el('span', { class: 'chip', text: category, dataset: { cat: category } });
  }

  // Sets an input value unless the person is currently typing in it.
  function setValue(input, value) {
    if (input && input !== document.activeElement) input.value = value;
  }

  function fillSelect(select, options) {
    select.replaceChildren(...options.map(([value, label]) => el('option', { value, text: label })));
  }

  /* ---------- 3. Dates (always local time, stored as YYYY-MM-DD) ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayISO = () => toISODate(new Date());

  function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function isISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    if (y < 1900 || y > 2100) return false;
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  function addDays(iso, count) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + count);
    return toISODate(d);
  }

  // Weeks run Monday to Sunday.
  function startOfWeek(iso) {
    const offset = (parseISODate(iso).getDay() + 6) % 7;
    return addDays(iso, -offset);
  }
  const startOfMonth = (iso) => `${iso.slice(0, 8)}01`;
  function endOfMonth(iso) {
    const d = parseISODate(iso);
    return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  const dateFormats = {
    long: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    medium: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    month: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }),
    monthOnly: new Intl.DateTimeFormat('en-US', { month: 'long' }),
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short' }),
    stamp: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  };
  const formatDate = (iso, style = 'medium') => dateFormats[style].format(parseISODate(iso));

  /* ---------- 4. Money and input parsing ---------- */
  const moneyFormatters = new Map();
  const symbolCache = new Map();

  function formatMoney(value, currency) {
    const code = currency || state.settings.currency;
    let formatter = moneyFormatters.get(code);
    if (!formatter) {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
      moneyFormatters.set(code, formatter);
    }
    const rounded = Math.round(value * 100) / 100;
    return formatter.format(rounded === 0 ? 0 : rounded);
  }

  function currencySymbol(code) {
    if (!symbolCache.has(code)) {
      let symbol = code;
      try {
        const part = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
          .formatToParts(0)
          .find((p) => p.type === 'currency');
        if (part) symbol = part.value;
      } catch (_) { /* keep the currency code */ }
      symbolCache.set(code, symbol);
    }
    return symbolCache.get(code);
  }

  const plainNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  const toCents = (amount) => Math.round(amount * 100);
  const sumAmounts = (records) => records.reduce((total, r) => total + toCents(r.amount), 0) / 100;

  // Reads a money field. Returns { value } or { error }.
  function parseAmount(input, { allowZero = false } = {}) {
    if (input.validity && input.validity.badInput) return { error: 'Enter numbers only, for example 125.50.' };
    const raw = input.value.trim();
    if (raw === '') return { error: 'Enter an amount.' };
    if (raw.startsWith('-')) return { error: 'The amount cannot be negative.' };
    if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(raw)) {
      return { error: 'Use a number with up to 2 decimal places, like 125.50.' };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: 'Enter a valid amount.' };
    if (value === 0 && !allowZero) return { error: 'The amount must be greater than zero.' };
    if (value > MAX_AMOUNT) return { error: `The amount cannot be more than ${plainNumber.format(MAX_AMOUNT)}.` };
    return { value: Math.round(value * 100) / 100 };
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ---------- 5. Data validation ---------- */
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_AMOUNT && Math.round(v * 100) / 100 === v;
  const isMoneyOrZero = (v) => v === 0 || isMoney(v);
  const isValidId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100;

  function cleanText(value, max, { required = false } = {}) {
    if (value === undefined || value === null) return required ? null : '';
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (required && trimmed === '') return null;
    return trimmed.length <= max ? trimmed : null;
  }

  function cleanTimestamp(value, strict) {
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
    return strict ? null : new Date().toISOString();
  }

  const SETTING_RULES = {
    currency: (v) => typeof v === 'string' && CURRENCIES.some(([code]) => code === v),
    dailyLimit: isMoneyOrZero,
    goalPeriod: (v) => v === 'weekly' || v === 'monthly',
    goalAmount: isMoneyOrZero,
    usualAllowance: isMoneyOrZero,
    theme: (v) => v === 'dark' || v === 'light'
  };

  // Each cleaner returns { value } for a good record or { error } describing the problem.
  const RECORD_CLEANERS = {
    allowances(item, strict) {
      if (!isPlainObject(item)) return { error: 'is not a valid record' };
      if (!isValidId(item.id)) return { error: 'has an invalid id' };
      if (!isISODate(item.date)) return { error: 'has an invalid date' };
      if (!isMoney(item.amount)) return { error: 'has an invalid amount' };
      const note = cleanText(item.note, 200);
      if (note === null) return { error: 'has an invalid note' };
      const createdAt = cleanTimestamp(item.createdAt, strict);
      if (!createdAt) return { error: 'has an invalid creation time' };
      return { value: { id: item.id, date: item.date, amount: item.amount, note, createdAt } };
    },
    expenses(item, strict) {
      if (!isPlainObject(item)) return { error: 'is not a valid record' };
      if (!isValidId(item.id)) return { error: 'has an invalid id' };
      const description = cleanText(item.description, 80, { required: true });
      if (description === null) return { error: 'has an invalid description' };
      if (!isMoney(item.amount)) return { error: 'has an invalid amount' };
      if (!isISODate(item.date)) return { error: 'has an invalid date' };
      let category = item.category;
      if (!CATEGORIES.includes(category)) {
        if (strict) return { error: 'has an unknown category' };
        category = 'Other';
      }
      const notes = cleanText(item.notes, 300);
      if (notes === null) return { error: 'has invalid notes' };
      const createdAt = cleanTimestamp(item.createdAt, strict);
      if (!createdAt) return { error: 'has an invalid creation time' };
      return { value: { id: item.id, description, amount: item.amount, category, date: item.date, notes, createdAt } };
    },
    goals(item, strict) {
      if (!isPlainObject(item)) return { error: 'is not a valid record' };
      if (!isValidId(item.id)) return { error: 'has an invalid id' };
      const name = cleanText(item.name, 60, { required: true });
      if (name === null) return { error: 'has an invalid name' };
      if (!isMoney(item.target)) return { error: 'has an invalid target amount' };
      const createdAt = cleanTimestamp(item.createdAt, strict);
      if (!createdAt) return { error: 'has an invalid creation time' };
      return { value: { id: item.id, name, target: item.target, createdAt } };
    },
    savingsActivities(item, strict) {
      if (!isPlainObject(item)) return { error: 'is not a valid record' };
      if (!isValidId(item.id)) return { error: 'has an invalid id' };
      if (!isValidId(item.goalId)) return { error: 'has an invalid goal id' };
      if (item.type !== 'deposit' && item.type !== 'withdrawal') return { error: 'has an invalid type' };
      if (!isMoney(item.amount)) return { error: 'has an invalid amount' };
      if (!isISODate(item.date)) return { error: 'has an invalid date' };
      const note = cleanText(item.note, 200);
      if (note === null) return { error: 'has an invalid note' };
      const createdAt = cleanTimestamp(item.createdAt, strict);
      if (!createdAt) return { error: 'has an invalid creation time' };
      return { value: { id: item.id, goalId: item.goalId, type: item.type, amount: item.amount, date: item.date, note, createdAt } };
    }
  };

  function createDefaultState() {
    return {
      settings: {
        currency: 'PHP',
        dailyLimit: 0,
        goalPeriod: 'weekly',
        goalAmount: 0,
        usualAllowance: 0,
        theme: 'dark'
      },
      allowances: [],
      expenses: [],
      goals: [],
      savingsActivities: []
    };
  }

  // Strict mode (imports) throws on the first problem. Lenient mode (saved data) skips bad records.
  function normalizeState(raw, strict) {
    if (!isPlainObject(raw)) throw new Error('The data is not a valid StudentBudget object.');
    const clean = createDefaultState();
    let skipped = 0;

    if (raw.settings === undefined) {
      if (strict) throw new Error('The backup is missing "settings".');
    } else if (!isPlainObject(raw.settings)) {
      if (strict) throw new Error('"settings" must be an object.');
      skipped += 1;
    } else {
      for (const key of Object.keys(SETTING_RULES)) {
        const value = raw.settings[key];
        if (value === undefined) {
          if (strict) throw new Error(`The setting "${key}" is missing.`);
        } else if (SETTING_RULES[key](value)) {
          clean.settings[key] = value;
        } else if (strict) {
          throw new Error(`The setting "${key}" has an invalid value.`);
        } else {
          skipped += 1;
        }
      }
    }

    const goalIds = new Set();
    for (const collection of ['allowances', 'expenses', 'goals', 'savingsActivities']) {
      const list = raw[collection];
      if (list === undefined) {
        if (strict) throw new Error(`The backup is missing "${collection}".`);
        continue;
      }
      if (!Array.isArray(list)) {
        if (strict) throw new Error(`"${collection}" must be a list.`);
        skipped += 1;
        continue;
      }
      const seen = new Set();
      list.forEach((item, index) => {
        const result = RECORD_CLEANERS[collection](item, strict);
        let problem = result.error;
        if (!problem && seen.has(result.value.id)) problem = 'has a duplicate id';
        if (!problem && collection === 'savingsActivities' && !goalIds.has(result.value.goalId)) {
          problem = 'points to a savings goal that does not exist';
        }
        if (problem) {
          if (strict) throw new Error(`${COLLECTION_LABELS[collection]} #${index + 1} ${problem}.`);
          skipped += 1;
          return;
        }
        seen.add(result.value.id);
        if (collection === 'goals') goalIds.add(result.value.id);
        clean[collection].push(result.value);
      });
    }

    if (strict) {
      for (const goal of clean.goals) {
        if (goalSaved(clean, goal.id) < 0) {
          throw new Error(`The withdrawals for "${goal.name}" are larger than its deposits.`);
        }
      }
    }
    return { state: clean, skipped };
  }

  function parseBackup(parsed) {
    if (!isPlainObject(parsed) || parsed.app !== BACKUP_APP) {
      throw new Error('This file is not a StudentBudget backup.');
    }
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
      throw new Error('The backup has no valid version number.');
    }
    if (parsed.version > BACKUP_VERSION) {
      throw new Error('This backup was made by a newer version of StudentBudget.');
    }
    return normalizeState(parsed.data, true).state;
  }

  /* ---------- 6. Storage ---------- */
  let state = createDefaultState();

  const ui = {
    allowanceDate: todayISO(),
    expensesShown: PAGE_SIZE,
    historyShown: PAGE_SIZE,
    lastToday: todayISO(),
    detailId: null
  };

  function loadStoredState() {
    const notices = [];
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      notices.push({ type: 'warning', message: 'This browser is blocking saved data, so your changes will not be kept after you close the page.' });
      return { state: createDefaultState(), notices };
    }
    if (raw === null) return { state: createDefaultState(), notices };

    try {
      const result = normalizeState(JSON.parse(raw), false);
      if (result.skipped > 0) {
        notices.push({ type: 'warning', message: `${result.skipped} saved item${result.skipped === 1 ? ' was' : 's were'} unreadable and skipped. The rest of your data loaded normally.` });
      }
      return { state: result.state, notices };
    } catch (_) {
      try { window.localStorage.setItem(UNREADABLE_KEY, raw); } catch (__) { /* nothing more we can do */ }
      notices.push({ type: 'error', message: 'Your saved data could not be read, so StudentBudget started fresh. A copy of the unreadable data was kept in this browser.' });
      return { state: createDefaultState(), notices };
    }
  }

  function persist(quiet = false) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      if (!quiet) {
        showToast('error', 'Could not save to this browser. Your changes will be lost when you close or refresh the page. Export a backup to keep them.');
      }
      return false;
    }
  }

  function commit() {
    persist();
    renderAll();
  }

  /* ---------- 7. Calculations ---------- */
  const allowancesOn = (date) => state.allowances.filter((a) => a.date === date);
  const expensesOn = (date) => state.expenses.filter((e) => e.date === date);

  // Daily Balance = allowance recorded for the date - expenses on the date.
  // A date with no allowance record counts as 0 allowance, never as money received.
  function dayFigures(date) {
    const records = allowancesOn(date);
    const allowance = sumAmounts(records);
    const spent = sumAmounts(expensesOn(date));
    return {
      date,
      hasAllowance: records.length > 0,
      allowanceCount: records.length,
      allowance,
      spent,
      balance: (toCents(allowance) - toCents(spent)) / 100
    };
  }

  const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

  function goalSaved(source, goalId) {
    let cents = 0;
    for (const a of source.savingsActivities) {
      if (a.goalId !== goalId) continue;
      cents += a.type === 'deposit' ? toCents(a.amount) : -toCents(a.amount);
    }
    return cents / 100;
  }

  function totalSaved() {
    return state.goals.reduce((cents, g) => cents + toCents(goalSaved(state, g.id)), 0) / 100;
  }

  function netSavedBetween(from, to) {
    let cents = 0;
    for (const a of state.savingsActivities) {
      if (!inRange(a.date, from, to)) continue;
      cents += a.type === 'deposit' ? toCents(a.amount) : -toCents(a.amount);
    }
    return cents / 100;
  }

  function compareNewest(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  }

  // Budget warnings for one date, worked out from saved data only.
  function warningKeys(date) {
    const f = dayFigures(date);
    const limitCents = toCents(state.settings.dailyLimit);
    const spentCents = toCents(f.spent);
    const keys = [];
    if (limitCents > 0) {
      if (spentCents >= limitCents) keys.push('limit');
      else if (spentCents * 100 >= limitCents * 80) keys.push('near');
    }
    if (spentCents > toCents(f.allowance)) keys.push('over');
    return keys;
  }

  function describeWarning(key, date) {
    const f = dayFigures(date);
    const limit = state.settings.dailyLimit;
    const lead = date === todayISO() ? 'Today' : formatDate(date);
    if (key === 'near') {
      const pct = Math.floor((f.spent / limit) * 100);
      return { type: 'warning', message: `${lead}: you have used ${pct}% of your daily spending limit (${formatMoney(f.spent)} of ${formatMoney(limit)}).` };
    }
    if (key === 'limit') {
      const over = toCents(f.spent) > toCents(limit);
      return {
        type: 'error',
        message: over
          ? `${lead}: you are over your daily spending limit by ${formatMoney(f.spent - limit)}.`
          : `${lead}: you have reached your daily spending limit of ${formatMoney(limit)}.`
      };
    }
    if (f.hasAllowance) {
      return { type: 'error', message: `${lead}: spending is ${formatMoney(f.spent - f.allowance)} over the allowance of ${formatMoney(f.allowance)}.` };
    }
    return { type: 'error', message: `${lead}: no allowance is recorded, so the balance shows as ${formatMoney(f.balance)}.` };
  }

  // Runs a change, then shows a toast only for warnings that are new because of that change.
  // Ordinary re-renders never call this, so warnings do not repeat.
  function trackWarnings(dates, mutate) {
    const unique = [...new Set(dates.filter(Boolean))];
    const before = new Map(unique.map((d) => [d, new Set(warningKeys(d))]));
    mutate();
    for (const date of unique) {
      const had = before.get(date);
      let fresh = warningKeys(date).filter((k) => !had.has(k));
      if (fresh.includes('limit') || had.has('limit')) fresh = fresh.filter((k) => k !== 'near');
      for (const key of fresh) {
        const warning = describeWarning(key, date);
        showToast(warning.type, warning.message);
      }
    }
  }

  /* ---------- 8. Notifications and dialogs ---------- */
  function showToast(type, message) {
    const host = $('toasts');
    if (!host) return;
    for (const existing of host.querySelectorAll('.toast-msg')) {
      if (existing.textContent === message) return;
    }
    const iconName = { success: 'check', warning: 'warning', error: 'alert', info: 'info' }[type] || 'info';
    const toast = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' });
    const close = el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Dismiss message' });
    close.append(icon('close'));
    toast.append(icon(iconName), el('p', { class: 'toast-msg', text: message }), close);
    const remove = () => toast.remove();
    close.addEventListener('click', remove);
    host.append(toast);
    while (host.children.length > 4) host.firstElementChild.remove();
    window.setTimeout(remove, type === 'success' || type === 'info' ? 4500 : 9000);
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function confirmAction({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const dialog = $('confirm-dialog');
      $('confirm-title').textContent = title;
      $('confirm-message').textContent = message;
      const ok = $('confirm-ok');
      ok.textContent = confirmText;
      ok.classList.toggle('btn-danger', danger);
      ok.classList.toggle('btn-primary', !danger);
      dialog.returnValue = '';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      openDialog(dialog);
      $('confirm-cancel').focus();
    });
  }

  // Form helpers
  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((p) => { p.hidden = true; p.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((input) => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
  }

  function setError(input, message) {
    const slot = $(`${input.id}-error`);
    if (slot) { slot.textContent = message; slot.hidden = false; }
    input.setAttribute('aria-invalid', 'true');
    if (slot) input.setAttribute('aria-describedby', slot.id);
  }

  function focusFirstInvalid(form) {
    const first = form.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
  }

  // Stops a form from being submitted twice (double clicks, repeated Enter presses).
  async function guarded(form, task) {
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const buttons = form.querySelectorAll('button[type="submit"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await task();
    } finally {
      window.setTimeout(() => {
        delete form.dataset.busy;
        buttons.forEach((b) => { b.disabled = false; });
      }, 400);
    }
  }

  function validDateField(input) {
    if (!isISODate(input.value)) {
      setError(input, 'Choose a valid date between 1900 and 2100.');
      return false;
    }
    return true;
  }

  function validTextField(input, label, max, required) {
    const value = input.value.trim();
    if (required && value === '') { setError(input, `Enter ${label}.`); return null; }
    if (value.length > max) { setError(input, `Keep this to ${max} characters or fewer.`); return null; }
    return value;
  }

  /* ---------- 9. Rendering ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
  }

  function renderCurrencySymbols() {
    const symbol = currencySymbol(state.settings.currency);
    document.querySelectorAll('[data-currency-symbol]').forEach((node) => { node.textContent = symbol; });
  }

  function renderEmptyState(container, { title, text, actionText, onAction }) {
    container.replaceChildren(el('h3', { text: title }), el('p', { text }));
    if (actionText) {
      const button = el('button', { class: 'btn btn-primary', type: 'button', text: actionText });
      button.addEventListener('click', onAction);
      container.append(button);
    }
    container.hidden = false;
  }

  function meter({ percent, level, label, valueText }) {
    const fill = el('div', { class: `meter-fill${level ? ` is-${level}` : ''}` });
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    return el('div', {
      class: 'meter',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.round(Math.max(0, Math.min(100, percent))),
      'aria-valuetext': valueText
    }, fill);
  }

  function renderAll() {
    applyTheme();
    renderCurrencySymbols();
    renderDashboard();
    renderAllowance();
    renderExpenses();
    renderSavings();
    renderHistory();
    renderSettings();
  }

  /* --- Dashboard --- */
  function renderDashboard() {
    const today = todayISO();
    const f = dayFigures(today);
    const monthFrom = startOfMonth(today);
    const monthTo = endOfMonth(today);
    const monthExpenses = state.expenses.filter((e) => inRange(e.date, monthFrom, monthTo));

    const dateNode = $('dash-date');
    dateNode.textContent = formatDate(today, 'long');
    dateNode.setAttribute('datetime', today);

    $('dash-empty').hidden = state.allowances.length + state.expenses.length + state.goals.length > 0;

    $('sum-allowance').textContent = formatMoney(f.allowance);
    $('sum-allowance-note').textContent = f.hasAllowance
      ? `${f.allowanceCount} record${f.allowanceCount === 1 ? '' : 's'} for today`
      : 'Nothing recorded for today';

    const todayExpenses = expensesOn(today);
    $('sum-expenses').textContent = formatMoney(f.spent);
    $('sum-expenses-note').textContent = todayExpenses.length
      ? `${todayExpenses.length} transaction${todayExpenses.length === 1 ? '' : 's'} today`
      : 'No expenses today';

    const balanceNode = $('sum-balance');
    balanceNode.textContent = formatMoney(f.balance);
    balanceNode.classList.toggle('is-negative', f.balance < 0);
    let balanceNote;
    if (!f.hasAllowance && f.spent === 0) balanceNote = "Record today's allowance to see what you have left.";
    else if (f.balance < 0) balanceNote = `Overspent by ${formatMoney(-f.balance)}${f.hasAllowance ? '' : ' (no allowance recorded today)'}.`;
    else if (f.spent === 0) balanceNote = 'Nothing spent yet today.';
    else balanceNote = 'Left to spend today.';
    $('sum-balance-note').textContent = balanceNote;

    const saved = totalSaved();
    $('sum-savings').textContent = formatMoney(saved);
    $('sum-savings-note').textContent = state.goals.length
      ? `Across ${state.goals.length} goal${state.goals.length === 1 ? '' : 's'}`
      : 'No savings goals yet';

    $('sum-month').textContent = formatMoney(sumAmounts(monthExpenses));
    $('sum-month-note').textContent = monthExpenses.length
      ? `${monthExpenses.length} transaction${monthExpenses.length === 1 ? '' : 's'} in ${formatDate(today, 'monthOnly')}`
      : `No expenses in ${formatDate(today, 'monthOnly')} yet`;

    renderDailyProgress(f);
    renderDashAlerts(today);
    renderRecent();
    renderCategoryBreakdown(monthExpenses);
    renderWeekChart(today);
  }

  function renderDailyProgress(f) {
    const limit = state.settings.dailyLimit;
    let basis = null;
    if (limit > 0) basis = { amount: limit, label: 'of your daily limit' };
    else if (f.allowance > 0) basis = { amount: f.allowance, label: "of today's allowance" };

    const track = $('daily-progress');
    const fill = $('daily-progress-fill');
    const text = $('daily-progress-text');
    fill.classList.remove('is-warn', 'is-danger');

    if (!basis) {
      fill.style.width = '0%';
      track.setAttribute('aria-valuenow', '0');
      track.setAttribute('aria-valuetext', 'No limit or allowance to measure against');
      text.textContent = "Set a daily spending limit or record today's allowance to track your progress.";
      return;
    }
    const pct = (f.spent / basis.amount) * 100;
    fill.style.width = `${Math.min(100, pct)}%`;
    if (pct >= 100) fill.classList.add('is-danger');
    else if (pct >= 80) fill.classList.add('is-warn');
    const summary = `${formatMoney(f.spent)} spent ${basis.label} of ${formatMoney(basis.amount)} (${Math.floor(pct)}%)`;
    track.setAttribute('aria-valuenow', String(Math.min(100, Math.round(pct))));
    track.setAttribute('aria-valuetext', summary);
    text.textContent = summary;
  }

  function renderDashAlerts(today) {
    const host = $('dash-alerts');
    host.replaceChildren();
    for (const key of warningKeys(today)) {
      const warning = describeWarning(key, today);
      const kind = warning.type === 'error' ? 'error' : 'warning';
      host.append(el('div', { class: `alert alert-${kind}` }, icon(kind === 'error' ? 'alert' : 'warning'), el('p', { text: warning.message })));
    }
  }

  function renderRecent() {
    const list = $('recent-list');
    const recent = [...state.expenses].sort(compareNewest).slice(0, 5);
    list.replaceChildren(...recent.map((e) =>
      el('li', {},
        el('button', { class: 'tx-row', type: 'button', dataset: { action: 'view', id: e.id }, 'aria-label': `View details for ${e.description}` },
          el('span', { class: 'tx-main' },
            el('span', { class: 'tx-title', text: e.description }),
            el('span', { class: 'tx-sub' }, chip(e.category), el('span', { text: formatDate(e.date) }))),
          el('span', { class: 'tx-amount', text: `\u2212${formatMoney(e.amount)}` })))));
    $('recent-empty').hidden = recent.length > 0;
  }

  function renderCategoryBreakdown(monthExpenses) {
    const list = $('category-breakdown');
    const totals = new Map();
    for (const e of monthExpenses) totals.set(e.category, (totals.get(e.category) || 0) + toCents(e.amount));
    const grand = [...totals.values()].reduce((a, b) => a + b, 0);
    const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);

    list.replaceChildren(...rows.map(([category, cents]) => {
      const pct = grand > 0 ? (cents / grand) * 100 : 0;
      const fill = el('div', { class: 'bar-fill', dataset: { cat: category } });
      fill.style.width = `${pct}%`;
      return el('li', { class: 'bar-row' },
        el('div', { class: 'bar-top' }, el('span', { text: category }), el('span', { text: `${formatMoney(cents / 100)} (${Math.round(pct)}%)` })),
        el('div', { class: 'bar-track', 'aria-hidden': 'true' }, fill));
    }));
    $('category-empty').hidden = rows.length > 0;
  }

  function renderWeekChart(today) {
    const host = $('week-chart');
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = addDays(today, -i);
      days.push({ date, spent: dayFigures(date).spent });
    }
    const limit = state.settings.dailyLimit;
    const total = days.reduce((t, d) => t + toCents(d.spent), 0) / 100;

    const W = 560;
    const H = 230;
    const padTop = 28;
    const padBottom = 32;
    const padX = 10;
    const plotH = H - padTop - padBottom;
    const slot = (W - padX * 2) / days.length;
    const barW = Math.min(46, slot * 0.6);
    const maxValue = Math.max(1, limit > 0 ? limit : 0, ...days.map((d) => d.spent));
    const baseline = padTop + plotH;

    const description = `Spending for the last 7 days. ${days.map((d) => `${formatDate(d.date)}: ${formatMoney(d.spent)}`).join('. ')}.`;
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': description });
    svg.append(svgEl('line', { class: 'chart-axis', x1: padX, y1: baseline, x2: W - padX, y2: baseline }));

    if (limit > 0) {
      const y = baseline - (limit / maxValue) * plotH;
      svg.append(
        svgEl('line', { class: 'chart-limit', x1: padX, y1: y, x2: W - padX, y2: y }),
        Object.assign(svgEl('text', { class: 'chart-limit-label', x: W - padX, y: y - 5, 'text-anchor': 'end' }), { textContent: 'Daily limit' })
      );
    }

    days.forEach((d, index) => {
      const cx = padX + slot * index + slot / 2;
      const isToday = d.date === today;
      const height = d.spent > 0 ? Math.max(4, (d.spent / maxValue) * plotH) : 3;
      let level = '';
      if (d.spent === 0) level = ' is-empty';
      else if (limit > 0 && toCents(d.spent) >= toCents(limit)) level = ' is-danger';
      else if (limit > 0 && toCents(d.spent) * 100 >= toCents(limit) * 80) level = ' is-warn';

      const bar = svgEl('rect', { class: `chart-bar${level}`, x: cx - barW / 2, y: baseline - height, width: barW, height, rx: 6 });
      bar.append(Object.assign(svgEl('title'), { textContent: `${formatDate(d.date)}: ${formatMoney(d.spent)} spent` }));
      svg.append(bar);

      if (d.spent > 0) {
        svg.append(Object.assign(svgEl('text', { class: 'chart-value', x: cx, y: baseline - height - 6, 'text-anchor': 'middle' }), { textContent: compactNumber.format(d.spent) }));
      }
      const label = isToday ? 'Today' : `${dateFormats.weekday.format(parseISODate(d.date))} ${parseISODate(d.date).getDate()}`;
      svg.append(Object.assign(svgEl('text', { class: `chart-label${isToday ? ' is-today' : ''}`, x: cx, y: H - 10, 'text-anchor': 'middle' }), { textContent: label }));
    });

    host.replaceChildren(svg);
    $('week-summary').textContent = total > 0
      ? `Total ${formatMoney(total)}, about ${formatMoney(total / 7)} per day.`
      : 'No spending recorded in the last 7 days.';
  }

  /* --- Allowance --- */
  function renderAllowance() {
    const date = ui.allowanceDate;
    const f = dayFigures(date);
    setValue($('al-date'), date);
    $('al-selected-label').textContent = `${formatDate(date, 'long')}${date === todayISO() ? ' (today)' : ''}`;
    $('al-total').textContent = formatMoney(f.allowance);
    $('al-expenses').textContent = formatMoney(f.spent);
    const balance = $('al-balance');
    balance.textContent = formatMoney(f.balance);
    balance.classList.toggle('is-negative', f.balance < 0);

    const status = $('al-status');
    status.classList.toggle('is-error', f.balance < 0);
    if (!f.hasAllowance && f.spent > 0) status.textContent = `No allowance is recorded for this date, so ${formatMoney(f.spent)} of spending shows as a negative balance.`;
    else if (!f.hasAllowance) status.textContent = 'No allowance is recorded for this date.';
    else if (f.balance < 0) status.textContent = `Spending is ${formatMoney(-f.balance)} over the allowance for this date.`;
    else status.textContent = `${formatMoney(f.balance)} left for this date.`;

    const records = allowancesOn(date).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    $('al-records').replaceChildren(...records.map((a) =>
      el('li', { class: 'record-row' },
        el('div', { class: 'record-main' },
          el('p', { class: 'record-amount', text: formatMoney(a.amount) }),
          a.note ? el('p', { class: 'record-note', text: a.note }) : null),
        el('div', { class: 'row-actions' },
          iconButton('edit', `Edit allowance of ${formatMoney(a.amount)}`, 'edit', a.id),
          iconButton('trash', `Remove allowance of ${formatMoney(a.amount)}`, 'delete', a.id, 'is-danger')))));
    $('al-records-empty').hidden = records.length > 0;

    $('al-hint').textContent = f.hasAllowance
      ? `This date already has ${formatMoney(f.allowance)} recorded. Saving adds another record and asks you first. To change an existing record, use its edit button.`
      : 'Saving records this amount for the selected date.';

    setValue($('usual-amount'), String(state.settings.usualAllowance));
    renderLimitsForm('al');
  }

  function renderLimitsForm(prefix) {
    setValue($(`${prefix}-limit`), String(state.settings.dailyLimit));
    setValue($(`${prefix}-goal-period`), state.settings.goalPeriod);
    setValue($(`${prefix}-goal-amount`), String(state.settings.goalAmount));
  }

  function resetAllowanceForm() {
    const form = $('al-form');
    clearErrors(form);
    $('al-amount').value = state.settings.usualAllowance > 0 ? String(state.settings.usualAllowance) : '';
    $('al-note').value = '';
  }

  /* --- Expenses --- */
  function readExpenseFilters() {
    return {
      search: $('ex-search').value.trim().toLowerCase(),
      category: $('ex-filter-category').value,
      from: isISODate($('ex-filter-from').value) ? $('ex-filter-from').value : '',
      to: isISODate($('ex-filter-to').value) ? $('ex-filter-to').value : '',
      sort: $('ex-sort').value
    };
  }

  function getFilteredExpenses(filters) {
    const list = state.expenses.filter((e) =>
      (filters.category === 'all' || e.category === filters.category)
      && inRange(e.date, filters.from, filters.to)
      && (!filters.search || e.description.toLowerCase().includes(filters.search)));
    const sorters = {
      newest: compareNewest,
      oldest: (a, b) => -compareNewest(a, b),
      highest: (a, b) => (b.amount - a.amount) || compareNewest(a, b),
      lowest: (a, b) => (a.amount - b.amount) || compareNewest(a, b)
    };
    return list.sort(sorters[filters.sort] || compareNewest);
  }

  function renderExpenses() {
    const filters = readExpenseFilters();
    const rangeError = $('ex-range-error');
    const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
    rangeError.hidden = !badRange;
    rangeError.textContent = badRange ? 'The start date must be on or before the end date.' : '';

    const matches = badRange ? [] : getFilteredExpenses(filters);
    const shown = matches.slice(0, ui.expensesShown);

    $('ex-count').textContent = `${matches.length} of ${state.expenses.length} expense${state.expenses.length === 1 ? '' : 's'} shown. Total:`;
    $('ex-total').textContent = formatMoney(sumAmounts(matches));

    $('expense-list').replaceChildren(...shown.map((e) =>
      el('li', { class: 'expense-row' },
        el('div', { class: 'er-main' },
          el('p', { class: 'er-title', text: e.description }),
          el('p', { class: 'er-sub' }, chip(e.category), el('span', { text: formatDate(e.date) }), e.notes ? el('span', { class: 'er-note', text: e.notes }) : null)),
        el('p', { class: 'er-amount', text: formatMoney(e.amount) }),
        el('div', { class: 'row-actions' },
          iconButton('eye', `View details for ${e.description}`, 'view', e.id),
          iconButton('edit', `Edit ${e.description}`, 'edit', e.id),
          iconButton('trash', `Delete ${e.description}`, 'delete', e.id, 'is-danger')))));

    const empty = $('expense-empty');
    if (state.expenses.length === 0) {
      renderEmptyState(empty, {
        title: 'No expenses yet',
        text: 'Add your first expense and it will appear here, along with your totals on the dashboard.',
        actionText: 'Add expense',
        onAction: () => openExpenseDialog()
      });
    } else if (matches.length === 0) {
      renderEmptyState(empty, {
        title: badRange ? 'Check your date range' : 'No expenses match these filters',
        text: badRange ? 'Pick a start date that comes before the end date.' : 'Try a different search, category, or date range.',
        actionText: 'Clear filters',
        onAction: clearExpenseFilters
      });
    } else {
      empty.hidden = true;
    }
    $('ex-more').hidden = matches.length <= ui.expensesShown;
  }

  function clearExpenseFilters() {
    $('ex-search').value = '';
    $('ex-filter-category').value = 'all';
    $('ex-filter-from').value = '';
    $('ex-filter-to').value = '';
    $('ex-sort').value = 'newest';
    ui.expensesShown = PAGE_SIZE;
    renderExpenses();
  }

  /* --- Savings --- */
  function renderSavings() {
    $('sv-total').textContent = formatMoney(totalSaved());
    $('sv-total-note').textContent = state.goals.length
      ? `Across ${state.goals.length} goal${state.goals.length === 1 ? '' : 's'}. Savings are not counted as expenses.`
      : 'Create a goal to start tracking what you save.';

    renderPeriodGoal();

    const list = $('goal-list');
    list.replaceChildren(...state.goals.map(buildGoalCard));
    const empty = $('goal-empty');
    if (state.goals.length === 0) {
      renderEmptyState(empty, {
        title: 'No savings goals yet',
        text: 'Name something you are saving for, set a target, and record money as you set it aside.',
        actionText: 'Create a goal',
        onAction: () => openGoalDialog()
      });
    } else {
      empty.hidden = true;
    }
  }

  function renderPeriodGoal() {
    const host = $('period-goal');
    const { goalPeriod, goalAmount } = state.settings;
    const today = todayISO();
    const weekly = goalPeriod === 'weekly';
    const from = weekly ? startOfWeek(today) : startOfMonth(today);
    const to = weekly ? addDays(from, 6) : endOfMonth(today);
    const title = el('h2', { id: 'h-period', text: `${weekly ? 'Weekly' : 'Monthly'} savings goal` });

    if (!(goalAmount > 0)) {
      host.replaceChildren(
        title,
        el('p', { class: 'hint', text: 'No periodic goal is set. Choose how much you want to save each week or month.' }),
        el('a', { class: 'btn btn-ghost', href: '#settings', text: 'Set a goal in Settings' }));
      return;
    }
    const saved = netSavedBetween(from, to);
    const pct = Math.max(0, Math.min(100, Math.floor((saved / goalAmount) * 100)));
    const reached = toCents(saved) >= toCents(goalAmount);
    host.replaceChildren(
      title,
      el('p', { class: 'stat-figure', text: `${formatMoney(Math.max(0, saved))} of ${formatMoney(goalAmount)}` }),
      meter({ percent: reached ? 100 : pct, label: `${weekly ? 'Weekly' : 'Monthly'} savings progress`, valueText: `${pct}% of the ${goalPeriod} goal` }),
      el('p', { class: 'card-note', text: `${formatDate(from)} to ${formatDate(to)}. ${reached ? 'Goal reached for this period. Nice work.' : `${formatMoney(goalAmount - Math.max(0, saved))} still to save.`}` }));
  }

  function buildGoalCard(goal) {
    const saved = goalSaved(state, goal.id);
    const reached = toCents(saved) >= toCents(goal.target);
    const pct = reached ? 100 : Math.max(0, Math.min(99, Math.floor((saved / goal.target) * 100)));
    const remaining = Math.max(0, (toCents(goal.target) - toCents(saved)) / 100);

    const withdraw = el('button', { class: 'btn btn-ghost btn-small', type: 'button', dataset: { action: 'withdraw', id: goal.id }, text: 'Withdraw' });
    if (saved <= 0) {
      withdraw.disabled = true;
      withdraw.setAttribute('title', 'Nothing saved to withdraw yet');
    }

    return el('li', { class: `card goal-card${reached ? ' is-reached' : ''}` },
      el('div', { class: 'goal-top' },
        el('h3', { class: 'goal-name', text: goal.name }),
        el('div', { class: 'row-actions' },
          iconButton('edit', `Edit goal ${goal.name}`, 'edit', goal.id),
          iconButton('trash', `Delete goal ${goal.name}`, 'delete', goal.id, 'is-danger'))),
      el('div', {},
        el('p', { class: 'goal-saved', text: formatMoney(saved) }),
        el('p', { class: 'goal-of', text: `of ${formatMoney(goal.target)} target` })),
      meter({ percent: pct, label: `Progress toward ${goal.name}`, valueText: `${pct}% complete` }),
      el('p', { class: 'card-note', text: `${pct}% complete. ${reached ? 'Target met.' : `${formatMoney(remaining)} still needed.`}` }),
      reached
        ? el('p', { class: 'goal-reached' }, icon('star'), el('span', { text: `Goal reached! You saved ${formatMoney(saved)} for ${goal.name}. Well done.` }))
        : null,
      el('div', { class: 'goal-actions' },
        el('button', { class: 'btn btn-primary btn-small', type: 'button', dataset: { action: 'deposit', id: goal.id }, text: 'Add savings' }),
        withdraw));
  }

  /* --- History and reports --- */
  function getHistoryRange() {
    const from = $('hs-from').value;
    const to = $('hs-to').value;
    const cleanFrom = isISODate(from) ? from : '';
    const cleanTo = isISODate(to) ? to : '';
    return { from: cleanFrom, to: cleanTo, invalid: Boolean(cleanFrom && cleanTo && cleanFrom > cleanTo) };
  }

  function applyHistoryPreset(preset) {
    const today = todayISO();
    const select = $('hs-preset');
    select.value = preset;
    if (preset === 'this-month') { $('hs-from').value = startOfMonth(today); $('hs-to').value = endOfMonth(today); }
    else if (preset === 'last-7') { $('hs-from').value = addDays(today, -6); $('hs-to').value = today; }
    else if (preset === 'last-30') { $('hs-from').value = addDays(today, -29); $('hs-to').value = today; }
    else if (preset === 'all') { $('hs-from').value = ''; $('hs-to').value = ''; }
  }

  function buildHistoryRecords() {
    const goalName = new Map(state.goals.map((g) => [g.id, g.name]));
    const rows = [];
    for (const a of state.allowances) {
      rows.push({ kind: 'allowance', date: a.date, createdAt: a.createdAt, title: 'Allowance received', note: a.note, category: 'Allowance', amount: a.amount, sign: 1 });
    }
    for (const e of state.expenses) {
      rows.push({ kind: 'expense', date: e.date, createdAt: e.createdAt, title: e.description, note: e.notes, category: e.category, amount: e.amount, sign: -1 });
    }
    for (const s of state.savingsActivities) {
      const name = goalName.get(s.goalId) || 'a goal';
      rows.push({
        kind: 'savings', date: s.date, createdAt: s.createdAt,
        title: s.type === 'deposit' ? `Saved toward ${name}` : `Withdrew from ${name}`,
        note: s.note, category: 'Savings', amount: s.amount, sign: s.type === 'deposit' ? 1 : -1
      });
    }
    return rows.sort(compareNewest);
  }

  function periodFor(date, group) {
    if (group === 'weekly') {
      const start = startOfWeek(date);
      return { key: start, label: `Week of ${formatDate(start)}` };
    }
    if (group === 'monthly') return { key: date.slice(0, 7), label: formatDate(date, 'month') };
    return { key: date, label: `${dateFormats.weekday.format(parseISODate(date))}, ${formatDate(date)}` };
  }

  function computeReport(range) {
    const group = $('hs-group').value;
    const totals = { allowance: 0, expenses: 0, saved: 0 };
    const periods = new Map();
    const categories = new Map();
    let count = 0;

    const bucket = (date) => {
      const p = periodFor(date, group);
      if (!periods.has(p.key)) periods.set(p.key, { key: p.key, label: p.label, allowance: 0, expenses: 0, saved: 0 });
      return periods.get(p.key);
    };

    for (const a of state.allowances) {
      if (!inRange(a.date, range.from, range.to)) continue;
      count += 1;
      totals.allowance += toCents(a.amount);
      bucket(a.date).allowance += toCents(a.amount);
    }
    for (const e of state.expenses) {
      if (!inRange(e.date, range.from, range.to)) continue;
      count += 1;
      totals.expenses += toCents(e.amount);
      bucket(e.date).expenses += toCents(e.amount);
      const entry = categories.get(e.category) || { count: 0, cents: 0 };
      entry.count += 1;
      entry.cents += toCents(e.amount);
      categories.set(e.category, entry);
    }
    for (const s of state.savingsActivities) {
      if (!inRange(s.date, range.from, range.to)) continue;
      count += 1;
      const cents = s.type === 'deposit' ? toCents(s.amount) : -toCents(s.amount);
      totals.saved += cents;
      bucket(s.date).saved += cents;
    }
    return {
      totals,
      count,
      periods: [...periods.values()].sort((a, b) => (a.key < b.key ? 1 : -1)),
      categories: [...categories.entries()].sort((a, b) => b[1].cents - a[1].cents)
    };
  }

  function renderHistory() {
    const range = getHistoryRange();
    const rangeError = $('hs-range-error');
    rangeError.hidden = !range.invalid;
    rangeError.textContent = range.invalid ? 'The start date must be on or before the end date.' : '';

    const groupLabels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
    $('hs-periods-title').textContent = `${groupLabels[$('hs-group').value] || 'Daily'} summary`;

    let rangeLabel = 'All dates';
    if (range.from && range.to) rangeLabel = `${formatDate(range.from)} to ${formatDate(range.to)}`;
    else if (range.from) rangeLabel = `From ${formatDate(range.from)}`;
    else if (range.to) rangeLabel = `Up to ${formatDate(range.to)}`;
    $('hs-range-label').textContent = rangeLabel;

    const report = range.invalid
      ? { totals: { allowance: 0, expenses: 0, saved: 0 }, count: 0, periods: [], categories: [] }
      : computeReport(range);

    $('hs-allowance').textContent = formatMoney(report.totals.allowance / 100);
    $('hs-expenses').textContent = formatMoney(report.totals.expenses / 100);
    const net = (report.totals.allowance - report.totals.expenses) / 100;
    const netNode = $('hs-net');
    netNode.textContent = formatMoney(net);
    netNode.classList.toggle('is-negative', net < 0);
    $('hs-saved').textContent = formatMoney(report.totals.saved / 100);

    $('hs-report-empty').hidden = report.count > 0;
    $('hs-report-tables').hidden = report.count === 0;

    const money = (cents) => formatMoney(cents / 100);
    $('hs-periods').replaceChildren(...report.periods.map((p) => {
      const balance = p.allowance - p.expenses;
      return el('tr', {},
        el('th', { scope: 'row', text: p.label }),
        el('td', { class: 'num', text: money(p.allowance) }),
        el('td', { class: 'num', text: money(p.expenses) }),
        el('td', { class: `num${balance < 0 ? ' is-negative' : ''}`, text: money(balance) }),
        el('td', { class: 'num', text: money(p.saved) }));
    }));

    $('hs-categories').replaceChildren(...report.categories.map(([category, entry]) =>
      el('tr', {},
        el('th', { scope: 'row' }, chip(category)),
        el('td', { class: 'num', text: String(entry.count) }),
        el('td', { class: 'num', text: money(entry.cents) }),
        el('td', { class: 'num', text: report.totals.expenses > 0 ? `${Math.round((entry.cents / report.totals.expenses) * 100)}%` : '0%' }))));
    if (report.categories.length === 0) {
      $('hs-categories').replaceChildren(el('tr', {}, el('td', { colspan: 4, text: 'No expenses in this date range.' })));
    }

    renderHistoryList(range);
  }

  function renderHistoryList(range) {
    const type = $('hs-type').value;
    const category = $('hs-category').value;
    const search = $('hs-search').value.trim().toLowerCase();

    const rows = range.invalid ? [] : buildHistoryRecords().filter((r) =>
      inRange(r.date, range.from, range.to)
      && (type === 'all' || r.kind === type)
      && (category === 'all' || (r.kind === 'expense' && r.category === category))
      && (!search || r.title.toLowerCase().includes(search) || (r.note || '').toLowerCase().includes(search)));
    const shown = rows.slice(0, ui.historyShown);

    $('hs-count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} match`;
    $('history-list').replaceChildren(...shown.map((r) => {
      const prefix = r.sign > 0 ? '+' : '\u2212';
      const amountClass = r.kind === 'allowance' ? ' is-in' : r.kind === 'savings' ? ' is-saving' : '';
      return el('li', { class: 'history-row' },
        el('div', { class: 'er-main' },
          el('p', { class: 'er-title', text: r.title }),
          el('p', { class: 'er-sub' }, chip(r.category), el('span', { text: formatDate(r.date) }), r.note ? el('span', { class: 'er-note', text: r.note }) : null)),
        el('p', { class: `er-amount${amountClass}`, text: `${prefix}${formatMoney(r.amount)}` }));
    }));

    const empty = $('history-empty');
    if (rows.length === 0) {
      const anyData = state.allowances.length + state.expenses.length + state.savingsActivities.length > 0;
      renderEmptyState(empty, {
        title: anyData ? 'No records match' : 'No records yet',
        text: anyData ? 'Try a wider date range or clear the filters.' : 'Allowance, expenses, and savings you record will be listed here.',
        actionText: anyData ? 'Reset filters' : null,
        onAction: resetHistoryFilters
      });
    } else {
      empty.hidden = true;
    }
    $('hs-more').hidden = rows.length <= ui.historyShown;
  }

  function resetHistoryFilters() {
    $('hs-type').value = 'all';
    $('hs-category').value = 'all';
    $('hs-search').value = '';
    $('hs-group').value = 'daily';
    applyHistoryPreset('this-month');
    ui.historyShown = PAGE_SIZE;
    renderHistory();
  }

  /* --- Settings --- */
  function renderSettings() {
    setValue($('st-currency'), state.settings.currency);
    $('theme-dark').checked = state.settings.theme === 'dark';
    $('theme-light').checked = state.settings.theme === 'light';
    renderLimitsForm('st');
  }

  /* ---------- 10. Feature handlers ---------- */

  /* --- Expenses --- */
  function openExpenseDialog(expense) {
    const form = $('expense-form');
    clearErrors(form);
    form.reset();
    $('ex-id').value = expense ? expense.id : '';
    $('ex-dialog-title').textContent = expense ? 'Edit expense' : 'Add expense';
    $('ex-submit').textContent = expense ? 'Save changes' : 'Save expense';
    $('ex-description').value = expense ? expense.description : '';
    $('ex-amount').value = expense ? String(expense.amount) : '';
    $('ex-category').value = expense ? expense.category : CATEGORIES[0];
    $('ex-date').value = expense ? expense.date : todayISO();
    $('ex-notes').value = expense ? expense.notes : '';
    openDialog($('expense-dialog'));
    $('ex-description').focus();
  }

  function handleExpenseSubmit(form) {
    clearErrors(form);
    const description = validTextField($('ex-description'), 'a description', 80, true);
    const amount = parseAmount($('ex-amount'));
    if (amount.error) setError($('ex-amount'), amount.error);
    const dateOk = validDateField($('ex-date'));
    const category = $('ex-category').value;
    if (!CATEGORIES.includes(category)) setError($('ex-category'), 'Choose a category.');
    const notes = validTextField($('ex-notes'), 'notes', 300, false);

    if (description === null || amount.error || !dateOk || !CATEGORIES.includes(category) || notes === null) {
      focusFirstInvalid(form);
      return;
    }

    const date = $('ex-date').value;
    const id = $('ex-id').value;
    const existing = id ? state.expenses.find((e) => e.id === id) : null;
    if (id && !existing) {
      $('expense-dialog').close();
      showToast('error', 'That expense no longer exists, so nothing was changed.');
      renderAll();
      return;
    }

    trackWarnings([existing ? existing.date : null, date], () => {
      if (existing) {
        Object.assign(existing, { description, amount: amount.value, category, date, notes });
      } else {
        state.expenses.push({ id: newId(), description, amount: amount.value, category, date, notes, createdAt: new Date().toISOString() });
      }
      showToast('success', existing ? 'Expense updated.' : 'Expense added.');
    });
    commit();
    $('expense-dialog').close();
  }

  function showExpenseDetails(id) {
    const expense = state.expenses.find((e) => e.id === id);
    if (!expense) return;
    ui.detailId = id;
    $('dt-title').textContent = expense.description;
    $('dt-amount').textContent = formatMoney(expense.amount);
    $('dt-category').textContent = expense.category;
    $('dt-date').textContent = formatDate(expense.date, 'long');
    $('dt-notes').textContent = expense.notes || 'No notes';
    $('dt-created').textContent = dateFormats.stamp.format(new Date(expense.createdAt));
    openDialog($('detail-dialog'));
  }

  async function deleteExpense(id) {
    const expense = state.expenses.find((e) => e.id === id);
    if (!expense) return;
    const ok = await confirmAction({
      title: 'Delete this expense?',
      message: `"${expense.description}" (${formatMoney(expense.amount)} on ${formatDate(expense.date)}) will be removed. This cannot be undone.`,
      confirmText: 'Delete expense',
      danger: true
    });
    if (!ok) return;
    state.expenses = state.expenses.filter((e) => e.id !== id);
    commit();
    showToast('success', 'Expense deleted.');
  }

  /* --- Allowance --- */
  function changeAllowanceDate(date) {
    if (!isISODate(date)) { setValue($('al-date'), ui.allowanceDate); return; }
    ui.allowanceDate = date;
    resetAllowanceForm();
    renderAllowance();
  }

  async function handleAllowanceSubmit(form) {
    clearErrors(form);
    const amount = parseAmount($('al-amount'));
    if (amount.error) setError($('al-amount'), amount.error);
    const note = validTextField($('al-note'), 'a note', 200, false);
    if (amount.error || note === null) { focusFirstInvalid(form); return; }

    const date = ui.allowanceDate;
    const current = dayFigures(date);
    if (current.hasAllowance) {
      const ok = await confirmAction({
        title: 'Add another allowance record?',
        message: `${formatDate(date)} already has ${formatMoney(current.allowance)} recorded. Adding ${formatMoney(amount.value)} brings the total to ${formatMoney(current.allowance + amount.value)}. Existing records stay as they are.`,
        confirmText: 'Add record'
      });
      if (!ok) return;
    }
    trackWarnings([date], () => {
      state.allowances.push({ id: newId(), date, amount: amount.value, note, createdAt: new Date().toISOString() });
      showToast('success', `Allowance of ${formatMoney(amount.value)} recorded for ${formatDate(date)}.`);
    });
    commit();
    resetAllowanceForm();
  }

  function openAllowanceEdit(id) {
    const record = state.allowances.find((a) => a.id === id);
    if (!record) return;
    const form = $('allowance-edit-form');
    clearErrors(form);
    $('ae-id').value = record.id;
    $('ae-amount').value = String(record.amount);
    $('ae-date').value = record.date;
    $('ae-note').value = record.note;
    openDialog($('allowance-dialog'));
    $('ae-amount').focus();
  }

  function handleAllowanceEditSubmit(form) {
    clearErrors(form);
    const amount = parseAmount($('ae-amount'));
    if (amount.error) setError($('ae-amount'), amount.error);
    const dateOk = validDateField($('ae-date'));
    const note = validTextField($('ae-note'), 'a note', 200, false);
    if (amount.error || !dateOk || note === null) { focusFirstInvalid(form); return; }

    const record = state.allowances.find((a) => a.id === $('ae-id').value);
    if (!record) {
      $('allowance-dialog').close();
      showToast('error', 'That allowance record no longer exists, so nothing was changed.');
      renderAll();
      return;
    }
    const date = $('ae-date').value;
    trackWarnings([record.date, date], () => {
      Object.assign(record, { amount: amount.value, date, note });
      showToast('success', 'Allowance record updated.');
    });
    ui.allowanceDate = date;
    commit();
    $('allowance-dialog').close();
  }

  async function deleteAllowance(id) {
    const record = state.allowances.find((a) => a.id === id);
    if (!record) return;
    const ok = await confirmAction({
      title: 'Remove this allowance record?',
      message: `${formatMoney(record.amount)} recorded for ${formatDate(record.date)} will be removed. Your expenses stay as they are, so that day's balance will change.`,
      confirmText: 'Remove record',
      danger: true
    });
    if (!ok) return;
    trackWarnings([record.date], () => {
      state.allowances = state.allowances.filter((a) => a.id !== id);
      showToast('success', 'Allowance record removed.');
    });
    commit();
  }

  function handleUsualSubmit(form) {
    clearErrors(form);
    const input = $('usual-amount');
    const amount = parseAmount(input, { allowZero: true });
    if (amount.error) { setError(input, amount.error); focusFirstInvalid(form); return; }
    state.settings.usualAllowance = amount.value;
    commit();
    resetAllowanceForm();
    showToast('success', amount.value > 0 ? `Usual allowance set to ${formatMoney(amount.value)}. It will pre-fill the form.` : 'Usual allowance cleared.');
  }

  function handleLimitsSubmit(prefix, form) {
    clearErrors(form);
    const limitInput = $(`${prefix}-limit`);
    const goalInput = $(`${prefix}-goal-amount`);
    const period = $(`${prefix}-goal-period`).value;
    const limit = parseAmount(limitInput, { allowZero: true });
    const goal = parseAmount(goalInput, { allowZero: true });
    if (limit.error) setError(limitInput, limit.error);
    if (goal.error) setError(goalInput, goal.error);
    if (limit.error || goal.error || (period !== 'weekly' && period !== 'monthly')) { focusFirstInvalid(form); return; }

    trackWarnings([todayISO()], () => {
      state.settings.dailyLimit = limit.value;
      state.settings.goalPeriod = period;
      state.settings.goalAmount = goal.value;
      showToast('success', 'Spending limit and savings goal saved.');
    });
    commit();
  }

  /* --- Savings --- */
  function openGoalDialog(goal) {
    const form = $('goal-form');
    clearErrors(form);
    form.reset();
    $('goal-id').value = goal ? goal.id : '';
    $('goal-dialog-title').textContent = goal ? 'Edit savings goal' : 'New savings goal';
    $('goal-name').value = goal ? goal.name : '';
    $('goal-target').value = goal ? String(goal.target) : '';
    openDialog($('goal-dialog'));
    $('goal-name').focus();
  }

  function handleGoalSubmit(form) {
    clearErrors(form);
    const id = $('goal-id').value;
    const name = validTextField($('goal-name'), 'a goal name', 60, true);
    const target = parseAmount($('goal-target'));
    if (target.error) setError($('goal-target'), target.error);
    if (name !== null && state.goals.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) {
      setError($('goal-name'), 'You already have a goal with this name.');
    }
    if (name === null || target.error || form.querySelector('[aria-invalid="true"]')) { focusFirstInvalid(form); return; }

    const existing = id ? state.goals.find((g) => g.id === id) : null;
    if (id && !existing) {
      $('goal-dialog').close();
      showToast('error', 'That goal no longer exists, so nothing was changed.');
      renderAll();
      return;
    }
    if (existing) {
      const saved = goalSaved(state, existing.id);
      const wasReached = toCents(saved) >= toCents(existing.target);
      Object.assign(existing, { name, target: target.value });
      showToast('success', 'Savings goal updated.');
      if (!wasReached && toCents(saved) >= toCents(target.value)) {
        showToast('success', `Goal reached! You have already saved ${formatMoney(saved)} for ${name}.`);
      }
    } else {
      state.goals.push({ id: newId(), name, target: target.value, createdAt: new Date().toISOString() });
      showToast('success', 'Savings goal created.');
    }
    commit();
    $('goal-dialog').close();
  }

  async function deleteGoal(id) {
    const goal = state.goals.find((g) => g.id === id);
    if (!goal) return;
    const activityCount = state.savingsActivities.filter((a) => a.goalId === id).length;
    const ok = await confirmAction({
      title: 'Delete this savings goal?',
      message: `"${goal.name}" and its ${activityCount} savings record${activityCount === 1 ? '' : 's'} (${formatMoney(goalSaved(state, id))} saved) will be removed from your totals. Your allowance and expenses are not affected.`,
      confirmText: 'Delete goal',
      danger: true
    });
    if (!ok) return;
    state.goals = state.goals.filter((g) => g.id !== id);
    state.savingsActivities = state.savingsActivities.filter((a) => a.goalId !== id);
    commit();
    showToast('success', 'Savings goal deleted.');
  }

  const currentSavingType = () => ($('sv-type-withdrawal').checked ? 'withdrawal' : 'deposit');

  function updateSavingDialogMode() {
    const goal = state.goals.find((g) => g.id === $('sv-goal-id').value);
    if (!goal) return;
    const type = currentSavingType();
    const saved = goalSaved(state, goal.id);
    $('sv-dialog-title').textContent = type === 'deposit' ? `Add savings to ${goal.name}` : `Withdraw from ${goal.name}`;
    $('sv-info').textContent = type === 'deposit'
      ? `Saved so far: ${formatMoney(saved)} of ${formatMoney(goal.target)}.`
      : `Available to withdraw: ${formatMoney(saved)}.`;
    $('sv-expense-wrap').hidden = type !== 'deposit';
    if (type !== 'deposit') $('sv-as-expense').checked = false;
    $('sv-submit').textContent = type === 'deposit' ? 'Save deposit' : 'Save withdrawal';
  }

  function openSavingDialog(goalId, type) {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const form = $('saving-form');
    clearErrors(form);
    form.reset();
    $('sv-goal-id').value = goalId;
    $(type === 'withdrawal' ? 'sv-type-withdrawal' : 'sv-type-deposit').checked = true;
    $('sv-date').value = todayISO();
    updateSavingDialogMode();
    openDialog($('saving-dialog'));
    $('sv-amount').focus();
  }

  function handleSavingSubmit(form) {
    clearErrors(form);
    const goal = state.goals.find((g) => g.id === $('sv-goal-id').value);
    if (!goal) {
      $('saving-dialog').close();
      showToast('error', 'That goal no longer exists, so nothing was recorded.');
      renderAll();
      return;
    }
    const type = currentSavingType();
    const amount = parseAmount($('sv-amount'));
    if (amount.error) setError($('sv-amount'), amount.error);
    const dateOk = validDateField($('sv-date'));
    const note = validTextField($('sv-note'), 'a note', 200, false);
    const savedBefore = goalSaved(state, goal.id);
    if (!amount.error && type === 'withdrawal' && toCents(amount.value) > toCents(savedBefore)) {
      setError($('sv-amount'), `You only have ${formatMoney(savedBefore)} saved in this goal.`);
    }
    if (form.querySelector('[aria-invalid="true"]') || !dateOk || note === null) { focusFirstInvalid(form); return; }

    const date = $('sv-date').value;
    const alsoExpense = type === 'deposit' && $('sv-as-expense').checked;
    trackWarnings([alsoExpense ? date : null], () => {
      state.savingsActivities.push({ id: newId(), goalId: goal.id, type, amount: amount.value, date, note, createdAt: new Date().toISOString() });
      if (alsoExpense) {
        state.expenses.push({
          id: newId(),
          description: `Savings deposit: ${goal.name}`,
          amount: amount.value,
          category: 'Other',
          date,
          notes: 'Recorded as an expense when this savings deposit was saved.',
          createdAt: new Date().toISOString()
        });
      }
      showToast('success', type === 'deposit'
        ? `Added ${formatMoney(amount.value)} to ${goal.name}.${alsoExpense ? ' It was also recorded as an expense.' : ''}`
        : `Withdrew ${formatMoney(amount.value)} from ${goal.name}.`);
    });
    const savedAfter = goalSaved(state, goal.id);
    if (toCents(savedBefore) < toCents(goal.target) && toCents(savedAfter) >= toCents(goal.target)) {
      showToast('success', `Goal reached! You saved ${formatMoney(savedAfter)} for ${goal.name}. Well done.`);
    }
    commit();
    $('saving-dialog').close();
  }

  /* --- Settings, backup, reset --- */
  function exportBackup() {
    const payload = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        settings: state.settings,
        allowances: state.allowances,
        expenses: state.expenses,
        goals: state.goals,
        savingsActivities: state.savingsActivities
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `studentbudget-backup-${todayISO()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', 'Backup file created. Keep it somewhere safe.');
  }

  function setImportStatus(kind, message) {
    const node = $('import-status');
    node.textContent = message;
    node.classList.toggle('is-error', kind === 'error');
    node.classList.toggle('is-success', kind === 'success');
  }

  async function handleImportFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    setImportStatus('', '');

    const fail = (message) => {
      setImportStatus('error', `${message} Your current data was not changed.`);
      showToast('error', `Import failed. ${message}`);
    };

    if (file.size > MAX_IMPORT_BYTES) { fail('That file is too large to be a StudentBudget backup.'); return; }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_) {
      fail('The file could not be read as JSON.');
      return;
    }
    let imported;
    try {
      imported = parseBackup(parsed);
    } catch (error) {
      fail(error.message);
      return;
    }

    const ok = await confirmAction({
      title: 'Replace your current data?',
      message: `This backup has ${imported.allowances.length} allowance record${imported.allowances.length === 1 ? '' : 's'}, ${imported.expenses.length} expense${imported.expenses.length === 1 ? '' : 's'}, ${imported.goals.length} savings goal${imported.goals.length === 1 ? '' : 's'}, and ${imported.savingsActivities.length} savings record${imported.savingsActivities.length === 1 ? '' : 's'}. Importing replaces everything saved in this browser right now. Export a backup first if you want to keep it.`,
      confirmText: 'Replace data',
      danger: true
    });
    if (!ok) { setImportStatus('', 'Import cancelled. Nothing was changed.'); return; }

    const previous = state;
    state = imported;
    if (!persist(true)) {
      state = previous;
      fail('The backup could not be saved in this browser.');
      return;
    }
    refreshUiAfterDataReplace();
    renderAll();
    setImportStatus('success', 'Backup imported. Your data has been restored.');
    showToast('success', 'Backup imported successfully.');
  }

  function refreshUiAfterDataReplace() {
    ui.allowanceDate = todayISO();
    ui.expensesShown = PAGE_SIZE;
    ui.historyShown = PAGE_SIZE;
    clearExpenseFiltersQuietly();
    $('hs-type').value = 'all';
    $('hs-category').value = 'all';
    $('hs-search').value = '';
    $('hs-group').value = 'daily';
    applyHistoryPreset('this-month');
    resetAllowanceForm();
  }

  function clearExpenseFiltersQuietly() {
    $('ex-search').value = '';
    $('ex-filter-category').value = 'all';
    $('ex-filter-from').value = '';
    $('ex-filter-to').value = '';
    $('ex-sort').value = 'newest';
  }

  function performReset() {
    state = createDefaultState();
    try { window.localStorage.removeItem(UNREADABLE_KEY); } catch (_) { /* ignore */ }
    persist();
    refreshUiAfterDataReplace();
    renderAll();
    setImportStatus('', '');
    showToast('success', 'All data was reset.');
  }

  /* ---------- 11. Navigation ---------- */
  function viewFromHash() {
    const name = window.location.hash.replace('#', '');
    return Object.prototype.hasOwnProperty.call(VIEWS, name) ? name : null;
  }

  function showView(name, { focusHeading = false } = {}) {
    document.querySelectorAll('[data-view]').forEach((section) => { section.hidden = section.dataset.view !== name; });
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${VIEWS[name]} - StudentBudget`;
    closeNav(false);
    if (focusHeading) {
      const heading = document.querySelector(`[data-view="${name}"] h1`);
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function openNav() {
    document.body.classList.add('nav-open');
    $('nav-toggle').setAttribute('aria-expanded', 'true');
    $('nav-toggle').setAttribute('aria-label', 'Close menu');
    const first = document.querySelector('.nav-link');
    if (first) first.focus();
  }

  function closeNav(returnFocus = true) {
    if (!document.body.classList.contains('nav-open')) return;
    document.body.classList.remove('nav-open');
    $('nav-toggle').setAttribute('aria-expanded', 'false');
    $('nav-toggle').setAttribute('aria-label', 'Open menu');
    if (returnFocus) $('nav-toggle').focus();
  }

  /* ---------- 12. Start-up ---------- */
  function populateControls() {
    const categoryOptions = CATEGORIES.map((c) => [c, c]);
    fillSelect($('ex-category'), categoryOptions);
    fillSelect($('ex-filter-category'), [['all', 'All categories'], ...categoryOptions]);
    fillSelect($('hs-category'), [['all', 'All expense categories'], ...categoryOptions]);
    fillSelect($('st-currency'), CURRENCIES.map(([code, name]) => [code, `${name} (${currencySymbol(code)})`]));
  }

  function bindForm(id, handler) {
    const form = $(id);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      guarded(form, () => handler(form));
    });
  }

  function bindActionList(listId, handlers) {
    $(listId).addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;
      const handler = handlers[button.dataset.action];
      if (handler) handler(button.dataset.id);
    });
  }

  function bindEvents() {
    // Navigation
    $('nav-toggle').addEventListener('click', () => {
      if (document.body.classList.contains('nav-open')) closeNav(); else openNav();
    });
    $('nav-scrim').addEventListener('click', () => closeNav());
    document.querySelectorAll('[data-nav]').forEach((link) => link.addEventListener('click', () => closeNav(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeNav();
    });
    window.matchMedia('(min-width: 900px)').addEventListener('change', (query) => { if (query.matches) closeNav(false); });
    window.addEventListener('hashchange', () => {
      const name = viewFromHash();
      if (name) showView(name, { focusHeading: true });
    });
    $('skip-link').addEventListener('click', (event) => {
      event.preventDefault();
      $('main').focus();
    });

    // Generic dialog and navigation buttons
    document.addEventListener('click', (event) => {
      const closeButton = event.target.closest('[data-close-dialog]');
      if (closeButton) {
        const dialog = closeButton.closest('dialog');
        if (dialog) dialog.close();
      }
    });
    $('confirm-ok').addEventListener('click', () => $('confirm-dialog').close('confirm'));
    $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close('cancel'));

    // Dashboard
    $('dash-add-expense').addEventListener('click', () => openExpenseDialog());
    $('dash-empty-expense').addEventListener('click', () => openExpenseDialog());
    bindActionList('recent-list', { view: showExpenseDetails });

    // Expenses
    $('ex-add').addEventListener('click', () => openExpenseDialog());
    ['ex-search', 'ex-filter-category', 'ex-filter-from', 'ex-filter-to', 'ex-sort'].forEach((id) => {
      ['input', 'change'].forEach((name) => $(id).addEventListener(name, () => { ui.expensesShown = PAGE_SIZE; renderExpenses(); }));
    });
    $('ex-clear-filters').addEventListener('click', clearExpenseFilters);
    $('ex-more').addEventListener('click', () => { ui.expensesShown += PAGE_SIZE; renderExpenses(); });
    bindForm('expense-form', handleExpenseSubmit);
    bindActionList('expense-list', {
      view: showExpenseDetails,
      edit: (id) => { const e = state.expenses.find((x) => x.id === id); if (e) openExpenseDialog(e); },
      delete: deleteExpense
    });
    $('dt-edit').addEventListener('click', () => {
      const expense = state.expenses.find((e) => e.id === ui.detailId);
      $('detail-dialog').close();
      if (expense) openExpenseDialog(expense);
    });
    $('dt-delete').addEventListener('click', () => {
      const id = ui.detailId;
      $('detail-dialog').close();
      deleteExpense(id);
    });

    // Allowance
    $('al-date').addEventListener('change', (event) => changeAllowanceDate(event.target.value));
    $('al-prev').addEventListener('click', () => changeAllowanceDate(addDays(ui.allowanceDate, -1)));
    $('al-next').addEventListener('click', () => changeAllowanceDate(addDays(ui.allowanceDate, 1)));
    $('al-today').addEventListener('click', () => changeAllowanceDate(todayISO()));
    bindForm('al-form', handleAllowanceSubmit);
    bindForm('usual-form', handleUsualSubmit);
    bindForm('allowance-edit-form', handleAllowanceEditSubmit);
    bindActionList('al-records', { edit: openAllowanceEdit, delete: deleteAllowance });
    bindForm('al-limits-form', (form) => handleLimitsSubmit('al', form));

    // Savings
    $('goal-add').addEventListener('click', () => openGoalDialog());
    bindForm('goal-form', handleGoalSubmit);
    bindForm('saving-form', handleSavingSubmit);
    bindActionList('goal-list', {
      deposit: (id) => openSavingDialog(id, 'deposit'),
      withdraw: (id) => openSavingDialog(id, 'withdrawal'),
      edit: (id) => { const g = state.goals.find((x) => x.id === id); if (g) openGoalDialog(g); },
      delete: deleteGoal
    });
    $('sv-type-deposit').addEventListener('change', updateSavingDialogMode);
    $('sv-type-withdrawal').addEventListener('change', updateSavingDialogMode);

    // History
    $('hs-preset').addEventListener('change', () => {
      applyHistoryPreset($('hs-preset').value);
      ui.historyShown = PAGE_SIZE;
      renderHistory();
    });
    ['hs-from', 'hs-to'].forEach((id) => {
      ['input', 'change'].forEach((name) => $(id).addEventListener(name, () => {
        $('hs-preset').value = 'custom';
        ui.historyShown = PAGE_SIZE;
        renderHistory();
      }));
    });
    ['hs-type', 'hs-category', 'hs-search', 'hs-group'].forEach((id) => {
      ['input', 'change'].forEach((name) => $(id).addEventListener(name, () => { ui.historyShown = PAGE_SIZE; renderHistory(); }));
    });
    $('hs-clear').addEventListener('click', resetHistoryFilters);
    $('hs-more').addEventListener('click', () => { ui.historyShown += PAGE_SIZE; renderHistory(); });

    // Settings
    $('st-currency').addEventListener('change', (event) => {
      state.settings.currency = event.target.value;
      commit();
      showToast('success', `Currency changed to ${event.target.selectedOptions[0].textContent}.`);
    });
    document.querySelectorAll('input[name="theme"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        state.settings.theme = radio.value;
        commit();
      });
    });
    bindForm('st-limits-form', (form) => handleLimitsSubmit('st', form));
    $('export-btn').addEventListener('click', exportBackup);
    $('import-file').addEventListener('change', (event) => handleImportFile(event.target));

    $('reset-btn').addEventListener('click', () => {
      $('reset-input').value = '';
      $('reset-ok').disabled = true;
      $('reset-dialog').returnValue = '';
      openDialog($('reset-dialog'));
      $('reset-input').focus();
    });
    $('reset-input').addEventListener('input', () => { $('reset-ok').disabled = $('reset-input').value.trim() !== 'RESET'; });
    $('reset-cancel').addEventListener('click', () => $('reset-dialog').close('cancel'));
    $('reset-ok').addEventListener('click', () => {
      if ($('reset-input').value.trim() === 'RESET') $('reset-dialog').close('confirm');
    });
    $('reset-dialog').addEventListener('close', () => {
      if ($('reset-dialog').returnValue === 'confirm') performReset();
    });

    // Other tabs changing the same saved data
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      try {
        state = event.newValue === null ? createDefaultState() : normalizeState(JSON.parse(event.newValue), false).state;
        renderAll();
      } catch (_) { /* ignore unreadable data from another tab */ }
    });
  }

  function handleDateChange() {
    const today = todayISO();
    if (today === ui.lastToday) return;
    if (ui.allowanceDate === ui.lastToday) ui.allowanceDate = today;
    ui.lastToday = today;
    const preset = $('hs-preset').value;
    if (preset !== 'custom') applyHistoryPreset(preset);
    renderAll();
  }

  function init() {
    populateControls();
    const loaded = loadStoredState();
    state = loaded.state;
    ui.allowanceDate = todayISO();
    ui.lastToday = todayISO();
    applyHistoryPreset('this-month');
    bindEvents();
    resetAllowanceForm();
    renderAll();
    showView(viewFromHash() || 'dashboard');
    loaded.notices.forEach((notice) => showToast(notice.type, notice.message));

    // Keep "today" correct if the page stays open past midnight.
    window.setInterval(handleDateChange, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) handleDateChange(); });
  }

  init();
})();