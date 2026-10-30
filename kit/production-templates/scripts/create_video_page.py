"""Fill a frozen TrainUp video template without changing its design or player."""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import urlsplit
from uuid import UUID
ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = {'trainup-video-single': 'single'}
DEFAULT_VERSION = '1.0.0'
TEMPLATE_VERSIONS = {'1.0.0', '1.1.0', '1.1.1'}
PROTECTED = {'template.css', 'landing.css', 'player.js', 'gallery.js', 'notice.js'}
RUNTIME = PROTECTED | {'index.html', 'scripts/serve.py'}
VIDEO_URL = re.compile('https://kinescope\\.io/embed/(?:pl/)?[A-Za-z0-9-]+\\Z')
SLUG = re.compile('[a-z0-9]+(?:-[a-z0-9]+)*\\Z')
SHA = re.compile('[0-9a-f]{64}\\Z')
MAX_IMAGE = 5 * 1024 * 1024

def require(condition, message):
    if not condition:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read_json(path):

    def unique(pairs):
        result = {}
        for (key, value) in pairs:
            require(key not in result, f'Duplicate JSON field: {key}')
            result[key] = value
        return result
    require(path.is_file() and (not path.is_symlink()), f'Missing regular JSON file: {path}')
    require(path.stat().st_size <= 1024 * 1024, 'JSON file exceeds 1 MB')
    value = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
    require(isinstance(value, dict), 'JSON must contain an object')
    return value

def relative_path(value):
    require(isinstance(value, str) and value and ('\\' not in value) and ('\x00' not in value), 'Invalid local relative path')
    path = PurePosixPath(value)
    require(not path.is_absolute() and all((part not in ('.', '..') for part in path.parts)) and (path.as_posix() == value), f'Unsafe relative path: {value}')
    return path

def local_file(base, value):
    relative = relative_path(value)
    current = base
    for part in relative.parts:
        current = current / part
        require(not current.is_symlink(), f'Symlinks are not allowed: {value}')
    require(current.is_file() and current.resolve().is_relative_to(base.resolve()), f'Missing regular local file: {value}')
    return current

def runtime_path(value):
    path = relative_path(value)
    require(value in RUNTIME or (len(path.parts) > 1 and path.parts[0] == 'assets'), f'Non-runtime template file: {value}')
    return value

def inventory(base, excluded=()):
    require(base.is_dir() and (not base.is_symlink()), f'Missing regular directory: {base}')
    result = set()
    for path in base.rglob('*'):
        require(not path.is_symlink(), f'Symlinks are not allowed: {path}')
        require(path.is_dir() or path.is_file(), f'Non-regular entry: {path}')
        if path.is_file():
            name = path.relative_to(base).as_posix()
            if name not in excluded:
                result.add(name)
    return result

def text(value, field, limit=300):
    require(isinstance(value, str) and value.strip() and (len(value) <= limit), f'Invalid {field}; expected 1..{limit} characters')
    require(not any((ord(char) < 32 or ord(char) == 127 for char in value)) and '<' not in value and ('>' not in value), f'Invalid plain text in {field}')
    return re.sub('"([^\\"]*)"', '«\\1»', value)

def valid_video_url(value, mode):
    require(isinstance(value, str) and VIDEO_URL.fullmatch(value), 'videoUrl must be a HTTPS Kinescope embed URL without query/fragment')
    require(mode != 'single' or '/embed/pl/' not in value, 'Single video cannot use a playlist URL')
    require(mode != 'course' or '/embed/pl/' in value, 'Course must use a playlist URL')
    return value

def registration_url(value):
    require(isinstance(value, str) and value and (not any((char.isspace() or ord(char) < 32 for char in value))) and (not any((char in value for char in '<>"\\'))), 'Invalid registrationUrl')
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and parsed.hostname and (parsed.username is None) and (parsed.password is None), 'registrationUrl must be HTTPS without credentials')
    parsed.port
    return value

