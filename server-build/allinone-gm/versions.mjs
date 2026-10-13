const RENDER_API = 'https://api.render.com/v1';
const RENDER_KEY = String(process.env.HIEUSRO_RENDER_API_KEY || '').trim();
const GAME_SERVICE_ID = String(process.env.HIEUSRO_RENDER_GAME_SERVICE_ID || 'srv-db6d917lot8c739pbreg').trim();
const GAME_PUBLIC_URL = String(process.env.HIEUSRO_GAME_PUBLIC_URL || 'https://hieusro-game-server.onrender.com').replace(/\/$/, '');

const versions = [
  {
    id: 'v0.7.0', commit: '3f844e8e4544892547e65885b3d2dc633fde085e', deployId: 'dep-db6imvqj9qps73chi39g',
    title: 'Item localization hiện tại', score: 100, risk: 'green',
    summary: 'Bản Game Server đang dùng. Giữ patch tên vật phẩm trong catalog tiếng Việt.',
    client: 'Tương thích client HieuSRO hiện tại.', gm: 'Tương thích GM supervisor hiện tại.',
    database: 'Không rollback database; dữ liệu người chơi giữ nguyên.'
  },
  {
    id: 'v0.6.0', commit: 'cd554604fd157c85e99238a0bffd01574f0e5a3f', deployId: 'dep-db6h0grrjlhs73enq650',
    title: 'Exact item localization symbols', score: 100, risk: 'green',
    summary: 'Cây source server trùng nội dung với v0.7.0; khác mốc triển khai/commit.',
    client: 'Tương thích client hiện tại.', gm: 'Tương thích GM hiện tại.',
    database: 'Không rollback database; dữ liệu người chơi giữ nguyên.'
  },
  {
    id: 'v0.5.0', commit: 'ab590807955596f130cbc321a24cb96e04461087', deployId: 'dep-db6fuvtckfvc73db5mi0',
    title: 'TCVN3 → Unicode', score: 96, risk: 'yellow',
    summary: 'Khác chủ yếu ở lớp xử lý catalog tiếng Việt; gameplay/runtime không đổi đáng kể.',
    client: 'Client hiện tại vẫn dùng được, nhưng tên item/localization mới hơn có thể mất.', gm: 'Tương thích GM supervisor.',
    database: 'Không rollback database; dữ liệu người chơi giữ nguyên.'
  },
  {
    id: 'v0.4.0', commit: 'b655d7ecb554719f0c6f627de8442ea7fad32581', deployId: 'dep-db6fe4ajnfac73dj074g',
    title: 'Nền i18n tiếng Việt', score: 90, risk: 'yellow',
    summary: 'Có endpoint i18n nhưng chưa có các sửa TCVN3 và item localization mới hơn.',
    client: 'Có thể chạy với client hiện tại; chất lượng text tiếng Việt thấp hơn.', gm: 'Tương thích GM supervisor.',
    database: 'Không rollback database; dữ liệu người chơi giữ nguyên.'
  },
  {
    id: 'v0.3.0', commit: 'd34bfcb97515a427480e89e4e55daeb51f6dd3ce', deployId: 'dep-db6eg92vcj2c73fsu8f0',
    title: 'GameWorld qua GM supervisor', score: 55, risk: 'orange',
    summary: 'Có GM supervisor và rate control, nhưng chưa có pipeline i18n mà client Việt hiện tại đang gọi.',
    client: 'Client tiếng Việt hiện tại có nguy cơ dừng khi tải catalog /i18n.', gm: 'GM gameplay/rate cơ bản còn tương thích.',
    database: 'Không thấy migration DB trong chênh lệch version; database không rollback.'
  },
  {
    id: 'v0.2.0', commit: 'a8a26a2df5d537488395e9f3c903a43d18ea7f13', deployId: 'dep-db6e5mdckfvc73d585n0',
    title: 'Managed provisioning entrypoint', score: 30, risk: 'red',
    summary: 'Bản trước GM supervisor/rate control và trước hệ thống i18n hiện tại.',
    client: 'Không phù hợp client tiếng Việt hiện tại.', gm: 'Web GM hiện tại sẽ mất nhiều API điều khiển GameWorld.',
    database: 'Database không tự rollback; chỉ build artifact server đổi.'
  },
  {
    id: 'v0.1.0', commit: '573649da402a7c4c738d4c06dde57026b24485a4', deployId: 'dep-db6dt02d0e5s73ack3kg',
    title: 'Runtime thành công đầu tiên', score: 20, risk: 'red',
    summary: 'Mốc server HieuSRO đầu tiên chạy thành công; thiếu các lớp quản trị và tương thích hiện tại.',
    client: 'Không khuyến nghị với client hiện tại.', gm: 'Không tương thích đầy đủ Web GM hiện tại.',
    database: 'Database không tự rollback; chỉ build artifact server đổi.'
  }
];

const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled']);
let activeJob = null;

export class VersionError extends Error {
  constructor(status, message, code = 'VERSION_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renderRequest(path, { method = 'GET', body } = {}) {
  if (!RENDER_KEY) throw new VersionError(503, 'Chưa cấu hình khóa Render API cho Web GM.', 'DEPLOY_CONTROL_DISABLED');
  const response = await fetch(`${RENDER_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${RENDER_KEY}`,
      'Accept': 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = data?.message || data?.error || `Render API HTTP ${response.status}`;
    throw new VersionError(response.status, String(message), 'RENDER_API_ERROR');
  }
  return data;
}

function deployRows(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.deploys) ? value.deploys : [];
  return rows.map(row => row?.deploy || row).filter(Boolean);
}

