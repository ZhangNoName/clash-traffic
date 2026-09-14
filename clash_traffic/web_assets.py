"""Serve only built frontend files; allow Next bootstrap scripts by content hash."""
import base64
import hashlib
import mimetypes
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

class ScriptHashes(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.inline = False
        self.parts = []
        self.hashes = set()
    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.inline = not any(key == 'src' for key, _ in attrs)
            self.parts = []
    def handle_data(self, value):
        if self.inline:
            self.parts.append(value)
    def handle_endtag(self, tag):
        if tag == 'script' and self.inline:
            digest = hashlib.sha256(''.join(self.parts).encode()).digest()
            self.hashes.add("'sha256-" + base64.b64encode(digest).decode() + "'")
            self.inline = False

class WebAssets:
    def __init__(self, root):
        self.files = {}
        hashes = set()
        root = Path(root)
        for path in sorted(root.rglob('*')):
            if not path.is_file() or path.is_symlink() or path.suffix not in ('.html','.js','.css','.txt','.json','.svg','.png','.ico','.woff','.woff2'):
                continue
            name = '/' + path.relative_to(root).as_posix()
            mime = {'.js':'text/javascript','.txt':'text/plain'}.get(path.suffix) or mimetypes.guess_type(name)[0] or 'application/octet-stream'
            self.files[name] = (path, mime)
            if path.name == 'index.html':
                route = name[:-10]
                self.files[route] = (path, mime)
                if route != '/':
                    self.files[route.rstrip('/')] = (path, mime)
            if path.suffix == '.html':
                parser = ScriptHashes()
                parser.feed(path.read_text())
                hashes.update(parser.hashes)
        self.script_sources = "'self'" + (' ' + ' '.join(sorted(hashes)) if hashes else '')
    def get(self, url_path):
        return self.files.get(unquote(url_path))