def image_bytes(base, value):
    path = local_file(base, value)
    suffix = path.suffix.lower()
    require(suffix in ('.webp', '.jpg', '.jpeg', '.png'), 'Poster must be .webp, .jpg, .jpeg or .png')
    require(0 < path.stat().st_size <= MAX_IMAGE, 'Poster exceeds 5 MB or is empty')
    data = path.read_bytes()
    valid = suffix == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n') or (suffix in ('.jpg', '.jpeg') and data.startswith(b'\xff\xd8\xff')) or (suffix == '.webp' and data[:4] == b'RIFF' and (data[8:12] == b'WEBP'))
    require(valid, f'Poster is not an image matching its suffix: {value}')
    return (suffix, data)

def settings_from(path):
    settings = read_json(path)
    required = {'template', 'slug', 'title', 'videoUrl', 'poster', 'ctaLabel', 'registrationUrl'}
    allowed = required | {'registrationOpen', 'registrationDay', 'videos'}
    require(required <= settings.keys(), f'Missing settings: {sorted(required - settings.keys())}')
    require(not settings.keys() - allowed, f'Unknown settings: {sorted(settings.keys() - allowed)}')
    require(isinstance(settings['template'], str) and settings['template'] in TEMPLATES, 'Unknown template')
    mode = TEMPLATES[settings['template']]
    require(isinstance(settings['slug'], str) and len(settings['slug']) <= 100 and SLUG.fullmatch(settings['slug']), 'Invalid slug')
    for (field, limit) in (('title', 300), ('ctaLabel', 120)):
        settings[field] = text(settings[field], field, limit)
    settings['registrationDay'] = text(settings.get('registrationDay', 'в пятницу'), 'registrationDay', 80)
    settings.setdefault('registrationOpen', False)
    require(type(settings['registrationOpen']) is bool, 'registrationOpen must be a boolean')
    valid_video_url(settings['videoUrl'], mode)
    registration_url(settings['registrationUrl'])
    (suffix, poster) = image_bytes(path.parent, settings['poster'])
    images = {f'assets/video/course-poster{suffix}': poster}
    settings['poster'] = f'./assets/video/course-poster{suffix}'
    videos = settings.get('videos', [])
    require(isinstance(videos, list), 'videos must be an array')
    require(1 <= len(videos) <= 6 if mode == 'course' else not videos, 'Course needs 1..6 videos; single requires absent or empty videos')
    ids = set()
    for (number, lesson) in enumerate(videos, 1):
        require(isinstance(lesson, dict) and set(lesson) == {'id', 'title', 'poster', 'durationSeconds'}, 'Each video needs only id, title, poster and durationSeconds')
        require(isinstance(lesson['id'], str) and re.fullmatch('[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', lesson['id']), 'Invalid video UUID')
        lesson['id'] = str(UUID(lesson['id']))
        require(lesson['id'] not in ids, 'Duplicate video UUID')
        ids.add(lesson['id'])
        lesson['title'] = text(lesson['title'], 'video title')
        require(type(lesson['durationSeconds']) is int and lesson['durationSeconds'] > 0, 'durationSeconds must be a positive integer')
        (suffix, data) = image_bytes(path.parent, lesson['poster'])
        name = f'assets/video/lesson-{number:02d}{suffix}'
        images[name] = data
        lesson['poster'] = './' + name
    settings['videos'] = videos
    return (settings, images)

def frozen_template(template_root, template_id, version=DEFAULT_VERSION):
    require(template_id in TEMPLATES, 'Unknown template')
    require(isinstance(version, str) and version in TEMPLATE_VERSIONS, 'Unknown template version')
    directory = template_root / (template_id if version == '1.0.0' else f'{template_id}-v{version}')
    require(not template_root.is_symlink() and (not directory.is_symlink()), 'Template directories cannot be symlinks')
    manifest = read_json(directory / 'manifest.json')
    require(set(manifest) == {'id', 'name', 'version', 'mode', 'sourceCommit', 'files', 'protectedFiles'}, 'Invalid template manifest fields')
    require(manifest['id'] == template_id and manifest['mode'] == TEMPLATES[template_id], 'Template id/mode mismatch')
    require(manifest['version'] == version, 'Template manifest version mismatch')
    for field in ('name', 'version', 'sourceCommit'):
        require(isinstance(manifest[field], str) and manifest[field].strip(), f'Invalid manifest {field}')
    require(isinstance(manifest['protectedFiles'], list) and len(manifest['protectedFiles']) == len(PROTECTED) and all((isinstance(name, str) for name in manifest['protectedFiles'])) and (set(manifest['protectedFiles']) == PROTECTED), 'Invalid protectedFiles')
    require(isinstance(manifest['files'], dict) and RUNTIME <= manifest['files'].keys(), 'Missing runtime files/hashes')
    files = {}
    for (name, digest) in manifest['files'].items():
        runtime_path(name)
        require(isinstance(digest, str) and SHA.fullmatch(digest), f'Invalid SHA256 for {name}')
        data = local_file(directory, name).read_bytes()
        require(sha(data) == digest, f'Template SHA256 mismatch: {name}')
        files[name] = data
    require(inventory(directory, {'manifest.json', 'README.md'}) == set(files), 'Unlisted template files or missing manifest files')
    return (manifest, files)

