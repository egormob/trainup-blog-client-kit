import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject, createArticle, initProject } from '../scripts/lib/project.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapter = await import('../scripts/lib/consent.mjs').catch(() => ({}));
const example = async () => JSON.parse(await readFile(path.join(root, 'kit/consent/settings.example.json'), 'utf8'));
const design = '<!doctype html><html><head><title>Свой дизайн</title><link rel="canonical" href="https://example.test/custom/"><script type="application/ld+json">{"@type":"Article"}</script></head><body><h1 data-blog-element-id="hero.title">Своя страница</h1><section><!-- LANDING_CONSENT --><a data-consent-cta="signup" href="https://example.test/next/" target="_blank" rel="noopener">Начать</a></section><footer><!-- LANDING_LEGAL_FOOTER --></footer></body></html>';

test('portable Node adapter is available without Python', () => {
  assert.equal(typeof adapter.buildConsent, 'function');
});

test('custom page preserves every byte outside the two markers and own configuration', async () => {
  const source = await adapter.loadConsent();
  const settings = { ...await example(), slug: 'other-client', counterId: 12345, buttonGoal: 'Client-Click' };
  const component = adapter.renderConsent(source, settings);
  const result = adapter.insertConsent(design, component);
  assert.equal(result.replace(component.snippet, '<!-- LANDING_CONSENT -->').replace(component.footer, '<!-- LANDING_LEGAL_FOOTER -->'), design);
  assert.equal(component.config.preferenceKey, 'other-client-cookie-choice-v1');
  assert.equal(component.config.counterId, 12345);
  assert.equal(component.config.bridgeEnabled, false);
  for (const name of ['guard.js', 'cookie-consent.js', 'consent-analytics.js']) assert.ok(component.snippet.includes(source.files[name].toString()));
  assert.ok(result.includes("DOMContentLoaded"));
});

test('unsafe settings, duplicate components, missing markers and early trackers are rejected', async () => {
  const source = await adapter.loadConsent();
  const settings = await example();
  for (const patch of [{ counterId: -1 }, { counterId: true }, { newsletterEnabled: 'true' }, { policyUrl: 'javascript:alert(1)' }, { telegramUrl: 'javascript:alert(1)' }, { vkUrl: 'https://example.test/" onmouseover="bad' }, { brandUrl: 'https:' + '//user:pass@example.test/' }, { slug: '../unsafe' }]) {
    assert.throws(() => adapter.renderConsent(source, { ...settings, ...patch }));
  }
  const component = adapter.renderConsent(source, settings);
  for (const page of [design.replace('<!-- LANDING_CONSENT -->', ''), design + '<!-- LANDING_CONSENT -->', design + '<input id="channel-consent">', design.replace('target="_blank"', ''), design + '<script src="https:' + '//mc.yandex.ru/metrika/tag.js"></script>', design + '<script>ym(123, "init", {});</script>']) assert.throws(() => adapter.insertConsent(page, component));
});

test('HTML and inline configuration escape script-closing data', async () => {
  const source = await adapter.loadConsent();
  const component = adapter.renderConsent(source, { ...await example(), brandName: '<img src=x onerror=alert(1)>', buttonGoal: '</script><script>alert(1)</script>' });
  assert.ok(component.footer.includes('&lt;img'));
  assert.ok(component.snippet.includes('\\u003c/script>'));
  assert.ok(!component.snippet.includes('<script>alert(1)</script>'));
});

test('zero counter omits analytics explanation and safe examples contain no author endpoints', async () => {
  const source = await adapter.loadConsent();
  const settings = await example();
  assert.equal(settings.counterId, 0);
  assert.ok(!Object.keys(source.files).some(name => /assets\/brand\/.*\.png$/.test(name)));
  assert.ok(source.files['starter.html'].toString().includes('favicon.svg'));
  assert.equal(settings.newsletterEnabled, false);
  assert.equal(settings.serviceIdsEnabled, false);
  const component = adapter.renderConsent(source, settings);
  assert.ok(!component.controls.includes('Данные об использовании сайта передаются'));
  assert.ok(!component.controls.includes('новостную и рекламную'));
  assert.ok(!JSON.stringify(settings).match(/trainup|egor|yandexcloud|987654321/i));
});

