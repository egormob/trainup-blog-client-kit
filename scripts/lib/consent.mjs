import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../../kit/consent/', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const json = value => {
  const encode = v => Array.isArray(v) ? '[' + v.map(encode).join(', ') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + encode(x)).join(', ') + '}' : JSON.stringify(v);
  return encode(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
};
const render = (text, values) => text.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error('Unknown template field: ' + key);
  return values[key];
});
const contained = (root, name) => {
  if (!name || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(x => !x || x === '..' || x === '.')) throw new Error('Invalid manifest path');
  return path.join(root, ...name.split('/'));
};

export async function loadConsent(templateRoot = defaultRoot) {
  const manifest = JSON.parse(await readFile(path.join(templateRoot, 'manifest.json'), 'utf8'));
  if (manifest.id !== 'consent-policy-landing' || manifest.version !== '1.2.0') throw new Error('Unsupported consent template');
  const files = {};
  for (const [name, digest] of Object.entries(manifest.files)) {
    const file = contained(templateRoot, name);
    if (!(await lstat(file)).isFile()) throw new Error('Invalid template file');
    const data = await readFile(file);
    if (hash(data) !== digest) throw new Error('Template checksum mismatch: ' + name);
    files[name] = data;
  }
  return { files, manifest };
}

export function validateConsent(s, full = false) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Explicit consent settings required');
  const common = ['slug', 'policyUrl', 'consentUrl', 'offerUrl', 'advertisingConsentUrl', 'consentVersion', 'buttonGoal', 'readyGoal', 'brandName', 'brandUrl', 'operatorRequisites', 'contactTelegramUrl', 'phone', 'phoneDisplay', 'email'];
  const optionalUrls = ['telegramUrl', 'vkUrl'].filter(k => s[k] !== undefined);
  const fields = [...common, ...optionalUrls, ...(full ? ['pageUrl', 'telegramUrl', 'vkUrl', 'title', 'description', 'intro', 'lead', 'heroAlt'] : [])];
  if (fields.some(k => typeof s[k] !== 'string' || !s[k].trim())) throw new Error('Required explicit text settings: ' + fields.join(', '));
  // This field names a browser storage key, not a filesystem path. Match the
  // existing article-id limit; numeric and one-character routes remain valid.
  if (s.slug.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug)) throw new Error('Invalid slug');
  if (!Number.isSafeInteger(s.counterId) || s.counterId < 0) throw new Error('Invalid counterId');
  if (['newsletterEnabled', 'serviceIdsEnabled'].some(k => typeof s[k] !== 'boolean')) throw new Error('Explicit service booleans required');
  const urls = [...optionalUrls, 'policyUrl', 'consentUrl', 'offerUrl', 'advertisingConsentUrl', 'brandUrl', 'contactTelegramUrl', ...(full ? ['pageUrl', 'telegramUrl', 'vkUrl'] : [])];
  for (const field of urls) {
    const url = new URL(s[field]);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || /[\s<>"\x00-\x1f]/.test(s[field])) throw new Error('Unsafe HTTPS URL: ' + field);
  }
  if (full && (new URL(s.pageUrl).search || new URL(s.pageUrl).hash)) throw new Error('Canonical pageUrl cannot contain query/fragment');
  if (!/^\+[1-9][0-9]{7,14}$/.test(s.phone) || !/^[^@\s<>"\x00-\x1f]+@[^@\s<>"\x00-\x1f]+\.[^@\s<>"\x00-\x1f]+$/.test(s.email)) throw new Error('Invalid phone/email');
  if (full && (!Array.isArray(s.benefits) || !s.benefits.length || s.benefits.some(x => typeof x !== 'string' || !x.trim()))) throw new Error('Text benefits required');
  return s;
}

export function renderConsent(source, settings) {
  validateConsent(settings);
  const values = Object.fromEntries(Object.entries(settings).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, escape(v)]));
  values.subscriptionCopy = settings.newsletterEnabled ? ' <span class="channel-subscription">Нажимая «Начать», соглашаюсь получать <a href="' + values.advertisingConsentUrl + '" target="_blank" rel="noopener">новостную и рекламную рассылку</a>.</span>' : '';
  values.newsletterFooter = settings.newsletterEnabled ? ' ·\n<a href="' + values.advertisingConsentUrl + '">Согласие на рассылку</a>' : '';
  let controls = render(source.files['controls.html'].toString(), values);
  if (!settings.counterId) {
    controls = controls.replace(/\s*<p class="cookie-dialog__purpose"[^>]*>[\s\S]*?<\/p>/g, '').replace(' Данные об использовании сайта передаются в Яндекс.Метрику.', '').replace('Разрешите аналитику или настройте cookie.', 'Подтвердите согласие или настройте cookie.');
  }
  const rawFooter = render(source.files['footer.html'].toString(), values);
  const footer = rawFooter.replace('<footer ', '<div ').replace('</footer>', '</div>').replace('class="article-footer"', 'class="article-footer landing-consent-footer"');
  const config = { counterId: settings.counterId, buttonGoal: settings.buttonGoal, readyGoal: settings.readyGoal, mode: 'template-clone', bridgeEnabled: false, preferenceKey: settings.slug + '-cookie-choice-v1', consentVersion: settings.consentVersion, subscriptionIndependent: false, newsletterEnabled: settings.newsletterEnabled, serviceIdsEnabled: settings.serviceIdsEnabled };
  const boot = "(() => { const start = () => {\n" + source.files['cookie-consent.js'] + '\n' + source.files['consent-analytics.js'] + "\n}; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start(); })();";
  const snippet = '<div class="landing-consent-component">\n<style>' + source.files['consent.css'] + '</style>\n<script>window.__IIK_CONSENT_CONFIG__ = ' + json(config) + ';\n' + source.files['guard.js'] + '</script>\n' + controls + '<script>' + boot + '</script>\n</div>';
  return { snippet, footer, rawFooter, controls, config, values };
}

