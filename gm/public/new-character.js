const $ = id => document.getElementById(id);

const VANILLA = {
  enabled: false,
  level: 1,
  gold: 0,
  skillPoints: 0,
  statPoints: 0,
  keepDefaultGear: true,
  starterItems: []
};

function number(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? Math.trunc(out) : fallback;
}

function rowElement(item = {}) {
  const row = document.createElement('div');
  row.className = 'starter-item-row';
  row.innerHTML = `
    <input class="starter-code mono" placeholder="ITEM_..." maxlength="128" />
    <input class="starter-count" type="number" min="1" max="65535" value="1" title="Số lượng" />
    <input class="starter-plus" type="number" min="0" max="15" value="0" title="Plus" />
    <button class="danger starter-remove" type="button">Xóa</button>
  `;
  row.querySelector('.starter-code').value = item.codename || '';
  row.querySelector('.starter-count').value = item.count ?? 1;
  row.querySelector('.starter-plus').value = item.plus ?? 0;
  row.querySelector('.starter-remove').onclick = () => {
    row.remove();
    renderPreview();
  };
  for (const input of row.querySelectorAll('input')) input.addEventListener('input', renderPreview);
  return row;
}

function renderRows(items = []) {
  const root = $('starterItemRows');
  root.textContent = '';
  for (const item of items) root.append(rowElement(item));
}

function collect() {
  const starterItems = [...document.querySelectorAll('#starterItemRows .starter-item-row')]
    .map(row => ({
      codename: row.querySelector('.starter-code').value.trim().toUpperCase(),
      count: number(row.querySelector('.starter-count').value, 1),
      plus: number(row.querySelector('.starter-plus').value, 0)
    }))
    .filter(row => row.codename);
  return {
    enabled: $('newCharEnabled').checked,
    level: number($('newCharLevel').value, 1),
    gold: number($('newCharGold').value, 0),
    skillPoints: number($('newCharSkillPoints').value, 0),
    statPoints: number($('newCharStatPoints').value, 0),
    keepDefaultGear: $('newCharKeepDefaultGear').checked,
    starterItems
  };
}

function fill(settings = VANILLA) {
  $('newCharEnabled').checked = Boolean(settings.enabled);
  $('newCharLevel').value = settings.level ?? 1;
  $('newCharGold').value = settings.gold ?? 0;
  $('newCharSkillPoints').value = settings.skillPoints ?? 0;
  $('newCharStatPoints').value = settings.statPoints ?? 0;
  $('newCharKeepDefaultGear').checked = settings.keepDefaultGear !== false;
  renderRows(settings.starterItems || []);
  renderPreview();
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(number(value));
}

function renderPreview() {
  const cfg = collect();
  const lines = [
    ['Chế độ', cfg.enabled ? 'TÙY CHỈNH ĐANG BẬT' : 'Silkroad mặc định'],
    ['Level', cfg.enabled ? cfg.level : 1],
    ['Gold', cfg.enabled ? formatNumber(cfg.gold) : '0'],
    ['Skill Point', cfg.enabled ? formatNumber(cfg.skillPoints) : '0'],
    ['Stat Point', cfg.enabled ? formatNumber(cfg.statPoints) : '0'],
    ['Trang bị tạo nhân vật', cfg.keepDefaultGear ? 'Giữ theo lựa chọn của người chơi' : 'Không cấp bộ mặc định'],
    ['Starter Pack', cfg.starterItems.length ? `${cfg.starterItems.length} loại item` : 'Không thêm item']
  ];
  $('newCharacterPreview').innerHTML = lines.map(([k,v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  const badge = $('newCharacterBadge');
  badge.textContent = cfg.enabled ? 'Custom defaults ON' : 'Vanilla';
  badge.className = `badge ${cfg.enabled ? 'ok' : 'warn'}`;
}

async function load(api, msg) {
  msg('newCharacterMessage', 'Đang tải cấu hình...');
  try {
    const data = await api('/api/new-character-settings');
    fill(data.settings || VANILLA);
    msg('newCharacterMessage', 'Cấu hình này chỉ áp dụng cho nhân vật được tạo sau khi lưu.', 'ok');
  } catch (error) {
    msg('newCharacterMessage', `Không tải được cấu hình nhân vật mới: ${error.message}`, 'bad');
  }
}

export function initNewCharacterSettings(api, msg) {
  $('addStarterItemBtn').onclick = () => {
    const root = $('starterItemRows');
    if (root.children.length >= 16) return msg('newCharacterMessage', 'Starter Pack tối đa 16 loại item.', 'bad');
    root.append(rowElement());
    renderPreview();
  };

  for (const id of ['newCharEnabled','newCharLevel','newCharGold','newCharSkillPoints','newCharStatPoints','newCharKeepDefaultGear']) {
    $(id).addEventListener('input', renderPreview);
    $(id).addEventListener('change', renderPreview);
  }

  $('restoreVanillaBtn').onclick = () => {
    if (!confirm('Khôi phục cấu hình tạo nhân vật về mặc định Silkroad?')) return;
    fill(VANILLA);
    $('newCharacterSettingsForm').requestSubmit();
  };

  $('newCharacterSettingsForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    if (button) button.disabled = true;
    msg('newCharacterMessage', 'Đang lưu...');
    try {
      const payload = collect();
      const data = await api('/api/new-character-settings', {
        method: 'PUT', body: JSON.stringify(payload)
      });
      fill(data.settings || payload);
      msg('newCharacterMessage', data.message || 'Đã lưu. Nhân vật tạo mới sẽ nhận cấu hình này ngay lập tức.', 'ok');
    } catch (error) {
      msg('newCharacterMessage', error.message, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  };

  load(api, msg);
}