def replace_once(page, pattern, replacement):
    (page, count) = re.subn(pattern, replacement, page, flags=re.DOTALL)
    require(count == 1, f'Template slot must occur once: {pattern}')
    return page

def attribute(tag, name, value):
    return replace_once(tag, f'\\b{re.escape(name)}="[^"]*"', lambda _: f'{name}="{html.escape(value, quote=True)}"')

def fill_page(page, settings, mode):
    escaped = lambda value: html.escape(value, quote=True)
    page = replace_once(page, '<title>.*?</title>', lambda _: f"<title>{escaped(settings['title'])} — TrainUp</title>")
    page = replace_once(page, 'data-article-id="[^"]*"', lambda _: f'''data-article-id="{settings['slug']}"''')
    page = replace_once(page, '(<h1\\b[^>]*data-section-id="title"[^>]*>).*?(</h1>)', lambda match: match[1] + escaped(settings['title']) + match[2])

    def shell(match):
        tag = attribute(match[0], 'data-video-url', settings['videoUrl'])
        return attribute(tag, 'aria-label', ('Видеосерия: ' if mode == 'course' else 'Видео: ') + settings['title'])
    page = replace_once(page, '<div\\b[^>]*\\bid="leadmagnet"[^>]*>', shell)
    page = replace_once(page, '<img\\b[^>]*\\bclass="leadmagnet-poster"[^>]*>', lambda match: attribute(match[0], 'src', settings['poster']))
    page = replace_once(page, '(<div\\b[^>]*\\bdata-player-fallback[^>]*>.*?<a\\b[^>]*\\bhref=")[^"]*(")', lambda match: match[1] + escaped(settings['videoUrl']) + match[2])
    page = replace_once(page, '<!-- When registration opens,.*?-->', lambda _: '<!-- When registration opens, replace this button with an anchor using the same classes and href="' + escaped(settings['registrationUrl']) + '". -->')
    if settings['registrationOpen']:
        cta = '<a class="tariff-button article-cta" href="' + escaped(settings['registrationUrl']) + '">' + escaped(settings['ctaLabel']) + '</a>'
        page = replace_once(page, '<button\\b[^>]*\\bclass="tariff-button article-cta"[^>]*>.*?</button>', lambda _: cta)
    else:
        page = replace_once(page, '(<button\\b[^>]*\\bclass="tariff-button article-cta"[^>]*>).*?(</button>)', lambda match: match[1] + escaped(settings['ctaLabel']) + match[2])
    page = replace_once(page, '(<p\\b[^>]*\\bid="registration-notice-text"[^>]*>.*?<strong>).*?(</strong>)', lambda match: match[1] + escaped(settings['registrationDay']) + match[2])
    if mode == 'course':
        lessons = []
        for (number, video) in enumerate(settings['videos'], 1):
            seconds = video['durationSeconds']
            (minutes, remainder) = divmod(seconds, 60)
            lessons.append('                <li><button class="course-video" type="button" data-course-video="' + video['id'] + '" aria-controls="leadmagnet" aria-pressed="false" disabled data-course-poster="' + escaped(video['poster']) + '"><span class="course-video-number" aria-hidden="true">' + f'{number:02d}' + '</span><span class="course-video-title">' + escaped(video['title']) + '</span><time class="course-video-duration" datetime="PT' + str(seconds) + 'S" aria-label="Продолжительность: ' + str(minutes) + ' мин ' + str(remainder) + ' сек">' + f'{minutes}:{remainder:02d}' + '</time></button></li>')
        page = replace_once(page, '(<ol\\b[^>]*\\bdata-course-outline[^>]*>).*?(</ol>)', lambda match: match[1] + '\n' + '\n'.join(lessons) + '\n              ' + match[2])
    return page