function tags(markup) {
  return [...markup.matchAll(/<([a-z][a-z0-9:-]*)\b([^<>]*?)>/gi)].map(([, tag, text]) => {
    const attrs = {};
    for (const [, key, double, single, bare] of text.matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[key.toLowerCase()] = double ?? single ?? bare ?? '';
    return { tag: tag.toLowerCase(), attrs };
  });
}

export function insertConsent(markup, component) {
  for (const marker of ['<!-- LANDING_CONSENT -->', '<!-- LANDING_LEGAL_FOOTER -->']) if (markup.split(marker).length !== 2) throw new Error('Expected exactly one marker: ' + marker);
  let actions = 0;
  for (const { tag, attrs } of tags(markup)) {
    if (['channel-consent', 'cookie-settings'].includes(attrs.id)) throw new Error('Existing consent component');
    if (tag === 'script' && /mc\.yandex\.|googletagmanager\.|google-analytics\.|top-fwz1\.mail\.ru/i.test(attrs.src ?? '')) throw new Error('Tracker outside consent component');
    if ('data-consent-cta' in attrs || 'data-channel' in attrs) {
      actions++;
      if (!(attrs['data-consent-cta'] || attrs['data-channel'])) throw new Error('CTA action required');
      if (tag === 'a' && /^https:/i.test(attrs.href ?? '') && (attrs.target !== '_blank' || !attrs.rel?.split(/\s+/).includes('noopener'))) throw new Error('External CTA requires target=_blank rel=noopener');
    }
  }
  if (!actions) throw new Error('Mark intended CTAs with data-consent-cta');
  if (/(?:\bym\s*\([^;\n]*["']init["']|\bgtag\s*\(|googletagmanager\.|mc\.yandex\.)/i.test(markup)) throw new Error('Remove existing tracker before consent integration');
  return markup.replace('<!-- LANDING_CONSENT -->', () => component.snippet).replace('<!-- LANDING_LEGAL_FOOTER -->', () => component.footer);
}

export async function buildConsent({ settings, outputRoot, templateRoot, page, componentOnly = false }) {
  if (!outputRoot || (page !== undefined && componentOnly)) throw new Error('Output and one build mode required');
  const full = page === undefined && !componentOnly;
  validateConsent(settings, full);
  try { await lstat(outputRoot); throw new Error('Refuse to overwrite an existing project'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const source = await loadConsent(templateRoot);
  const component = renderConsent(source, settings);
  const files = { 'consent-component.html': component.snippet, 'legal-footer.html': component.footer };
  if (page !== undefined) files['index.html'] = insertConsent(page, component);
  else if (full) {
    const values = { ...component.values, consentConfig: json(component.config), guard: source.files['guard.js'].toString(), controls: component.controls, footer: component.rawFooter, benefitsItems: settings.benefits.map(x => '<li>' + escape(x) + '</li>').join(''), pageUrl: escape(settings.pageUrl.replace(/\/+$/, '') + '/') };
    files['index.html'] = render(source.files['starter.html'].toString(), values);
    for (const [name, data] of Object.entries(source.files)) if (['cookie-consent.js', 'consent-analytics.js', 'template.css', 'landing.css', 'consent.css'].includes(name) || name.startsWith('assets/')) files[name] = data;
  }
  files['CONSENT-README.md'] = source.files['README.md'];
  files['project-settings.json'] = JSON.stringify(settings, null, 2) + '\n';
  const receipt = { templateId: source.manifest.id, templateVersion: source.manifest.version, sourceCommit: source.manifest.sourceCommit, mode: full ? 'full-page' : componentOnly ? 'component-only' : 'custom-design', sha256: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)])) };
  await mkdir(outputRoot, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const file = contained(outputRoot, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  }
  await writeFile(path.join(outputRoot, 'template-manifest.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

export async function verifyConsent(outputRoot) {
  const receipt = JSON.parse(await readFile(path.join(outputRoot, 'template-manifest.json'), 'utf8'));
  if (receipt.templateId !== 'consent-policy-landing' || receipt.templateVersion !== '1.2.0') throw new Error('Unknown consent output');
  for (const [name, digest] of Object.entries(receipt.sha256)) if (hash(await readFile(contained(outputRoot, name))) !== digest) throw new Error('Output checksum mismatch: ' + name);
  if (!['full-page', 'component-only', 'custom-design'].includes(receipt.mode)) throw new Error('Unknown build mode');
  const markup = await readFile(path.join(outputRoot, receipt.mode === 'component-only' ? 'consent-component.html' : 'index.html'), 'utf8');
  for (const id of ['channel-consent', 'cookie-settings']) if (tags(markup).filter(x => x.attrs.id === id).length !== 1) throw new Error('Missing/duplicate consent control');
  const elements = tags(markup);
  for (const hook of ['data-cookie-settings', 'data-cookie-accept', 'data-cookie-save', 'data-consent-notice']) if (elements.filter(x => hook in x.attrs).length !== 1) throw new Error('Missing/duplicate component hook: ' + hook);
  const matches = [...markup.matchAll(/window\.__IIK_CONSENT_CONFIG__ = ([^\n]+);\n/g)];
  if (matches.length !== 1) throw new Error('One configuration required');
  const config = JSON.parse(matches[0][1]);
  const settings = JSON.parse(await readFile(path.join(outputRoot, 'project-settings.json'), 'utf8'));
  for (const key of ['counterId', 'buttonGoal', 'readyGoal', 'consentVersion', 'newsletterEnabled', 'serviceIdsEnabled']) if (config[key] !== settings[key]) throw new Error('Wrong project configuration');
  if (['deliveryEndpoint', 'identityEndpoint'].some(k => k in config)) throw new Error('Unexpected cloud connection');
  if (receipt.mode !== 'component-only') {
    const links = new Set(elements.filter(x => x.tag === 'a').map(x => x.attrs.href));
    const required = ['policyUrl', 'consentUrl', 'offerUrl', ...(settings.newsletterEnabled ? ['advertisingConsentUrl'] : [])];
    if (required.some(k => !links.has(escape(settings[k])))) throw new Error('Missing project legal document link');
    const actions = elements.filter(x => 'data-channel' in x.attrs || 'data-consent-cta' in x.attrs);
    if (!actions.length) throw new Error('Missing consent-controlled CTA');
    if (actions.some(x => /^https:/i.test(x.attrs.href ?? '') && (x.attrs.target !== '_blank' || !x.attrs.rel?.split(/\s+/).includes('noopener')))) throw new Error('External CTA must retain original document');
  }
  if (config.preferenceKey !== settings.slug + '-cookie-choice-v1' || config.bridgeEnabled !== false) throw new Error('Inherited consent settings');
  return { ok: true, mode: receipt.mode, filesVerified: Object.keys(receipt.sha256).length, browserChecksRequired: true };
}
