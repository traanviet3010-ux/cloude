import '../helpers/native-source-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { pickAutoTrainMonster, pickAutoTrainDrop } = await import('../../src/engine/runtime/auto-train/auto-train.ts');
const center = { regionId: 0x0101, x: 400, y: 0, z: 400, angle: 0 };
const entity = (gid, kind, x, z, options = {}) => ({
  gid, kind, regionId: 0x0101, x, y: 0, z, heading: 0,
  name: 'unit_' + gid, refObjId: 123, ...options
});

test('chooses the closest live monster to player within saved train circle', () => {
  const monsters = [
    entity(2, 'monster', 450, 410),
    entity(3, 'monster', 403, 403),
    entity(1, 'monster', 800, 400),
    entity(11, 'player', 401, 401)
  ];
  assert.equal(pickAutoTrainMonster(monsters, center, center, 20)?.gid, 3);
});

test('never targets dead monsters, other players or ground items', () => {
  const mobs = [
    entity(1, 'monster', 402, 402, { appearanceState: [2] }),
    entity(2, 'player', 403, 403),
    entity(3, 'ground-item', 404, 404),
    entity(4, 'monster', 450, 450)
  ];
  assert.equal(pickAutoTrainMonster(mobs, center, center, 30)?.gid, 4);
});

test('honours avoid-list and radius validation', () => {
  const mobs = [entity(1, 'monster', 405, 405), entity(2, 'monster', 410, 410)];
  assert.equal(pickAutoTrainMonster(mobs, center, center, 40, new Set([1]))?.gid, 2);
  assert.equal(pickAutoTrainMonster(mobs, center, center, 1), null);
  assert.equal(pickAutoTrainMonster(mobs, center, center, NaN), null);
  assert.equal(pickAutoTrainMonster([entity(9, 'monster', 1401, 400)], center, center, 100), null);
});

test('cross-region monster uses global map distance rather than local coordinate', () => {
  const nearbyBorder = {...center, x: 1880};
  const nextRegionMonster = entity(8, 'monster', 18, 400, {regionId: 0x0102});
  assert.equal(pickAutoTrainMonster([nextRegionMonster], nearbyBorder, nearbyBorder, 10)?.gid, 8);
  assert.equal(pickAutoTrainMonster([nextRegionMonster], nearbyBorder, nearbyBorder, 3), null);
});

test('does not mistake same-region equal distance, tie resolves by GID', () => {
  const mobs=[entity(21,'monster',410,400),entity(6,'monster',390,400)];
  assert.equal(pickAutoTrainMonster(mobs,center,center,10)?.gid,6);
});

test('post-kill loot respects ownership, dropper and gold/item filters', () => {
  const drop = (gid, gold, claimantGid, dropperGid) => ({
    ...entity(gid,'ground-item',400+gid,400),
    groundItem:{typeFlags:1,goldAmount:gold,tint:0,claimantGid,dropperGid}
  });
  const list=[
    drop(1,400,321,90), // another player's gold
    drop(2,100,42,91), // unrelated kill
    drop(3,200,42,90),
    drop(4,0,42,90)
  ];
  assert.equal(pickAutoTrainDrop(list,center,center,40,42,90,true,false)?.gid,3);
  assert.equal(pickAutoTrainDrop(list,center,center,40,42,90,false,true)?.gid,4);
  assert.equal(pickAutoTrainDrop(list,center,center,40,42,90,false,false),null);
  assert.equal(pickAutoTrainDrop(list,center,center,40,42,90,true,true,new Set([3]))?.gid,4);
});

test('server drop with no claim still remains in saved train area', () => {
  const item={...entity(12,'ground-item',1400,400),
    groundItem:{typeFlags:1,goldAmount:0,tint:0}};
  assert.equal(pickAutoTrainDrop([item],center,center,40,1,90,true,true),null);
});

test('Auto Train bootstrap UI must declare every referenced DOM ID', () => {
  const source = readFileSync(new URL('../../src/engine/runtime/auto-train/auto-train.ts', import.meta.url), 'utf8');
  const markup = source.split('shadow.innerHTML = [')[1]?.split("].join('');")[0];
  assert.ok(markup, 'Auto Train UI template must remain inspectable');
  const refs = [...source.matchAll(/byId<[^>]+>\('([^']+)'\)/g)].map(row => row[1]);
  assert.ok(refs.length > 20, 'Expected core Auto controls');
  for (const id of refs) {
    assert.ok(markup.includes('id="' + id + '"'), 'Missing Auto Train control #' + id);
  }
});