class PageContract(HTMLParser):

    def __init__(self, page):
        super().__init__(convert_charrefs=True)
        (self.scripts, self.styles, self.assets, self.videos, self.shells, self.posters) = ([], [], [], [], [], [])
        self.outlines = self.sections = self.shortcuts = 0
        self.in_script = False
        self.feed(page)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        require('style' not in attrs and (not any((name.startswith('on') for name in attrs))), 'Inline style/script attributes are forbidden')
        require(tag != 'style', 'Inline style blocks are forbidden')
        classes = (attrs.get('class') or '').split()
        if tag == 'script':
            require(attrs.get('src'), 'Inline scripts are forbidden')
            self.scripts.append(attrs['src'])
            self.in_script = True
        if tag == 'link' and 'stylesheet' in (attrs.get('rel') or '').split():
            self.styles.append(attrs.get('href'))
        if tag == 'img':
            self.assets.append(attrs.get('src'))
        if attrs.get('id') == 'leadmagnet':
            self.shells.append(attrs)
        if 'leadmagnet-poster' in classes:
            self.posters.append(attrs.get('src'))
        if 'data-course-outline' in attrs:
            self.outlines += 1
        if 'course-outline' in classes:
            self.sections += 1
        if 'data-course-shortcuts' in attrs:
            self.shortcuts += 1
        if 'data-course-video' in attrs:
            self.videos.append(attrs)
            self.assets.append(attrs.get('data-course-poster'))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False

    def handle_data(self, data):
        require(not self.in_script or not data.strip(), 'Inline script contents are forbidden')

