const $ = id => document.getElementById(id);

export function initAccounts(api, msg) {
  let current = null;

  function render(account) {
    current = account;
    $('accountCard').classList.remove('hidden');
    $('accountName').textContent = account.id || '—';
    $('accountCreated').textContent = account.createdAt ? new Date(account.createdAt).toLocaleString('vi-VN') : '—';
    $('accountState').textContent = account.disabled ? 'ĐÃ KHÓA' : 'HOẠT ĐỘNG';
    $('toggleDisabledBtn').textContent = account.disabled ? 'Mở khóa tài khoản' : 'Khóa tài khoản';
    $('toggleDisabledBtn').className = account.disabled ? 'ghost' : 'danger';
  }

  $('accountLookupForm').onsubmit = async event => {
    event.preventDefault();
    const id = $('accountId').value.trim();
    if (!id) return;
    msg('accountMessage', 'Đang tìm...');
    try {
      render(await api(`/api/accounts/${encodeURIComponent(id)}`));
      msg('accountMessage');
    } catch (error) {
      current = null;
      $('accountCard').classList.add('hidden');
      msg('accountMessage', error.message, 'bad');
    }
  };

  $('toggleDisabledBtn').onclick = async () => {
    if (!current) return;
    const disabled = !current.disabled;
    const action = disabled ? 'khóa' : 'mở khóa';
    if (!window.confirm(`Xác nhận ${action} tài khoản ${current.id}?`)) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(current.id)}/disabled`, {
        method: 'PUT',
        body: JSON.stringify({ disabled })
      });
      current.disabled = disabled;
      render(current);
      msg('accountMessage', `Đã ${action} tài khoản.`, 'ok');
    } catch (error) {
      msg('accountMessage', error.message, 'bad');
    }
  };

  $('passwordForm').onsubmit = async event => {
    event.preventDefault();
    if (!current) return;
    const password = $('newPassword').value;
    const bytes = new TextEncoder().encode(password).length;
    if (bytes < 8 || bytes > 72) return msg('accountMessage', 'Mật khẩu phải từ 8 đến 72 byte.', 'bad');
    if (!window.confirm(`Đổi mật khẩu tài khoản ${current.id}?`)) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(current.id)}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password })
      });
      $('newPassword').value = '';
      msg('accountMessage', 'Đã đổi mật khẩu game.', 'ok');
    } catch (error) {
      msg('accountMessage', error.message, 'bad');
    }
  };
}
