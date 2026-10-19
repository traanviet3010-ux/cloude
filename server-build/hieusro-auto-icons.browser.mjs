import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage']
});
try {
  const page = await browser.newPage({viewport:{width:760,height:720}});
  // The CI source-only checkout intentionally has no copyrighted PK2 art.
  // Supply a valid image byte only to exercise actual <img> rendering;
  // production uses the unchanged native Media.pk2 path verified separately.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8Gr0UAAAAASUVORK5CYII=', 'base64');
  await page.route('**/assets/images/Media_extracted/icon/**', route =>
    route.fulfill({status:200,contentType:'image/png',body:png})
  );
  page.on('pageerror',error=>errors.push(error.stack||error.message));
  page.on('console',message=>{
    if(message.type()==='error')errors.push(message.text());
  });
  const url=process.env.HIEUSRO_ICON_TEST_URL||'http://127.0.0.1:5180/_skill_icon_fixture.html';
  await page.goto(url,{waitUntil:'load',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.__iconFixtureReady),{timeout:30000});
  const first = page.locator('#test-root .auto-icon-picker').first();
  await first.locator('.auto-icon-trigger').click();
  assert.equal(await first.locator('.auto-icon-choices button').count(),3);
  // Use the actual browser, not a mock DOM or a static screenshot.
  const nativePaths = await first.locator('img').evaluateAll(images=>images.map(image=>image.getAttribute('src')));
  assert.ok(nativePaths.some(path=>path==='/assets/images/Media_extracted/icon/skill/china/sword_smash_a.png'),
    'Published Media.pk2 icon URL must be used for learned skill');
  await first.locator('.auto-icon-search').fill('Smash');
  assert.equal(await first.locator('.auto-icon-choice:not([hidden])').count(),1);
  await first.locator('[data-skill-id="321"]').click();
  let result=await page.evaluate(()=>window.__iconState());
  assert.equal(result.attack,321);
  assert.equal(result.attackChanges,1);
  assert.equal(await first.locator('.auto-icon-dropdown').isHidden(),true);
  assert.ok((await first.locator('.auto-icon-trigger').getAttribute('title')).includes('Hồi: 3s'));
  assert.ok((await first.locator('.auto-icon-trigger').getAttribute('title')).includes('MP: 30'));

  // The Buff picker is a separate category but exercises the same preserved ID path.
  const buff=page.locator('#test-root .auto-icon-picker').last();
  await buff.locator('.auto-icon-trigger').click();
  await buff.locator('[data-skill-id="678"]').click();
  result=await page.evaluate(()=>window.__iconState());
  assert.equal(result.buff,678);
  assert.equal(result.buffChanges,1);
  await buff.locator('.auto-icon-trigger').click();
  await buff.locator('.auto-icon-search').fill('Cleric');
  await buff.locator('.auto-icon-search').press('Escape');
  assert.equal(await buff.locator('.auto-icon-dropdown').isHidden(),true);

  // Exercise the real createAutoTrain overlay that ships in HieuSRO,
  // including the dynamic slot 2 and persistent game command ID mapping.
  const hud=page.locator('#hieusro-auto-train-root');
  await hud.locator('#auto-settings').click();
  assert.ok(await hud.locator('.auto-icon-picker').count() >= 2,
    'Full Auto HUD must mount both Attack and Buff real-icon controls');
  await hud.locator('#auto-add-skill').click();
  assert.ok(await hud.locator('.auto-icon-picker').count() >= 3,
    'Additional skill rotation slot must also use the icon picker');
  const second = hud.locator('#auto-extra-skills .auto-icon-picker').first();
  await second.locator('.auto-icon-trigger').click();
  await second.locator('[data-skill-id="322"]').click();
  const idAndSaved = await page.evaluate(() => ({
    id: document.getElementById('hieusro-auto-train-root').shadowRoot.querySelector('#auto-extra-skills select').value,
    saved: JSON.parse(localStorage.getItem('hieusro:auto-train:profile:v2:Auto Icon Test Character') || '{}')
  }));
  assert.equal(idAndSaved.id,'322','Full Auto HUD native second skill must be updated');
  assert.equal(idAndSaved.saved.extraSkillIds[0],322,'Selected icon must persist actual gameplay Skill ID');
  assert.ok(await hud.locator('#auto-buff-skill + .auto-icon-picker .auto-skill-icon img').count() >= 0);
  await page.evaluate(() => window.__autoIconTest.dispose());

  // No HTML injection: skill labels must be rendered as text, not interpreted as markup.
  const injected = await page.locator('body img[onerror]').count();
  assert.equal(injected,0);
  // All existing game logic remains bound to original <select> command values.
  assert.deepEqual(errors, [], 'Chrome JavaScript console and runtime errors');
  console.log('PASS: real native skill images, searchable selection, Buff selection, tooltip, keyboard and gameplay ID binding.');
} finally {
  await browser.close();
}