def check_page(page, record, files, original):
    (parsed, baseline) = (PageContract(page), PageContract(original))
    require(parsed.scripts == baseline.scripts and parsed.styles == baseline.styles, 'CSS/script references differ from frozen template')
    for url in parsed.scripts + parsed.styles + parsed.assets:
        require(isinstance(url, str) and url.startswith('./'), 'Runtime references must be local')
        name = urlsplit(url).path[2:]
        runtime_path(name)
        require(name in files, f'Referenced asset is missing: {name}')
    require(len(parsed.shells) == len(parsed.posters) == 1, 'Expected one video shell and one main poster')
    require(parsed.shells[0].get('data-video-url') == record['videoUrl'], 'Video URL mismatch')
    expected_label = ('Видеосерия: ' if record['mode'] == 'course' else 'Видео: ') + record['title']
    require(parsed.shells[0].get('aria-label') == expected_label, 'Video shell label mismatch')
    require(re.fullmatch('\\./assets/video/course-poster\\.(?:webp|jpe?g|png)', parsed.posters[0] or ''), 'Incorrect main poster asset')
    titles = re.findall('<title>(.*?)</title>', page, re.DOTALL)
    headings = re.findall('<h1\\b[^>]*data-section-id="title"[^>]*>(.*?)</h1>', page, re.DOTALL)
    require([html.unescape(value) for value in titles] == [record['title'] + ' — TrainUp'] and [html.unescape(value) for value in headings] == [record['title']], 'Page title/H1 mismatch')
    require(re.findall('data-article-id="([^"]*)"', page) == [record['slug']], 'Article slug mismatch')
    count = record['videoCount']
    require(type(count) is int and (1 <= count <= 6 if record['mode'] == 'course' else count == 0), 'Invalid instance videoCount')
    expected = 1 if count else 0
    require(parsed.outlines == parsed.sections == parsed.shortcuts == expected and len(parsed.videos) == count, 'Course outline/video count does not match selected mode')
    for (number, video) in enumerate(parsed.videos, 1):
        require(re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', video.get('data-course-video', '')), 'Invalid course UUID')
        require(video.get('aria-controls') == 'leadmagnet' and video.get('aria-pressed') == 'false' and ('disabled' in video), 'Course button contract changed')
        require(re.fullmatch(f'\\./assets/video/lesson-{number:02d}\\.(?:webp|jpe?g|png)', video.get('data-course-poster', '')), 'Incorrect lesson poster asset')

def output_path(value, slug):
    path = Path(value)
    require('..' not in path.parts, 'Output path cannot contain traversal')
    path = path.absolute()
    require(not path.is_symlink(), 'Output cannot be a symlink')
    require(path.name == slug, 'Output directory name must match the selected slug')
    require(not path.resolve().is_relative_to(ROOT.resolve()), 'Output must be outside the installed engine')
    for ancestor in path.parents:
        require(ancestor in (Path('/tmp'), Path('/var')) or not ancestor.is_symlink(), 'Output ancestors cannot be symlinks')
    return path

def generate(settings_path, output, template_root):
    (settings, images) = settings_from(settings_path)
    destination = output_path(output, settings['slug'])
    require(not destination.exists(), 'Output already exists; refusing to overwrite')
    (manifest, files) = frozen_template(template_root, settings['template'])
    original = files['index.html'].decode('utf-8')
    page = fill_page(original, settings, manifest['mode'])
    files.update(images)
    files['index.html'] = page.encode('utf-8')
    record = {'template': manifest['id'], 'version': manifest['version'], 'sourceCommit': manifest['sourceCommit'], 'mode': manifest['mode'], 'slug': settings['slug'], 'title': settings['title'], 'videoUrl': settings['videoUrl'], 'videoCount': len(settings['videos']), 'protectedFiles': {name: manifest['files'][name] for name in sorted(PROTECTED)}, 'files': {name: sha(data) for (name, data) in sorted(files.items())}}
    check_page(page, record, files, original)
    destination.mkdir(parents=True, exist_ok=False)
    for (name, data) in sorted(files.items()):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (destination / 'template-instance.json').write_text(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    return destination

def check(directory, template_root):
    record = read_json(directory / 'template-instance.json')
    required = {'template', 'version', 'sourceCommit', 'mode', 'slug', 'title', 'videoUrl', 'videoCount', 'protectedFiles', 'files'}
    require(set(record) == required, 'Invalid template-instance fields')
    require(isinstance(record['template'], str) and record['template'] in TEMPLATES, 'Invalid instance template')
    require(isinstance(record['slug'], str) and SLUG.fullmatch(record['slug']), 'Invalid instance slug')
    output_path(directory, record['slug'])
    (manifest, template_files) = frozen_template(template_root, record['template'], record['version'])
    require(all((record[key] == manifest[key] for key in ('version', 'sourceCommit', 'mode'))), 'Template instance metadata differs from frozen manifest')
    require(record['protectedFiles'] == {name: manifest['files'][name] for name in PROTECTED}, 'Protected SHA256 baseline differs from frozen manifest')
    text(record['title'], 'instance title')
    valid_video_url(record['videoUrl'], record['mode'])
    require(isinstance(record['files'], dict) and set(template_files) <= record['files'].keys(), 'Missing generated file hashes')
    require(inventory(directory, {'template-instance.json'}) == set(record['files']), 'Missing or unexpected generated files')
    files = {}
    for (name, digest) in record['files'].items():
        runtime_path(name)
        require(isinstance(digest, str) and SHA.fullmatch(digest), f'Invalid generated SHA256: {name}')
        data = local_file(directory, name).read_bytes()
        require(sha(data) == digest, f'Generated SHA256 mismatch: {name}')
        if name in PROTECTED:
            require(digest == manifest['files'][name], f'Protected SHA256 changed: {name}')
        files[name] = data
    check_page(files['index.html'].decode('utf-8'), record, files, template_files['index.html'].decode('utf-8'))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--settings', type=Path)
    action.add_argument('--check', type=Path, metavar='DIRECTORY')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--template-root', type=Path, default=ROOT / 'templates')
    args = parser.parse_args()
    if args.settings and (not args.output):
        parser.error('--settings requires --output')
    if args.check and args.output:
        parser.error('--output is only valid with --settings')
    try:
        if args.check:
            check(args.check, args.template_root)
            print(f'Checked: {args.check}')
        else:
            print(f'Created: {generate(args.settings, args.output, args.template_root)}')
    except (OSError, ValueError, TypeError, UnicodeError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    return 0
if __name__ == '__main__':
    sys.exit(main())
