import { initAccounts } from './accounts.js';

const $ = id => document.getElementById(id);
let pollTimer = null;
let versionTimer = null;
let lastOnlinePlayers = 0;

function msg(id, text = '', kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `message ${kind}`.trim();
}

function fillSettings(settings) {
  for (const key of ['expRate','skillExpRate','dropRate','goldRate','rareRate','dropCap']) $(key).value = settings[key];
  $('betaGrowth').checked = Boolean(settings.betaGrowth);
}

function riskText(risk) {
  return ({ green: 'An toàn', yellow: 'Rủi ro thấp', orange: 'Phụ thuộc', red: 'Không khuyến nghị' })[risk] || risk;
}

function jobText(job) {
  if (!job) return 'Không có tác vụ rollback.';
  const states = {
    queued: 'Đã xếp hàng', deploying: 'Đang rollback', 'health-check': 'Đang health-check',
    live: 'Rollback thành công', failed: 'Rollback lỗi', restoring: 'Đang tự khôi phục',
    restored: 'Đã tự khôi phục bản trước', 'restore-failed': 'Khôi phục tự động thất bại'
  };
  return `${job.target}: ${states[job.phase] || job.phase}${job.error ? ` • ${job.error}` : ''}`;
}

function createVersionCard(row, data, api) {
  const card = document.createElement('article');
  card.className = `version-card risk-${row.risk}`;

  const top = document.createElement('div');
  top.className = 'version-top';
  const title = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = `${row.id} — ${row.title}`;
  const commit = document.createElement('small');
  commit.textContent = `commit ${row.commit.slice(0, 8)}`;
  title.append(name, commit);

  const badges = document.createElement('div');
  badges.className = 'version-badges';
  const score = document.createElement('span');
  score.className = `risk-pill ${row.risk}`;
  score.textContent = `${row.score}/100 • ${riskText(row.risk)}`;
  badges.append(score);
  if (row.current) {
    const live = document.createElement('span');
    live.className = 'risk-pill current';
    live.textContent = 'Đang chạy';
    badges.append(live);
  }
  top.append(title, badges);

  const summary = document.createElement('p');
  summary.className = 'version-summary';
  summary.textContent = row.summary;

  const impact = document.createElement('div');
  impact.className = 'impact-grid';
  for (const [label, value] of [['Client', row.client], ['Web GM', row.gm], ['Database', row.database]]) {
    const item = document.createElement('div');
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('b');
    val.textContent = value;
    item.append(key, val);
    impact.append(item);
  }

  const actions = document.createElement('div');
  actions.className = 'version-actions';
  const button = document.createElement('button');
  button.className = row.risk === 'red' ? 'danger' : row.risk === 'orange' ? 'warn-button' : 'ghost';
  button.textContent = row.current ? 'Version hiện tại' : ['orange','red'].includes(row.risk) ? 'Rollback tùy chỉnh' : 'Rollback an toàn';
  button.disabled = row.current || !data.rollbackEnabled;
  button.onclick = async () => {
    const force = ['orange','red'].includes(row.risk) || lastOnlinePlayers > 0;
    const warning = [
      `Rollback Game Server về ${row.id}?`,
      `Compatibility: ${row.score}/100 — ${riskText(row.risk)}.`,
      'Database, Client và Web GM sẽ KHÔNG bị rollback.',
      lastOnlinePlayers > 0 ? `Hiện có ${lastOnlinePlayers} người chơi online.` : ''
    ].filter(Boolean).join('\n');
    if (!confirm(warning)) return;
    if (force && !confirm('Đây là rollback cưỡng bức. Xác nhận lần cuối?')) return;
    button.disabled = true;
    msg('versionMessage', `Đang gửi rollback ${row.id}...`);
    try {
      const out = await api(`/api/versions/${encodeURIComponent(row.id)}/rollback`, {
        method: 'POST', body: JSON.stringify({ force })
      });
      msg('versionMessage', `Đã bắt đầu rollback ${row.id}. Web GM sẽ tự theo dõi và khôi phục nếu deploy lỗi.`, 'ok');
      $('versionJob').textContent = jobText(out.job);
      setTimeout(() => refreshVersions(api), 1200);
    } catch (error) {
      msg('versionMessage', error.message, 'bad');
      button.disabled = false;
    }
  };
  actions.append(button);

  card.append(top, summary, impact, actions);
  return card;
}

async function refreshVersions(api) {
  clearTimeout(versionTimer);
  try {
    const data = await api('/api/versions');
    $('currentVersion').textContent = data.current || 'unknown';
    $('versionControlBadge').textContent = data.rollbackEnabled ? 'Rollback sẵn sàng' : 'Chưa nối Render API';
    $('versionControlBadge').className = `badge ${data.rollbackEnabled ? 'ok' : 'warn'}`;
    $('versionJob').textContent = jobText(data.activeJob);
    const list = $('versionList');
    list.textContent = '';
    for (const row of data.versions || []) list.append(createVersionCard(row, data, api));
    if (!data.rollbackEnabled) {
      msg('versionMessage', 'Compatibility Analyzer đã hoạt động. Để bật rollback thật, cần đặt HIEUSRO_RENDER_API_KEY trực tiếp trong Render của Web GM.');
    } else if (!data.activeJob || ['live','restored','failed','restore-failed'].includes(data.activeJob.phase)) {
      msg('versionMessage', data.activeJob ? jobText(data.activeJob) : '', data.activeJob?.phase === 'live' ? 'ok' : '');
    }
    if (data.activeJob && !['live','restored','failed','restore-failed'].includes(data.activeJob.phase)) {
      versionTimer = setTimeout(() => refreshVersions(api), 4000);
    }
  } catch (error) {
    msg('versionMessage', `Không tải được Version Manager: ${error.message}`, 'bad');
  }
}

export function initDashboard(api, showLogin) {
  clearInterval(pollTimer);
  clearTimeout(versionTimer);

  async function refreshStatus() {
    try {
      const data = await api('/api/status');
      lastOnlinePlayers = Number(data.onlinePlayers) || 0;
      $('onlinePlayers').textContent = lastOnlinePlayers;
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

  $('refreshBtn').onclick = () => {
    refreshStatus();
    refreshVersions(api);
  };
  $('logoutBtn').onclick = async () => {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
    clearInterval(pollTimer);
    clearTimeout(versionTimer);
    showLogin();
  };

  $('rateForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    msg('rateMessage', 'Đang áp dụng...');
    try {
      const payload = {
        expRate: Number($('expRate').value), skillExpRate: Number($('skillExpRate').value),
        dropRate: Number($('dropRate').value), goldRate: Number($('goldRate').value),
        rareRate: Number($('rareRate').value), dropCap: Number($('dropCap').value),
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
  refreshVersions(api);
  pollTimer = setInterval(refreshStatus, 12000);
}
