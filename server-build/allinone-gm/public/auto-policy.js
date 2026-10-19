const $ = id => document.getElementById(id);

export function initAutoPolicy(api) {
  const form = $('autoPolicyForm');
  const badge = $('autoPolicyBadge');
  const message = $('autoPolicyMessage');
  const say = (text, kind='') => {
    message.textContent = text;
    message.className = 'message ' + kind;
  };
  async function refresh() {
    try {
      const result = await api('/api/auto-policy');
      const p = result.policy;
      $('autoPolicyEnabled').checked = p.enabled;
      $('autoPolicyRadius').value = p.maxRadius;
      $('autoPolicyMinutes').value = p.maxMinutes;
      badge.textContent = p.enabled ? 'Auto Online: cho phép' : 'Auto Online: đã tắt';
      badge.className = 'badge ' + (p.enabled ? 'ok' : 'warn');
      say('Chính sách được lưu cho phiên TEST hiện tại.', 'ok');
    } catch(error) { say('Không tải được quy định Auto: ' + error.message,'bad'); }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const enabled = $('autoPolicyEnabled').checked;
    const maxRadius = Number($('autoPolicyRadius').value);
    const maxMinutes = Number($('autoPolicyMinutes').value);
    if (!Number.isInteger(maxRadius) || maxRadius < 10 || maxRadius > 100 ||
        maxRadius % 10 !== 0 || !Number.isInteger(maxMinutes) ||
        maxMinutes < 15 || maxMinutes > 1440) {
      say('Giới hạn không hợp lệ. Bán kính 10–100m, thời lượng 15–1440 phút.', 'bad');
      return;
    }
    if (!enabled && !confirm('Dừng Auto Online trên tất cả client TEST đang mở trong khoảng 15 giây?')) return;
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await api('/api/auto-policy', {method:'PUT',body:JSON.stringify({enabled,maxRadius,maxMinutes})});
      say('Đã cập nhật chính sách Auto Online. Client sẽ kiểm tra lại tự động.', 'ok');
      await refresh();
    } catch(error) { say(error.message,'bad'); }
    finally { submit.disabled = false; }
  };
  $('autoPolicyReload').onclick = refresh;
  refresh();
}
