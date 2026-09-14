import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from clash_traffic.web_assets import WebAssets

class WebAssetsTests(unittest.TestCase):
    def test_routes_mime_and_inline_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'details').mkdir();(root/'_next/static').mkdir(parents=True)
            code='self.__next_f.push([1,"中文 & test"]);'
            (root/'index.html').write_text('<script>'+code+'</script><script src="/_next/static/app.js"></script>')
            (root/'details/index.html').write_text('<h1>Details</h1>')
            (root/'_next/static/app.js').write_text('console.log(1)')
            (root/'details/index.txt').write_text('RSC')
            assets=WebAssets(root)
            self.assertEqual(assets.get('/')[0],root/'index.html')
            self.assertEqual(assets.get('/details/'),assets.get('/details'))
            self.assertEqual(assets.get('/_next/static/app.js')[1],'text/javascript')
            digest=base64.b64encode(hashlib.sha256(code.encode()).digest()).decode()
            self.assertIn("'sha256-"+digest+"'",assets.script_sources)
            self.assertNotIn('unsafe-inline',assets.script_sources)
    def test_traversal_unlisted_files_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'index.html').write_text('ok');(root/'secret.sqlite3').write_text('private')
            (root/'linked.html').symlink_to(root/'index.html')
            assets=WebAssets(root)
            for path in ['/../index.html','/%2e%2e/index.html','/secret.sqlite3','/linked.html','/_next/missing.js']:
                self.assertIsNone(assets.get(path))
