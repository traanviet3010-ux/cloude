/*
 * HieuSRO Auto Train, phase 1 (online only).
 * Built into the real OpenSRO runtime and uses the normal gameplay action lane.
 * Never computes damage, rewards, drops or movement server-side.
 */
import type { EntityState } from '@/engine/contracts/world';
import type { GameplayCommand, GameplayState, Pose } from '@/engine/contracts/gameplay';
import { autoPotionEntry, autoPotionWord, defaultAutoPotion } from '@/engine/foundation/gameplay/auto-potion';
import { skillCooldown } from '@/engine/foundation/gameplay/skill-cooldowns';
import { SKILL_TARGET_MONSTER, SKILL_TARGET_SELF, skillMpCost } from '@/engine/foundation/gameplay/skill-catalog';

const UNIT_PER_METER = 10;
const REGION_SIZE = 1920;
const ACTION_INTERVAL_MS = 650;
const STUCK_AFTER_MS = 14000;
const STUCK_RETRY_MS = 18000;
const MIN_MOVEMENT_UNITS = 12;
const RADIUS_STORAGE = 'hieusro:auto-train:radius:v1';
const PROFILE_PREFIX = 'hieusro:auto-train:profile:v2:';
const SKILL_WAIT_MS = 1350, BUFF_WAIT_MS = 7000, PICKUP_WAIT_MS = 1500;
const LOOT_WINDOW_MS = 5500, RETURN_WAIT_MS = 3200;

type AutoFrame = {
  readonly world: boolean;
  readonly gameplay: GameplayState | null | undefined;
  readonly local: EntityState | null | undefined;
  readonly entities: readonly EntityState[];
  readonly now: number;
};

function point(p: Pick<Pose | EntityState, 'regionId' | 'x' | 'z'>): readonly [number, number] {
  return [p.x + (p.regionId & 255) * REGION_SIZE, p.z + (p.regionId >>> 8) * REGION_SIZE];
}

function distance(a: Pick<Pose | EntityState, 'regionId' | 'x' | 'z'>, b: Pick<Pose | EntityState, 'regionId' | 'x' | 'z'>): number {
  const [ax, az] = point(a);
  const [bx, bz] = point(b);
  return Math.hypot(ax - bx, az - bz);
}

export function pickAutoTrainMonster(
  entities: readonly EntityState[],
  center: Pose,
  local: Pose,
  radiusMeters: number,
  excluded: ReadonlySet<number> = new Set()
): EntityState | null {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 100) return null;
  let selected: EntityState | null = null;
  let nearest = Infinity;
  for (const entity of entities) {
    if (entity.kind !== 'monster' || !Number.isInteger(entity.gid) || entity.gid <= 0) continue;
    if (entity.appearanceState?.[0] === 2 || excluded.has(entity.gid)) continue;
    if (distance(center, entity) > radiusMeters * UNIT_PER_METER) continue;
    const away = distance(local, entity);
    if (away < nearest || (away === nearest && entity.gid < (selected?.gid ?? Infinity))) {
      selected = entity;
      nearest = away;
    }
  }
  return selected;
}

function storedRadius(): number {
  try {
    const n = Number(localStorage.getItem(RADIUS_STORAGE));
    if (Number.isInteger(n) && n >= 10 && n <= 100 && n % 10 === 0) return n;
  } catch { /* private browsing / disabled storage */ }
  return 40;
}