test('all source digests are enforced before rendering', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'consent-integrity-'));
  await cp(path.join(root, 'kit/consent'), dir, { recursive: true });
  await writeFile(path.join(dir, 'guard.js'), 'modified');
  await assert.rejects(adapter.loadConsent(dir), /checksum/i);
});

test('starter, component and custom modes build and verify without overwriting', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'consent-output-'));
  for (const mode of ['starter', 'component', 'custom']) {
    const outputRoot = path.join(dir, mode);
    const receipt = await adapter.buildConsent({ settings: await example(), outputRoot, componentOnly: mode === 'component', page: mode === 'custom' ? design : undefined });
    assert.equal(receipt.templateVersion, '1.2.0');
    assert.equal((await adapter.verifyConsent(outputRoot)).ok, true);
    await assert.rejects(adapter.buildConsent({ settings: await example(), outputRoot }), /overwrite/i);
  }
  await writeFile(path.join(dir, 'custom/index.html'), 'changed');
  await assert.rejects(adapter.verifyConsent(path.join(dir, 'custom')), /checksum/i);
});

test('new blog builds all three designs with consent, own storage and preserved SEO/UTM', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'consent-blog-'));
  await cp(path.join(root, 'kit'), path.join(dir, 'kit'), { recursive: true });
  await cp(path.join(root, 'blog'), path.join(dir, 'blog'), { recursive: true });
  await initProject(dir, { runner: async () => ({}) });
  for (const template of ['basic', 'advanced', 'consent']) await createArticle(dir, { slug: template + '-client', template });
  await buildProject(dir);
  for (const name of ['basic', 'advanced', 'consent']) {
    const html = await readFile(path.join(dir, 'output/articles/' + name + '-client/index.html'), 'utf8');
    assert.equal((html.match(/id="channel-consent"/g) ?? []).length, 1);
    assert.ok(html.includes(name + '-client-cookie-choice-v1'));
    assert.ok(html.includes('application/ld+json'));
    assert.ok(html.includes('blog-kit-utm-config'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(!html.includes('https://t.me/egor_bulygin'));
  }
});

test('verification enforces control hooks and cloud-free configuration even with matching output hashes', async () => {
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'consent-contract-'));
  for (const kind of ['hook', 'cloud']) {
    const outputRoot = path.join(dir, kind);
    await adapter.buildConsent({ settings: await example(), outputRoot, page: design });
    const file = path.join(outputRoot, 'index.html');
    const html = (await readFile(file, 'utf8')).replace(kind === 'hook' ? 'data-cookie-save' : '"bridgeEnabled": false', kind === 'hook' ? 'data-missing-save' : '"bridgeEnabled": false, "deliveryEndpoint": "https://example.test/private"');
    await writeFile(file, html);
    const manifestFile=path.join(outputRoot,'template-manifest.json');
    const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
    manifest.sha256['index.html']=createHash('sha256').update(html).digest('hex');
    await writeFile(manifestFile,JSON.stringify(manifest));
    await assert.rejects(adapter.verifyConsent(outputRoot), kind === 'hook' ? /hook/ : /cloud/);
  }
});

test('existing numeric, short and maximum article slugs remain valid with consent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'consent-slug-'));
  await cp(path.join(root, 'kit'), path.join(dir, 'kit'), { recursive: true });
  await cp(path.join(root, 'blog'), path.join(dir, 'blog'), { recursive: true });
  await initProject(dir, { runner: async () => ({}) });
  const slugs = ['2026-report', 'a', '1', 'a'.repeat(128)];
  for (const slug of slugs) await createArticle(dir, { slug, template: 'consent' });
  await buildProject(dir);
  for (const slug of slugs) {
    const html = await readFile(path.join(dir, 'output/articles', slug, 'index.html'), 'utf8');
    assert.ok(html.includes(slug + '-cookie-choice-v1'));
    assert.ok(html.includes('/articles/' + slug + '/'));
  }
});
