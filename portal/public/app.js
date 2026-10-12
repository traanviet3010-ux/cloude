const $ = s => document.querySelector(s);
const menuBtn = $('#menuBtn');
const nav = $('#nav');
menuBtn?.addEventListener('click', () => nav?.classList.toggle('open'));
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const error = new Error(data.message || 'Có lỗi xảy ra.');
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

async function refreshStatus() {
  try {
    const data = await api('/api/status');
    $('#accountCount').textContent = data.totalAccounts;
    $('#dbAccounts').textContent = data.totalAccounts;
    $('#dbSynced').textContent = data.syncedAccounts;
    const label = $('#gameSyncLabel');
    const dot = $('#gameDot');
    if (data.gameAccountSync) {
      label.textContent = 'Đã kết nối';
      dot.classList.add('online');
    } else {
      label.textContent = 'Chờ GameWorld riêng';
      dot.classList.remove('online');
    }
  } catch {
    $('#gameSyncLabel').textContent = 'Không lấy được trạng thái';
  }
}

function setGuest() {
  $('#guestAccount')?.classList.remove('hidden');
  $('#memberAccount')?.classList.add('hidden');
}

function renderMember(account) {
  $('#guestAccount')?.classList.add('hidden');
  $('#memberAccount')?.classList.remove('hidden');
  $('#meId').textContent = account.id || '-';
  $('#meEmail').textContent = account.email || '-';
  $('#meSilk').textContent = Number(account.silk || 0).toLocaleString('vi-VN');
  $('#silkBalance').textContent = Number(account.silk || 0).toLocaleString('vi-VN');
  $('#meSync').textContent = account.gameSynced ? 'Đã đồng bộ' : 'Chưa đồng bộ';
  $('#meSync').className = account.gameSynced ? 'ok-text' : 'warn-text';
  $('#memberCreated').textContent = account.createdAt ? `Tạo lúc ${new Date(account.createdAt).toLocaleString('vi-VN')}` : '';
}

async function refreshTopups() {
  try {
    const data = await api('/api/topups');
    $('#silkBalance').textContent = Number(data.silk || 0).toLocaleString('vi-VN');
    $('#meSilk').textContent = Number(data.silk || 0).toLocaleString('vi-VN');
    $('#topupNotice').textContent = data.message || (data.paymentEnabled ? 'Cổng nạp đã mở.' : 'Cổng nạp chưa mở.');
    $('#topupNotice').className = data.paymentEnabled ? 'topup-disabled open' : 'topup-disabled';
    const history = $('#topupHistory');
    if (!data.history?.length) {
      history.className = 'empty-history';
      history.textContent = 'Chưa có giao dịch nạp Silk.';
      return;
    }
    history.className = 'history-list';
    history.innerHTML = data.history.map(item => `
      <div class="history-row">
        <span>${item.method || 'Nạp Silk'}</span>
        <strong>+${Number(item.silk || 0).toLocaleString('vi-VN')} Silk</strong>
        <small>${item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : ''}</small>
      </div>`).join('');
  } catch (error) {
    if (error.status === 401) setGuest();
  }
}

async function refreshMe() {
  try {
    const data = await api('/api/me');
    renderMember(data.account);
    await refreshTopups();
  } catch (error) {
    if (error.status === 401) setGuest();
  }
}

const registerForm = $('#registerForm');
registerForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#submitBtn');
  const message = $('#formMessage');
  const payload = Object.fromEntries(new FormData(registerForm).entries());
  submit.disabled = true;
  submit.textContent = 'Đang tạo tài khoản...';
  message.className = 'form-message';
  message.textContent = '';
  try {
    const data = await api('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    message.className = 'form-message ok';
    message.textContent = `${data.message} Anh có thể đăng nhập ở mục Trung tâm tài khoản.`;
    registerForm.reset();
    await refreshStatus();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'Có lỗi xảy ra. Vui lòng thử lại.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Tạo tài khoản';
  }
});

const loginForm = $('#loginForm');
loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginBtn');
  const message = $('#loginMessage');
  button.disabled = true;
  button.textContent = 'Đang đăng nhập...';
  message.className = 'form-message';
  message.textContent = '';
  try {
    const payload = Object.fromEntries(new FormData(loginForm).entries());
    const data = await api('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    renderMember(data.account);
    loginForm.reset();
    await refreshTopups();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Đăng nhập';
  }
});

$('#logoutBtn')?.addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  setGuest();
});

const passwordForm = $('#passwordForm');
passwordForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#passwordBtn');
  const message = $('#passwordMessage');
  button.disabled = true;
  button.textContent = 'Đang đổi...';
  message.className = 'form-message';
  message.textContent = '';
  try {
    const payload = Object.fromEntries(new FormData(passwordForm).entries());
    const data = await api('/api/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    message.className = 'form-message ok';
    message.textContent = data.message;
    passwordForm.reset();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Đổi mật khẩu';
  }
});

await Promise.all([refreshStatus(), refreshMe()]);
