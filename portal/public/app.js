const $ = s => document.querySelector(s);
const menuBtn = $('#menuBtn');
const nav = $('#nav');
menuBtn?.addEventListener('click', () => nav?.classList.toggle('open'));
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

async function refreshStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error('status');
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

const form = $('#registerForm');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#submitBtn');
  const message = $('#formMessage');
  const payload = Object.fromEntries(new FormData(form).entries());
  submit.disabled = true;
  submit.textContent = 'Đang tạo tài khoản...';
  message.className = 'form-message';
  message.textContent = '';
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không thể tạo tài khoản.');
    message.className = 'form-message ok';
    message.textContent = data.message;
    form.reset();
    await refreshStatus();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'Có lỗi xảy ra. Vui lòng thử lại.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Tạo tài khoản';
  }
});

refreshStatus();
