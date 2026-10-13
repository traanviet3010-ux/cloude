const $ = id => document.getElementById(id);

let currentCharacter = '';
let currentCharacterData = null;
let eventTimer = null;

const number = value => Number(value || 0).toLocaleString('vi-VN');
const html = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function setMessage(id, text = '', kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `message ${kind}`.trim();
}

function renderInventory(rows = []) {
  if (!rows.length) {
    $('characterInventory').innerHTML = '<p class="muted">Inventory trống.</p>';
    return;
  }
  $('characterInventory').innerHTML = `<table><thead><tr><th>Slot</th><th>CodeName</th><th>+</th><th>SL</th><th>UID</th></tr></thead><tbody>${rows.map(row => `<tr><td>${html(row.slot)}</td><td class="mono">${html(row.codename)}</td><td>+${html(row.plus || 0)}</td><td>${html(row.stackCount || 1)}</td><td class="mono">${html(row.recordId || '—')}</td></tr>`).join('')}</tbody></table>`;
}

function populateTowns(towns = []) {
  const select = $('rescueTown');
  select.textContent = '';
  for (const town of towns) {
    const option = document.createElement('option');
    option.value = town.id;
    option.textContent = `${town.code || 'Town'} (#${town.id})`;
    select.append(option);
  }
}

function renderCharacter(data) {
  const player = data?.player || {};
  currentCharacterData = data;
  currentCharacter = player.name || currentCharacter;
  $('characterInspector').classList.remove('hidden');
  $('characterBadge').textContent = player.bound ? 'Đang online' : 'Offline';
  $('characterBadge').className = `badge ${player.bound ? 'ok' : 'warn'}`;
  $('characterName').textContent = player.name || currentCharacter;
  $('characterMeta').textContent = `ID ${player.id ?? '—'} • shard ${data?.shard || 'global-official'} • đọc ${new Date(data?.capturedAt || Date.now()).toLocaleTimeString('vi-VN')}`;
  $('charLevel').textContent = player.level ?? '—';
  $('charHpMp').textContent = `${number(player.hp)} / ${number(player.mp)}`;
  $('charStats').textContent = `${number(player.strength)} / ${number(player.intellect)}`;
  $('charStatPoints').textContent = number(player.statPoints);
  $('charBound').textContent = player.bound ? 'ONLINE' : 'OFFLINE';
  $('charInventoryCount').textContent = number((player.inventory || []).length);
  $('itemCharacter').value = currentCharacter;
  populateTowns(data?.towns || []);
  renderInventory(player.inventory || []);
}

async function loadCharacter(api, name) {
  currentCharacter = String(name || '').trim();
  if (!currentCharacter) return;
  setMessage('characterMessage', `Đang đọc ${currentCharacter}...`);
  try {
    const data = await api(`/api/characters/${encodeURIComponent(currentCharacter)}`);
    renderCharacter(data);
    setMessage('characterMessage', 'Đã đọc dữ liệu trực tiếp từ GameWorld.', 'ok');
  } catch (error) {
    setMessage('characterMessage', error.message, 'bad');
  }
}

function renderSearchResults(api, rows = []) {
  const box = $('characterSearchResults');
  box.textContent = '';
  if (!rows.length) {
    box.innerHTML = '<p class="muted">Không tìm thấy nhân vật.</p>';
    return;
  }
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-row';
    button.innerHTML = `<span><b>${html(row.name)}</b><small>${html(row.accountId || 'không có account')} • Lv ${html(row.level)}</small></span><span><b>${number(row.gold)} Gold</b><small>${html(row.inventoryRows)} ô đồ</small></span>`;
    button.onclick = () => loadCharacter(api, row.name);
    box.append(button);
  }
}

async function characterAction(api, action, extra = {}) {
  if (!currentCharacter) return setMessage('characterMessage', 'Chọn nhân vật trước.', 'bad');
  const reason = $('characterReason').value.trim();
  if (reason.length < 5) return setMessage('characterMessage', 'Nhập lý do ít nhất 5 ký tự để audit.', 'bad');
  if (currentCharacterData?.player?.bound && ['rescue','clear-pk','reset-stats'].includes(action)) {
    if (!confirm(`${currentCharacter} đang online. Thao tác này có thể ngắt phiên chơi để bảo toàn dữ liệu. Tiếp tục?`)) return;
  }
  setMessage('characterMessage', 'Đang thực hiện thao tác có audit...');
  try {
    const data = await api(`/api/characters/${encodeURIComponent(currentCharacter)}/operation`, {
      method: 'POST', body: JSON.stringify({ action, reason, ...extra })
    });
    renderCharacter(data);
    setMessage('characterMessage', 'Thao tác thành công và đã được ghi audit.', 'ok');
  } catch (error) {
    setMessage('characterMessage', error.message, 'bad');
  }
}

