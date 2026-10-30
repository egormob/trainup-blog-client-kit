"""Assemble the approved TrainUp article components; no network or publication."""
import argparse
from datetime import datetime
import math
import hashlib
import json
from pathlib import Path
import re
import shutil
ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'templates/trainup-premium-article-v1.0.2'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def check_bundle(bundle=BUNDLE):
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    for (name, expected) in manifest['files'].items():
        path = bundle / name
        if not path.is_file() or digest(path) != expected:
            raise ValueError('Frozen template changed: ' + name)
    return manifest

def validate(settings, names, publication=False):
    if not settings.get('title') or not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', settings.get('slug', '')):
        raise ValueError('Provide title and an ASCII slug')
    sections = settings['sections']
    if len(sections) != len(set(sections)) or set(sections) - set(names):
        raise ValueError('Unknown or repeated component')
    if not sections or sections[0] != 'hero' or sections[-1] != 'footer':
        raise ValueError('Keep the shared hero first and approved footer last')
    stages = settings['calendar']['stages']
    if not stages or stages[-1]['until'] is not None:
        raise ValueError('A calendar needs a final stage without a deadline')
    native = settings.get('checkoutMode') == 'native'
    if settings.get('checkoutMode') not in ['preview', 'native']:
        raise ValueError('checkoutMode must be preview or native')
    previous = None
    stage_ids = set()
    for (index, stage) in enumerate(stages):
        if stage['id'] in stage_ids:
            raise ValueError('Calendar stage IDs must be unique')
        stage_ids.add(stage['id'])
        if index < len(stages) - 1:
            if not stage['until']:
                raise ValueError('Only the final stage may omit its deadline')
            deadline = datetime.fromisoformat(stage['until'].replace('Z', '+00:00'))
            if deadline.tzinfo is None or (previous is not None and deadline <= previous):
                raise ValueError('Deadlines need UTC offsets and increasing absolute times')
            previous = deadline
        if not stage['prices'] or any((not isinstance(price, (int, float)) or not math.isfinite(price) or price < 0 for price in stage['prices'] + stage['fullPrices'])):
            raise ValueError('Prices must be finite non-negative numbers')
        if len(stage['prices']) != len(stage['forms']) or len(stage['prices']) != len(stage['fullPrices']):
            raise ValueError('Each tariff needs one price and one form mapping per stage')
        if native and any((not all((form.get(key) for key in ['offerId', 'blockId', 'popupCode'])) for form in stage['forms'])):
            raise ValueError('Native checkout requires verified page-local form mappings')
    if publication and (settings.get('draft', True) or not native):
        raise ValueError('Draft/example or unbound checkout is not ready for publication')

def build(output, publication=False):
    instance = json.loads((output / 'template-instance.json').read_text(encoding='utf-8'))
    if instance.get('mode') == 'raw-preview':
        if publication:
            raise ValueError('Latest historical sample requires separate Admin verification before publication')
        raw = (output / 'raw-html.html').read_text(encoding='utf-8')
        (output / 'index.html').write_text('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ИИ-директор</title><body style="margin:0">' + raw + '</body></html>', encoding='utf-8')
        return {'output': str(output), 'rawSHA256': digest(output / 'raw-html.html'), 'draft': True, 'checkoutMode': 'preview'}
    settings = json.loads((output / 'settings.json').read_text(encoding='utf-8'))
    validate(settings, instance['components'], publication)
    parts = []
    continuation = False
    footer = ''
    for name in settings['sections']:
        part = (output / 'components' / (name + '.html')).read_text(encoding='utf-8')
        if name == 'footer':
            footer = part
            continue
        grouped = name in ['reviews', 'trainer']
        if grouped and (not continuation):
            parts.append('<div class="article-inner article-inner--continuation">')
            continuation = True
        if not grouped and continuation:
            parts.append('</div>')
            continuation = False
        parts.append(part)
    if continuation:
        parts.append('</div>')
    css = (output / 'styles.css').read_text(encoding='utf-8')
    runtime = (output / 'runtime.js').read_text(encoding='utf-8')
    config = json.dumps(settings['calendar'], ensure_ascii=False).replace('<', '\\u003c')
    raw = '<div id="trainup-premium-article" data-checkout-mode="' + settings['checkoutMode'] + '">\n<style>' + css + '</style>\n<a class="skip-link" href="#trainup-premium-article-main-content">Перейти к содержанию</a><main class="page" id="trainup-premium-article-main-content"><article class="article-shell" data-section-id="article"><div class="article-card"><div data-trainup-article-body>' + '\n'.join(parts) + '</div>' + footer + '</div></article></main><script type="application/json" data-calendar-config>' + config + '</script><script>' + runtime + '</script></div>\n'
    import html
    head = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    head += '<meta name="robots" content="noindex,nofollow"><title>' + html.escape(settings['title']) + '</title><body style="margin:0">'
    (output / 'raw-html.html').write_text(raw, encoding='utf-8')
    (output / 'index.html').write_text(head + raw + '</body></html>\n', encoding='utf-8')
    return {'output': str(output), 'rawSHA256': digest(output / 'raw-html.html'), 'draft': settings.get('draft', True), 'checkoutMode': settings['checkoutMode']}

def create(output, settings_file=None, template='premium'):
    if template == 'latest':
        if settings_file:
            raise ValueError('Edit latest raw-html after create; component settings apply to premium only')
        if output.exists():
            raise ValueError('Output already exists')
        bundle = ROOT / 'templates/ai-director-latest-20261026'
        manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
        for (name, expected) in manifest['files'].items():
            if digest(bundle / name) != expected:
                raise ValueError('Latest template checksum mismatch: ' + name)
        shutil.copytree(bundle, output)
        (output / 'template-instance.json').write_text(json.dumps({'template': 'ai-director-latest', 'mode': 'raw-preview', 'source': manifest['source']}), encoding='utf-8')
        return build(output)
    manifest = check_bundle()
    if output.exists():
        raise ValueError('Output already exists; edit its components and use build')
    settings = json.loads((settings_file or BUNDLE / 'example.json').read_text(encoding='utf-8'))
    validate(settings, manifest['components'])
    output.mkdir(parents=True)
    for name in ['components', 'assets']:
        shutil.copytree(BUNDLE / name, output / name)
    for name in ['styles.css', 'runtime.js']:
        shutil.copyfile(BUNDLE / name, output / name)
    (output / 'settings.json').write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'template-instance.json').write_text(json.dumps({'template': manifest['id'], 'version': manifest['version'], 'components': manifest['components'], 'sourceSHA256': manifest['source']['rawSHA256']}, indent=2) + '\n', encoding='utf-8')
    return build(output)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('check-template')
    for command in ['create', 'build']:
        p = sub.add_parser(command)
        p.add_argument('--output', type=Path, required=True)
        if command == 'create':
            p.add_argument('--settings', type=Path)
            p.add_argument('--template', choices=['premium', 'latest'], default='premium')
        else:
            p.add_argument('--for-publication', action='store_true')
    args = parser.parse_args()
    if args.command == 'check-template':
        result = {'ok': True, 'template': check_bundle()['id']}
    elif args.command == 'create':
        result = create(args.output.resolve(), args.settings, args.template)
    else:
        result = build(args.output.resolve(), args.for_publication)
    print(json.dumps(result, ensure_ascii=False))
if __name__ == '__main__':
    main()
