import { initAccounts } from './accounts.js';

const $ = id => document.getElementById(id);
let pollTimer = null;

function msg(id, text = '', kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `message ${kind}`.trim();
}

function fillSettings(settings) {
  for (const key of ['expRate','skillExpRate','dropRate','goldRate','rareRate','dropCap']) $(key).value = settings[key];
  $('betaGrowth').checked = Boolean(settings.betaGrowth);
}

export function initDashboard(api, showLogin) {
  clearInterval(pollTimer);

  async function refreshStatus() {
    try {
      const data = await api('/api/status');
      $('onlinePlayers').textContent = data.onlinePlayers ?? 0;
      $('capacity').textContent = data.capacity ?? 0;
      $('restartCount').textContent = data.restartCount ?? 0;
      $('serverState').textContent = data.operating ? 'ONLINE' : 'OFFLINE';
      $('gameReady').textContent = data.gameReady ? 'READY' : 'STARTING';
      $('liveBadge').textContent = data.gameReady && data.operating ? 'HieuSRO Online' : 'Đang khởi động';
      $('liveBadge').className = `badge ${data.gameReady && data.operating ? 'ok' : 'warn'}`;
      if (data.settings) fillSettings(data.settings);
      $('lastRefresh').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
    } catch {
      $('liveBadge').textContent = 'Mất kết nối';
      $('liveBadge').className = 'badge bad';
      $('serverState').textContent = 'ERROR';
    }
  }

  $('refreshBtn').onclick = refreshStatus;
  $('logoutBtn').onclick = async () => {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
    clearInterval(pollTimer);
    showLogin();
  };

  $('rateForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    msg('rateMessage', 'Đang áp dụng...');
    try {
      const payload = {
        expRate: Number($('expRate').value),
        skillExpRate: Number($('skillExpRate').value),
        dropRate: Number($('dropRate').value),
        goldRate: Number($('goldRate').value),
        rareRate: Number($('rareRate').value),
        dropCap: Number($('dropCap').value),
        betaGrowth: $('betaGrowth').checked
      };
      const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      fillSettings(data.settings || payload);
      msg('rateMessage', data.restarting ? 'Đã lưu. GameWorld đang restart để nhận rate mới.' : 'Thông số không đổi.', 'ok');
      setTimeout(refreshStatus, 3000);
    } catch (error) {
      msg('rateMessage', error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  };

  $('noticeForm').onsubmit = async event => {
    event.preventDefault();
    const text = $('noticeMessage').value.trim();
    if (!text) return msg('noticeStatus', 'Nhập nội dung thông báo.', 'bad');
    const button = event.submitter;
    button.disabled = true;
    msg('noticeStatus', 'Đang phát...');
    try {
      await api('/api/notice', { method: 'POST', body: JSON.stringify({ message: text }) });
      $('noticeMessage').value = '';
      msg('noticeStatus', 'Đã phát thông báo toàn server.', 'ok');
    } catch (error) {
      msg('noticeStatus', error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  };

  initAccounts(api, msg);
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 12000);
}