function renderEvent(row) {
  clearInterval(eventTimer);
  const event = row?.event || row || {};
  if (!event.active) {
    $('eventBadge').textContent = 'Không có event';
    $('eventBadge').className = 'badge warn';
    $('stopEventBtn').disabled = true;
    return;
  }
  $('stopEventBtn').disabled = false;
  const tick = () => {
    const seconds = Math.max(0, Math.floor(Number(event.endsAt || 0) - Date.now() / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    $('eventBadge').textContent = `${event.label || 'Event'} • ${minutes}:${rest}`;
    $('eventBadge').className = 'badge ok';
  };
  tick();
  eventTimer = setInterval(tick, 1000);
}

async function refreshEvent(api) {
  try { renderEvent(await api('/api/event')); }
  catch (error) { setMessage('eventMessage', error.message, 'bad'); }
}

function renderEconomy(data) {
  $('ecoCharacters').textContent = number(data.totalCharacters);
  $('ecoGold').textContent = number(data.totalGold);
  $('ecoSilk').textContent = number(data.totalSilk);
  $('ecoPlus9').textContent = number(data.plus9);
  $('ecoPlus12').textContent = number(data.plus12);
  $('ecoRisk').textContent = `${number(data.riskScore)}/100`;
  $('ecoRisk').className = Number(data.riskScore) > 0 ? 'risk-text' : '';
  const richest = data.richest || [];
  $('richestList').innerHTML = richest.length ? `<table><thead><tr><th>Nhân vật</th><th>Lv</th><th>Gold</th></tr></thead><tbody>${richest.map(row => `<tr><td>${html(row.name)}</td><td>${html(row.level)}</td><td>${number(row.gold)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có dữ liệu.</p>';
  const dupes = data.duplicateItems || [];
  $('duplicateList').innerHTML = dupes.length ? `<table><thead><tr><th>UID</th><th>Vị trí</th></tr></thead><tbody>${dupes.map(row => `<tr><td class="mono">${html(row.recordId)}</td><td>${(row.owners || []).map(x => `${html(x.character)}:${html(x.slot)}`).join(', ')}</td></tr>`).join('')}</tbody></table>` : '<p class="ok-line">Không phát hiện UID item trùng.</p>';
}

async function refreshEconomy(api) {
  setMessage('economyMessage', 'Đang quét authority DB...');
  try {
    const data = await api('/api/economy');
    renderEconomy(data);
    setMessage('economyMessage', `Quét xong lúc ${new Date().toLocaleTimeString('vi-VN')}. Đây là cảnh báo dữ liệu, không tự khóa tài khoản.`, 'ok');
  } catch (error) {
    setMessage('economyMessage', error.message, 'bad');
  }
}

export function initOperations(api) {
  $('characterSearchForm').onsubmit = async event => {
    event.preventDefault();
    const query = $('characterQuery').value.trim();
    if (!query) return;
    setMessage('characterMessage', 'Đang tìm trong authority DB...');
    try {
      const data = await api(`/api/characters/search?q=${encodeURIComponent(query)}`);
      renderSearchResults(api, data.characters || []);
      setMessage('characterMessage', `${(data.characters || []).length} kết quả.`, 'ok');
    } catch (error) {
      setMessage('characterMessage', error.message, 'bad');
    }
  };
  $('reloadCharacterBtn').onclick = () => loadCharacter(api, currentCharacter);
  $('rescueBtn').onclick = () => characterAction(api, 'rescue', { town: Number($('rescueTown').value) });
  $('clearPkBtn').onclick = () => characterAction(api, 'clear-pk');
  $('resetStatsBtn').onclick = () => {
    if (confirm('Reset STR/INT sẽ trả các điểm đã cộng về Stat Point. Xác nhận?')) characterAction(api, 'reset-stats');
  };
  $('grantSilkBtn').onclick = () => {
    const silk = Number($('silkAmount').value);
    if (!Number.isInteger(silk) || silk < 1 || silk > 1000000) return setMessage('characterMessage', 'Silk phải từ 1 đến 1.000.000.', 'bad');
    if (confirm(`Cộng ${number(silk)} Silk cho ${currentCharacter}?`)) characterAction(api, 'grant-silk', { silk });
  };

  $('itemGrantForm').onsubmit = async event => {
    event.preventDefault();
    const character = $('itemCharacter').value.trim();
    const codename = $('itemCodename').value.trim().toUpperCase();
    const count = Number($('itemCount').value);
    const reason = $('itemReason').value.trim();
    if (!character || !codename.startsWith('ITEM_') || !Number.isInteger(count) || count < 1 || reason.length < 5) {
      return setMessage('itemMessage', 'Kiểm tra tên nhân vật, CodeName, số lượng và lý do.', 'bad');
    }
    if (!confirm(`Gửi ${count} × ${codename} cho ${character}?`)) return;
    setMessage('itemMessage', 'Đang gửi item qua authority...');
    try {
      await api(`/api/characters/${encodeURIComponent(character)}/operation`, {
        method: 'POST', body: JSON.stringify({ action: 'grant-items', reason, items: [{ codename, count }] })
      });
      setMessage('itemMessage', 'Đã cấp vật phẩm và ghi audit thành công.', 'ok');
      if (character === currentCharacter) loadCharacter(api, character);
    } catch (error) {
      setMessage('itemMessage', error.message, 'bad');
    }
  };

  $('eventForm').onsubmit = async event => {
    event.preventDefault();
    if (!confirm('Bắt đầu event sẽ restart GameWorld ngắn để áp dụng rate. Tiếp tục?')) return;
    const payload = {
      label: $('eventLabel').value.trim(),
      durationMinutes: Number($('eventDuration').value),
      expRate: Number($('eventExp').value),
      skillExpRate: Number($('eventSkill').value),
      dropRate: Number($('eventDrop').value),
      goldRate: Number($('eventGold').value),
      rareRate: Number($('eventRare').value)
    };
    setMessage('eventMessage', 'Đang bật event...');
    try {
      const data = await api('/api/event/start', { method: 'POST', body: JSON.stringify(payload) });
      renderEvent(data);
      setMessage('eventMessage', 'Event đã bật. Rate cũ sẽ tự khôi phục khi hết giờ.', 'ok');
    } catch (error) {
      setMessage('eventMessage', error.message, 'bad');
    }
  };
  $('stopEventBtn').onclick = async () => {
    if (!confirm('Dừng event sớm và trả rate về bản trước?')) return;
    try {
      const data = await api('/api/event/stop', { method: 'POST', body: '{}' });
      renderEvent(data);
      setMessage('eventMessage', 'Đã dừng event và đang khôi phục rate.', 'ok');
    } catch (error) { setMessage('eventMessage', error.message, 'bad'); }
  };

  $('monsterLookupBtn').onclick = async () => {
    const ref = Number($('monsterRef').value);
    if (!Number.isInteger(ref) || ref < 1) return setMessage('eventMessage', 'Nhập RefObjID hợp lệ.', 'bad');
    $('monsterResults').innerHTML = '<p class="muted">Đang truy vấn GameWorld...</p>';
    try {
      const data = await api(`/api/monsters?ref=${encodeURIComponent(ref)}`);
      const rows = data.monsters || [];
      $('monsterResults').innerHTML = rows.length ? rows.map(row => `<div class="monster-row"><b>${html(row.name || `Ref ${row.refObjId}`)}</b><small>GID ${html(row.gid)} • HP ${number(row.hp)} • Region ${html(row.regionId)} • X ${Number(row.localX || 0).toFixed(1)} Z ${Number(row.localZ || 0).toFixed(1)}</small></div>`).join('') : '<p class="muted">Không có quái với RefObjID này đang sống.</p>';
    } catch (error) {
      $('monsterResults').innerHTML = `<p class="message bad">${html(error.message)}</p>`;
    }
  };

  $('economyRefreshBtn').onclick = () => refreshEconomy(api);
  refreshEvent(api);
  refreshEconomy(api);
}

export function updateOperationsStatus(data) {
  $('gameRss').textContent = data.gameRssMiB ? `${data.gameRssMiB} MB` : '—';
  const seconds = Number(data.gameUptimeSeconds || 0);
  $('gameUptime').textContent = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : `${Math.floor(seconds / 60)}m`;
  $('loadAvg').textContent = data.load1 ?? '—';
  const bytes = Number(data.databaseBytes || 0);
  $('dbSize').textContent = bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '—';
  if (data.event) renderEvent(data.event);
}
