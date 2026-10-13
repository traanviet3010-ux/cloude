import { initDashboard } from './dashboard.js';

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  return body;
}

function showLogin() {
  $('loginView').classList.remove('hidden');
  $('dashboard').classList.add('hidden');
}

function showDashboard() {
  $('loginView').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  initDashboard(api, showLogin);
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginMessage').textContent = 'Đang đăng nhập...';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('loginPassword').value }) });
    $('loginPassword').value = '';
    $('loginMessage').textContent = '';
    showDashboard();
  } catch (error) {
    $('loginMessage').textContent = error.message;
    $('loginMessage').className = 'message bad';
  }
});

(async () => {
  try {
    const me = await api('/api/me');
    if (me.ok) return showDashboard();
  } catch {}
  showLogin();
})();