export function createAutoTrain(send: (command: GameplayCommand) => void) {
  const host = document.createElement('div');
  host.id = 'hieusro-auto-train-root';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial;position:fixed;inset:0;z-index:2147482500;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#eaf2ff}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.tools{position:absolute;right:12px;bottom:84px;display:flex;gap:6px;pointer-events:auto}',
    'button{font:inherit;cursor:pointer;color:#fff;border:1px solid #62789a;background:#1d344e;border-radius:10px;min-height:44px;padding:10px 12px;font-weight:700}',
    'button:focus-visible,input:focus-visible{outline:2px solid #e2b95c;outline-offset:2px}',
    '.start{background:#1a6241;border-color:#5bc38d;min-width:110px}',
    '.start.on{background:#882d32;border-color:#ff8a91}',
    '.settings{background:#263247}',
    '.panel{position:absolute;right:12px;bottom:141px;width:min(335px,calc(100vw - 24px));max-height:min(76vh,600px);overflow:auto;background:#101c2cf5;border:1px solid #526b8f;border-radius:15px;box-shadow:0 12px 40px #000a;padding:15px;pointer-events:auto;font-size:13px;line-height:1.5}',
    '.hidden{display:none}',
    '.top{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    'h2{font-size:17px;font-weight:800;color:#ffe09c;margin:0}',
    '.sub{color:#a3b8ce;font-size:11px}',
    '.state{background:#1d2d40;border:1px solid #344f70;border-radius:10px;padding:9px;margin:12px 0;color:#dce9fa}',
    '.stat{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}',
    '.stat>div{background:#18273b;border:1px solid #324760;padding:9px;border-radius:9px}',
    '.stat small{display:block;color:#a1b8d5}',
    '.stat strong{display:block;font-size:16px;color:#fff}',
    'label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0}',
    'input[type=range]{width:100%;accent-color:#f3c977;min-height:28px}',
    '.row{display:flex;gap:8px}.row button{flex:1}.help{font-size:11px;color:#a7b9cf;margin:12px 0 0}',
    'details{background:#152437;border:1px solid #304765;border-radius:10px;margin:10px 0;padding:10px}',
    'summary{color:#f6d78a;font-weight:800;cursor:pointer;min-height:30px}',
    '.line{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;min-height:36px}',
    '.line input[type=checkbox]{width:20px;height:20px;accent-color:#d3a74d;flex:none}',
    '.line label{margin:0;flex:1}',
    'select{border:1px solid #486382;background:#0a1626;border-radius:8px;color:#fff;min-height:40px;padding:8px;width:100%;font:inherit}',
    '.field{display:grid;gap:5px;margin:10px 0}.field label{color:#b7ccdf}',
    '.compact{font-size:11px;color:#89b39c}.notice{color:#ffcc8b;font-size:12px;line-height:1.45}',
    '.stats-four{grid-template-columns:1fr 1fr}.stats-four strong{font-size:14px}',
    '.panel{scrollbar-width:thin;scrollbar-color:#547395 transparent}',
    '@media(max-height:440px){.tools{bottom:10px}.panel{bottom:64px;max-height:calc(100vh - 75px)}}',
    '</style>',
    '<div class="tools hidden" id="auto-tools">',
    '  <button id="auto-toggle" class="start" type="button" aria-label="Bật hoặc tắt Auto Train">AUTO: TẮT</button>',
    '  <button id="auto-settings" class="settings" type="button" aria-label="Cài đặt Auto Train">⚙</button>',
    '</div>',
    '<section id="auto-panel" class="panel hidden" role="dialog" aria-label="Cài đặt Auto Train">',
    '  <div class="top"><h2>AUTO TRAIN <span class="sub">v1.0</span></h2><button id="auto-close" type="button">✕</button></div>',
    '  <div id="auto-state" class="state" role="status">Chưa bật Auto</div>',
    '  <div class="stat stats-four"><div><small>Mục tiêu đã đánh</small><strong id="auto-count">0</strong></div>',
    '  <div><small>Đã nhặt thành công</small><strong id="auto-looted">0</strong></div>',
    '  <div><small>Đã dùng kỹ năng</small><strong id="auto-casts">0</strong></div>',
    '  <div><small>Thời gian chạy</small><strong id="auto-elapsed">00:00</strong></div></div>',
    '  <label for="auto-radius">Bán kính train <strong id="auto-radius-label">40 m</strong></label>',
    '  <input id="auto-radius" type="range" min="10" max="100" step="10" value="40"/>',
    '  <div class="row"><button id="auto-home" type="button">Lấy vị trí hiện tại</button></div>',
    '  <p id="auto-center" class="sub">Điểm train: chưa lưu</p>',
    '  <details open><summary>⚔ Chiến đấu và Buff</summary>',
    '    <div class="line"><label for="auto-skills-on">Dùng kỹ năng đánh quái</label><input id="auto-skills-on" type="checkbox"></div>',
    '    <div class="field"><label for="auto-attack-skill">Kỹ năng ưu tiên</label><select id="auto-attack-skill"><option value="0">Đánh thường</option></select></div>',
    '    <div class="line"><label for="auto-buffs-on">Tự duy trì Buff</label><input id="auto-buffs-on" type="checkbox"></div>',
    '    <div class="field"><label for="auto-buff-skill">Buff ưu tiên</label><select id="auto-buff-skill"><option value="0">Không sử dụng Buff</option></select></div>',
    '    <p class="sub">Chỉ hiển thị kỹ năng nhân vật đã học. Server vẫn kiểm tra cooldown, MP và mục tiêu.</p>',
    '  </details>',
    '  <details><summary>❤️ Hồi phục HP / MP</summary>',
    '    <div class="line"><label for="auto-hp-on">Tự dùng thuốc HP</label><input id="auto-hp-on" type="checkbox"></div>',
    '    <div class="field"><label for="auto-hp-slot">Ô hotbar thuốc HP</label><select id="auto-hp-slot"><option value="0">Chọn ô thuốc đã gán vào hotbar</option></select></div>',
    '    <label for="auto-hp-percent">Dùng khi HP dưới <b id="auto-hp-label">60%</b></label>',
    '    <input id="auto-hp-percent" type="range" min="10" max="90" step="5" value="60">',
    '    <div class="line"><label for="auto-mp-on">Tự dùng thuốc MP</label><input id="auto-mp-on" type="checkbox"></div>',
    '    <div class="field"><label for="auto-mp-slot">Ô hotbar thuốc MP</label><select id="auto-mp-slot"><option value="0">Chọn ô thuốc đã gán vào hotbar</option></select></div>',
    '    <label for="auto-mp-percent">Dùng khi MP dưới <b id="auto-mp-label">40%</b></label>',
    '    <input id="auto-mp-percent" type="range" min="10" max="90" step="5" value="40">',
    '    <button id="auto-save-potions" type="button">Áp dụng HP/MP vào game</button>',
    '    <p class="sub">Sử dụng hệ thống Auto Potion gốc của OpenSRO; thuốc phải có sẵn trong túi và được gán lên thanh kỹ năng.</p>',
    '  </details>',
    '  <details><summary>💰 Nhặt đồ và khu vực train</summary>',
    '    <div class="line"><label for="auto-gold">Tự nhặt vàng</label><input id="auto-gold" type="checkbox" checked></div>',
    '    <div class="line"><label for="auto-items">Tự nhặt vật phẩm</label><input id="auto-items" type="checkbox" checked></div>',
    '    <div class="line"><label for="auto-return">Tự trở về tâm bãi train</label><input id="auto-return" type="checkbox" checked></div>',
    '    <p class="sub">Chỉ nhặt trong bán kính đã lưu. Không nhặt vật phẩm có chủ sở hữu khác.</p>',
    '  </details>',
    '  <p id="auto-notice" class="notice" role="status"></p>',
    '  <p class="help">F6 bật/tắt. Chạm vào bản đồ để dừng ngay. Đóng tab thì Auto dừng. Nhân vật chết / mất kết nối sẽ tự dừng. Offline Auto chưa hỗ trợ.</p>',
    '</section>'
  ].join('');
  document.body.appendChild(host);

  const byId = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const toggle = byId<HTMLButtonElement>('auto-toggle');
  const settings = byId<HTMLButtonElement>('auto-settings');
  const tools = byId<HTMLElement>('auto-tools');
  const panel = byId<HTMLElement>('auto-panel');
  const state = byId<HTMLElement>('auto-state');
  const targetText = byId<HTMLElement>('auto-target');
  const countText = byId<HTMLElement>('auto-count');
  const radiusInput = byId<HTMLInputElement>('auto-radius');
  const radiusLabel = byId<HTMLElement>('auto-radius-label');
  const centerText = byId<HTMLElement>('auto-center');
  const notice = byId<HTMLElement>('auto-notice');
  const skillToggle = byId<HTMLInputElement>('auto-skills-on');
  const buffToggle = byId<HTMLInputElement>('auto-buffs-on');
  const attackSelect = byId<HTMLSelectElement>('auto-attack-skill');
  const buffSelect = byId<HTMLSelectElement>('auto-buff-skill');
  const hpToggle = byId<HTMLInputElement>('auto-hp-on');
  const mpToggle = byId<HTMLInputElement>('auto-mp-on');
  const hpSelect = byId<HTMLSelectElement>('auto-hp-slot');
  const mpSelect = byId<HTMLSelectElement>('auto-mp-slot');
  const hpPercentInput = byId<HTMLInputElement>('auto-hp-percent');
  const mpPercentInput = byId<HTMLInputElement>('auto-mp-percent');
  const goldToggle = byId<HTMLInputElement>('auto-gold');
  const itemToggle = byId<HTMLInputElement>('auto-items');
  const returnToggle = byId<HTMLInputElement>('auto-return');
  let radius = storedRadius();
  let frame: AutoFrame | null = null;
  let active = false;
  let selected = 0, looted = 0, casts = 0;
  let startedAt = 0, lastCastAt = -Infinity, lastBuffAt = -Infinity;
  let activeProfile = '', cachedSkillSignature = '', cachedItemSignature = '';
  let attackSkillId = 0, buffSkillId = 0;
  let skillsOn = false, buffsOn = false, goldOn = true, itemsOn = true, returnOn = true;
  let hpOn = false, mpOn = false, hpSlot = 0, mpSlot = 0, hpPercent = 60, mpPercent = 40;
  let collectingUntil = 0, lastVictim = 0, lastPickup = 0, pendingLootGid = 0, lastReturn = -Infinity;
  let stuckReturnCount = 0, returnOrigin: Pose | null = null;
  const lootedItems = new Map<number, number>();
  let currentGid: number | null = null;
  let lastStep = -Infinity;
  let actionAt = 0;
  let attackOrigin: Pose | null = null;
  let center: Pose | null = null;
  let lastLocalGid: number | null = null;
  let visibleWorld = false;
  let stoppedReason = 'Chưa bật Auto';
  const avoid = new Map<number, number>();
  const inputFields = [ skillToggle, buffToggle, attackSelect, buffSelect, hpToggle, mpToggle,
    hpSelect, mpSelect, hpPercentInput, mpPercentInput, goldToggle, itemToggle, returnToggle ];

  function persist() {
    if (!activeProfile) return;
    try {
      localStorage.setItem(PROFILE_PREFIX + activeProfile, JSON.stringify({
        version: 2, radius, skillsOn, buffsOn, attackSkillId, buffSkillId,
        goldOn, itemsOn, returnOn, hpOn, mpOn, hpSlot, mpSlot, hpPercent, mpPercent
      }));
    } catch { /* Client gameplay still works with storage disabled. */ }
  }

  function syncInputs() {
    radiusInput.value = String(radius);
    radiusLabel.textContent = radius + ' m';
    skillToggle.checked = skillsOn;
    buffToggle.checked = buffsOn;
    goldToggle.checked = goldOn; itemToggle.checked = itemsOn; returnToggle.checked = returnOn;
    hpToggle.checked = hpOn; mpToggle.checked = mpOn;
    hpPercentInput.value = String(hpPercent); mpPercentInput.value = String(mpPercent);
    byId<HTMLElement>('auto-hp-label').textContent = hpPercent + '%';
    byId<HTMLElement>('auto-mp-label').textContent = mpPercent + '%';
    attackSelect.value = String(attackSkillId); buffSelect.value = String(buffSkillId);
    hpSelect.value = String(hpSlot); mpSelect.value = String(mpSlot);
  }

  function loadProfile(identity: string) {
    if (activeProfile === identity) return;
    if (active) stop('Thay đổi nhân vật, Auto đã dừng.');
    activeProfile = identity;
    // No full-session identifiers or credentials are stored, only UI settings.
    try {
      const raw = localStorage.getItem(PROFILE_PREFIX + identity);
      const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (data.version === 2) {
        if (typeof data.radius === 'number' && data.radius >= 10 && data.radius <= 100) radius = data.radius;
        for (const [key, setter] of [
          ['skillsOn', (v: boolean) => { skillsOn = v; }],
          ['buffsOn', (v: boolean) => { buffsOn = v; }],
          ['goldOn', (v: boolean) => { goldOn = v; }],
          ['itemsOn', (v: boolean) => { itemsOn = v; }],
          ['returnOn', (v: boolean) => { returnOn = v; }],
          ['hpOn', (v: boolean) => { hpOn = v; }],
          ['mpOn', (v: boolean) => { mpOn = v; }]
        ] as const) {
          if (typeof data[key] === 'boolean') setter(data[key] as boolean);
        }
        for (const [key, setter, min, max] of [
          ['attackSkillId', (v: number) => { attackSkillId = v; }, 0, 65535],
          ['buffSkillId', (v: number) => { buffSkillId = v; }, 0, 65535],
          ['hpSlot', (v: number) => { hpSlot = v; }, 0, 40],
          ['mpSlot', (v: number) => { mpSlot = v; }, 0, 40],
          ['hpPercent', (v: number) => { hpPercent = v; }, 10, 90],
          ['mpPercent', (v: number) => { mpPercent = v; }, 10, 90]
        ] as const) {
          if (typeof data[key] === 'number' && Number.isInteger(data[key]) && data[key] >= min && data[key] <= max) setter(data[key]);
        }
      }
    } catch { /* Corrupt saved UI profile falls back to defaults. */ }
    cachedSkillSignature = ''; cachedItemSignature = '';
    syncInputs();
  }

  function fillSelect(select: HTMLSelectElement, options: readonly { id: number; label: string; }[], selectedValue: number) {
    select.replaceChildren();
    for (const option of options) {
      const el = document.createElement('option');
      el.value = String(option.id); el.textContent = option.label;
      select.appendChild(el);
    }
    select.value = String(selectedValue);
    if (!select.value) select.value = '0';
  }

  function updateSkillOptions(game: GameplayState) {
    const learned = new Set(game.skills ?? []);
    const rows = (game.skillCatalog ?? []).filter(row => learned.has(row.id));
    const signature = rows.map(row => row.id).join(',');
    if (signature === cachedSkillSignature) return;
    cachedSkillSignature = signature;
    fillSelect(attackSelect, [
      { id: 0, label: 'Đánh thường (không dùng Skill)' },
      ...rows.filter(r => (r.targets ?? 0) & SKILL_TARGET_MONSTER)
        .map(r => ({ id: r.id, label: r.name || 'Skill #' + r.id }))
    ], attackSkillId);
    fillSelect(buffSelect, [
      { id: 0, label: 'Không tự Buff' },
      ...rows.filter(r => !!((r.targets ?? 0) & SKILL_TARGET_SELF) || !r.targetRequired)
        .map(r => ({ id: r.id, label: r.name || 'Skill #' + r.id }))
    ], buffSkillId);
    // A patch/skill reset can remove a known skill: fall back safely.
    if (attackSelect.value === '0') attackSkillId = 0;
    if (buffSelect.value === '0') buffSkillId = 0;
    syncInputs();
  }

  function updatePotionSlots(game: GameplayState) {
    const rows = (game.quickSlots ?? []).filter(row => row.kind === 0x46 && row.slot >= 1 && row.slot <= 40);
    const signature = rows.map(row => row.slot + ':' + row.payload).join(',');
    if (signature === cachedItemSignature) return;
    cachedItemSignature = signature;
    const options = [
      { id: 0, label: 'Chọn ô có thuốc trong hotbar' },
      ...rows.map(row => ({
        id: row.slot,
        label: 'Ô ' + row.slot + ' · ' + (game.inventory.find(item => item.slot === row.payload + 13)?.name || 'Vật phẩm đã gán')
      }))
    ];
    fillSelect(hpSelect, options, hpSlot);
    fillSelect(mpSelect, options, mpSlot);
    if (hpSelect.value === '0') hpSlot = 0;
    if (mpSelect.value === '0') mpSlot = 0;
  }

  function savePotions() {
    if (!frame?.world || !frame.gameplay) {
      notice.textContent = 'Vào nhân vật trước khi lưu cài đặt thuốc HP/MP.';
      return false;
    }
    const game = frame.gameplay;
    const assigned = new Set((game.quickSlots ?? []).filter(r => r.kind === 0x46).map(r => r.slot));
    if (hpOn && (!hpSlot || !assigned.has(hpSlot)) || mpOn && (!mpSlot || !assigned.has(mpSlot))) {
      notice.textContent = 'Hãy gán thuốc HP/MP vào hotbar rồi chọn đúng ô trước khi bật.';
      return false;
    }
    const previous = game.autoPotion ?? defaultAutoPotion();
    send({ kind: 'auto-potion-save', settings: {
      hp: autoPotionWord({ enabled: hpOn, percent: hpPercent, slot: hpSlot }),
      mp: autoPotionWord({ enabled: mpOn, percent: mpPercent, slot: mpSlot }),
      cure: previous.cure, timing: previous.timing
    } });
    notice.textContent = 'Đã gửi cấu hình HP/MP tới Game Server.';
    persist();
    return true;
  }

  function isSkillAvailable(game: GameplayState, skillId: number, now: number): boolean {
    const row = game.skillIndex?.get(skillId) ?? game.skillCatalog?.find(r => r.id === skillId);
    if (!row || !game.skills?.includes(skillId)) return false;
    if (skillCooldown(game.skillCooldowns ?? [], skillId, row.cooldownGroup ?? 0, now)) return false;
    const vitals = game.vitals.find(v => v.gid === game.localGid);
    if (vitals?.mp !== undefined && vitals.maxMp !== undefined &&
        vitals.mp < skillMpCost(row, vitals.maxMp)) return false;
    return true;
  }
  radiusInput.value = String(radius);
  radiusLabel.textContent = String(radius) + ' m';

  const update = () => {
    toggle.textContent = active ? 'AUTO: BẬT' : 'AUTO: TẮT';
    toggle.classList.toggle('on', active);
    toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
    state.textContent = active ? (currentGid ? 'Đang truy đuổi / đánh mục tiêu' : 'Đang tìm quái gần nhất') : stoppedReason;
    targetText.textContent = currentGid ? String(currentGid) : '—';
    countText.textContent = String(selected);
    centerText.textContent = center ? 'Điểm train: vùng ' + center.regionId + ' • ' + Math.round(center.x) + ', ' + Math.round(center.z) : 'Điểm train: chưa lưu';
  };

  const stop = (reason = 'Đã tắt Auto') => {
    if (!active) return;
    active = false;
    stoppedReason = reason;
    currentGid = null;
    attackOrigin = null;
    avoid.clear();
    // This is the existing native movement command path. It first emits the
    // target-action cancel packet to stop continued basic attacks. A same-pose
    // destination avoids an unwanted step away from the marked train point.
    if (frame?.world && frame.gameplay?.pose && frame.local?.appearanceState?.[0] !== 2 &&
        !reason.includes('điều khiển trực tiếp') && !reason.includes('thao tác trực tiếp') &&
        !reason.includes('rời khỏi thế giới')) {
      send({ kind: 'move', destination: { ...frame.gameplay.pose } });
    }
    update();
  };

  const start = () => {
    if (!frame?.world || !frame.gameplay?.pose || !frame.local || frame.local.appearanceState?.[0] === 2) {
      stoppedReason = 'Cần vào game bằng nhân vật còn sống trước khi bật Auto.';
      update();
      return;
    }
    center = { ...frame.gameplay.pose };
    selected = 0;
    currentGid = null;
    lastStep = -Infinity;
    actionAt = 0;
    lastLocalGid = frame.gameplay.localGid;
    active = true;
    avoid.clear();
    update();
  };

  const switchAuto = () => active ? stop() : start();
  toggle.addEventListener('click', switchAuto);
  settings.addEventListener('click', () => panel.classList.toggle('hidden'));
  byId<HTMLButtonElement>('auto-close').addEventListener('click', () => panel.classList.add('hidden'));
  byId<HTMLButtonElement>('auto-home').addEventListener('click', () => {
    if (frame?.world && frame.gameplay?.pose) {
      center = { ...frame.gameplay.pose };
      currentGid = null;
      avoid.clear();
      update();
    }
  });
  radiusInput.addEventListener('input', () => {
    radius = Number(radiusInput.value);
    radiusLabel.textContent = String(radius) + ' m';
    try { localStorage.setItem(RADIUS_STORAGE, String(radius)); } catch { /* optional */ }
    update();
  });

  // Capturing prevents the game canvas from treating Auto UI touches as attacks.
  for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) {
    shadow.addEventListener(name, event => event.stopPropagation());
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'F6' || event.repeat || !visibleWorld) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    switchAuto();
  };
  window.addEventListener('keydown', onKey, true);
  update();

  return {
    stop,
    manual(command: GameplayCommand) {
      if (active && ['move','ground-move','attack','skill','pickup','pickup-nearest','select','return-cancel','mount'].includes(command.kind)) {
        stop('Đã dừng Auto vì người chơi thao tác trực tiếp.');
      }
    },
    step(next: AutoFrame) {
      frame = next;
      if (visibleWorld !== next.world) {
        visibleWorld = next.world;
        tools.classList.toggle('hidden', !next.world);
        if (!next.world) panel.classList.add('hidden');
      }
      if (!next.world || !next.gameplay?.pose || !next.local) {
        stop('Đã dừng Auto: rời khỏi thế giới hoặc mất kết nối.');
        lastLocalGid = null;
        return;
      }
      if (!active) return;
      if (lastLocalGid !== next.gameplay.localGid) {
        stop('Đã dừng Auto: thay đổi nhân vật.');
        return;
      }
      if (next.local.appearanceState?.[0] === 2) {
        stop('Đã dừng Auto: nhân vật đã chết.');
        return;
      }
      if (next.local.mountedOn) {
        stop('Đã dừng Auto: nhân vật đang cưỡi thú.');
        return;
      }
      if (!center || next.now - lastStep < ACTION_INTERVAL_MS) return;
      lastStep = next.now;
      for (const [gid, expires] of avoid) if (expires <= next.now) avoid.delete(gid);
      const current = next.entities.find(e => e.gid === currentGid && e.kind === 'monster' && e.appearanceState?.[0] !== 2);
      if (current && distance(center, current) <= radius * UNIT_PER_METER) {
        if (attackOrigin && next.now - actionAt > STUCK_AFTER_MS &&
            distance(next.gameplay.pose, attackOrigin) < MIN_MOVEMENT_UNITS &&
            distance(next.gameplay.pose, current) > 80) {
          avoid.set(current.gid, next.now + STUCK_RETRY_MS);
          currentGid = null;
          attackOrigin = null;
          update();
        }
        return;
      }
      currentGid = null;
      const chosen = pickAutoTrainMonster(next.entities, center, next.gameplay.pose, radius, new Set(avoid.keys()));
      if (!chosen) {
        update();
        return;
      }
      currentGid = chosen.gid;
      selected++;
      actionAt = next.now;
      attackOrigin = { ...next.gameplay.pose };
      // Commands go through the same gameplay simulation/server authority as clicks.
      send({ kind: 'select', gid: chosen.gid });
      send({ kind: 'attack', gid: chosen.gid });
      update();
    },
    dispose() {
      stop();
      window.removeEventListener('keydown', onKey, true);
      host.remove();
    }
  };
}
