import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.HIEUSRO_AUTO_POLICY_FILE || '/opt/hieusro/server/.state/auto-policy.json';
const DEFAULT = Object.freeze({ enabled: true, maxRadius: 100, maxMinutes: 1440, updatedAt: 0 });

function verified(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Chính sách Auto phải là object.');
  if (typeof input.enabled !== 'boolean') throw new Error('Trạng thái Auto phải là true/false.');
  const {maxRadius, maxMinutes} = input;
  if (!Number.isInteger(maxRadius) || maxRadius < 10 || maxRadius > 100 || maxRadius % 10) throw new Error('Phạm vi tối đa: 10–100m (bước 10m).');
  if (!Number.isInteger(maxMinutes) || maxMinutes < 15 || maxMinutes > 1440) throw new Error('Thời lượng Auto: 15–1440 phút.');
  return {enabled: input.enabled, maxRadius, maxMinutes};
}

export function readAutoPolicy() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {...verified(parsed),updatedAt:Number(parsed.updatedAt)||0};
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[auto-policy] Invalid/missing policy, using safe defaults:',error.message);
    return {...DEFAULT};
  }
}

export function saveAutoPolicy(input) {
  const policy = {...verified(input),updatedAt:Date.now()};
  fs.mkdirSync(path.dirname(FILE),{recursive:true,mode:0o700});
  const tmp = FILE + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp,JSON.stringify(policy)+'\n',{mode:0o600,flag:'w'});
    fs.renameSync(tmp,FILE);
  } finally {
    try {fs.unlinkSync(tmp)} catch {}
  }
  return policy;
}