async function liveDeploy() {
  const rows = deployRows(await renderRequest(`/services/${encodeURIComponent(GAME_SERVICE_ID)}/deploys?limit=20`));
  return rows.find(row => row.status === 'live') || rows[0] || null;
}

async function waitDeploy(deployId, job, field = 'renderStatus') {
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    const row = await renderRequest(`/services/${encodeURIComponent(GAME_SERVICE_ID)}/deploys/${encodeURIComponent(deployId)}`);
    job[field] = row?.status || 'unknown';
    job.updatedAt = new Date().toISOString();
    if (row?.status === 'live') return row;
    if (FAILED.has(row?.status)) throw new Error(`Render deploy ${row.status}`);
    await sleep(4000);
  }
  throw new Error('Render deploy timeout');
}

async function gameReady() {
  for (let i = 0; i < 18; i++) {
    try {
      const response = await fetch(`${GAME_PUBLIC_URL}/api/title/servers`, {
        headers: { 'Accept': 'application/json', 'X-OpenSRO-Protocol': '6' },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) return true;
    } catch {}
    await sleep(5000);
  }
  return false;
}

async function recover(job) {
  if (!job.restoreDeployId) return false;
  job.phase = 'restoring';
  job.updatedAt = new Date().toISOString();
  const restore = await renderRequest(`/services/${encodeURIComponent(GAME_SERVICE_ID)}/rollback`, {
    method: 'POST', body: { deployId: job.restoreDeployId }
  });
  job.restoreActionDeployId = restore.id;
  await waitDeploy(restore.id, job, 'restoreRenderStatus');
  if (!(await gameReady())) throw new Error('Build khôi phục đã live nhưng Game Server chưa sẵn sàng.');
  job.phase = 'restored';
  job.updatedAt = new Date().toISOString();
  return true;
}

async function monitor(job) {
  try {
    job.phase = 'deploying';
    await waitDeploy(job.actionDeployId, job);
    job.phase = 'health-check';
    job.updatedAt = new Date().toISOString();
    if (!(await gameReady())) throw new Error('Deploy đã live nhưng health-check Game Server thất bại.');
    job.phase = 'live';
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.error = String(error?.message || error);
    job.phase = 'failed';
    job.updatedAt = new Date().toISOString();
    try {
      await recover(job);
    } catch (restoreError) {
      job.restoreError = String(restoreError?.message || restoreError);
      job.phase = 'restore-failed';
      job.updatedAt = new Date().toISOString();
    }
  }
}

function publicJob() {
  if (!activeJob) return null;
  return { ...activeJob };
}

async function detectedCurrentVersion() {
  if (!RENDER_KEY) return 'v0.7.0';
  try {
    const live = await liveDeploy();
    const commit = String(live?.commit?.id || '');
    return versions.find(row => row.commit === commit)?.id || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function versionSnapshot() {
  const current = await detectedCurrentVersion();
  return {
    ok: true,
    current,
    rollbackEnabled: Boolean(RENDER_KEY),
    gameServiceId: GAME_SERVICE_ID,
    activeJob: publicJob(),
    versions: versions.map(row => ({ ...row, current: row.id === current })),
    policy: {
      database: 'never-automatic',
      gm: 'independent',
      client: 'independent',
      forceFor: ['orange', 'red'],
      autoRestoreOnFailedDeploy: true
    }
  };
}

export async function rollbackVersion(versionId, { force = false, onlinePlayers = 0 } = {}) {
  const target = versions.find(row => row.id === versionId);
  if (!target) throw new VersionError(404, 'Không tìm thấy version rollback.', 'VERSION_NOT_FOUND');
  if (!RENDER_KEY) throw new VersionError(503, 'Version Manager đã sẵn sàng nhưng chưa có khóa Render API.', 'DEPLOY_CONTROL_DISABLED');
  if (activeJob && !['live', 'restored', 'failed', 'restore-failed'].includes(activeJob.phase)) {
    throw new VersionError(409, 'Đang có một rollback khác chạy.', 'ROLLBACK_BUSY');
  }
  const current = await liveDeploy();
  if (!current?.id) throw new VersionError(503, 'Không xác định được deploy đang chạy.', 'LIVE_DEPLOY_UNKNOWN');
  if (String(current.commit?.id || '') === target.commit) {
    throw new VersionError(409, `${target.id} đang là version hiện tại.`, 'ALREADY_CURRENT');
  }
  if ((target.risk === 'orange' || target.risk === 'red') && !force) {
    throw new VersionError(409, 'Version này có phụ thuộc cao. Cần xác nhận rollback cưỡng bức.', 'FORCE_REQUIRED');
  }
  if (Number(onlinePlayers) > 0 && !force) {
    throw new VersionError(409, `Đang có ${onlinePlayers} người chơi online. Cần xác nhận cưỡng bức.`, 'PLAYERS_ONLINE');
  }

  const action = await renderRequest(`/services/${encodeURIComponent(GAME_SERVICE_ID)}/rollback`, {
    method: 'POST', body: { deployId: target.deployId }
  });
  activeJob = {
    id: `rollback-${Date.now()}`,
    target: target.id,
    targetCommit: target.commit,
    risk: target.risk,
    score: target.score,
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: 'queued',
    actionDeployId: action.id,
    renderStatus: action.status || 'created',
    restoreDeployId: current.id,
    restoreCommit: current.commit?.id || null,
    onlinePlayers: Number(onlinePlayers) || 0,
    forced: Boolean(force)
  };
  void monitor(activeJob);
  return publicJob();
}
