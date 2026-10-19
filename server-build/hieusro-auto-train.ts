/*
 * HieuSRO Auto Train, phase 1 (online only).
 * Built into the real OpenSRO runtime and uses the normal gameplay action lane.
 * Never computes damage, rewards, drops or movement server-side.
 */
import type { EntityState } from '@/engine/contracts/world';
import type { GameplayCommand, GameplayState, Pose } from '@/engine/contracts/gameplay';

const UNIT_PER_METER = 10;
const REGION_SIZE = 1920;
const ACTION_INTERVAL_MS = 650;
const STUCK_AFTER_MS = 14000;
const STUCK_RETRY_MS = 18000;
const MIN_MOVEMENT_UNITS = 12;
const RADIUS_STORAGE = 'hieusro:auto-train:radius:v1';

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
    '@media(max-height:440px){.tools{bottom:10px}.panel{bottom:64px;max-height:calc(100vh - 75px)}}',
    '</style>',
    '<div class="tools hidden" id="auto-tools">',
    '  <button id="auto-toggle" class="start" type="button" aria-label="Bật hoặc tắt Auto Train">AUTO: TẮT</button>',
    '  <button id="auto-settings" class="settings" type="button" aria-label="Cài đặt Auto Train">⚙</button>',
    '</div>',
    '<section id="auto-panel" class="panel hidden" role="dialog" aria-label="Cài đặt Auto Train">',
    '  <div class="top"><h2>AUTO TRAIN <span class="sub">v1.0</span></h2><button id="auto-close" type="button">✕</button></div>',
    '  <div id="auto-state" class="state" role="status">Chưa bật Auto</div>',
    '  <div class="stat"><div><small>Đã chọn mục tiêu</small><strong id="auto-count">0</strong></div>',
    '  <div><small>Mục tiêu hiện tại</small><strong id="auto-target">—</strong></div></div>',
    '  <label for="auto-radius">Bán kính train <strong id="auto-radius-label">40 m</strong></label>',
    '  <input id="auto-radius" type="range" min="10" max="100" step="10" value="40"/>',
    '  <div class="row"><button id="auto-home" type="button">Lấy vị trí hiện tại</button></div>',
    '  <p id="auto-center" class="sub">Điểm train: chưa lưu</p>',
    '  <p class="help">F6 bật/tắt. Nhân vật tự chọn quái gần nhất, server tự đuổi và đánh thường. Click vào bản đồ để dừng Auto. Chưa có Skill, Buff, nhặt đồ hoặc Offline Auto.</p>',
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
  let radius = storedRadius();
  let frame: AutoFrame | null = null;
  let active = false;
  let selected = 0;
  let currentGid: number | null = null;
  let lastStep = -Infinity;
  let actionAt = 0;
  let attackOrigin: Pose | null = null;
  let center: Pose | null = null;
  let lastLocalGid: number | null = null;
  let visibleWorld = false;
  let stoppedReason = 'Chưa bật Auto';
  const avoid = new Map<number, number>();
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
    // Intentionally don't send a fake move or an attack-cancel command here.
    // Native server may finish the last basic swing. Manual input replaces it.
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
