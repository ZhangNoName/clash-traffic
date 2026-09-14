import json
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from clash_traffic.server import Server, handler
from clash_traffic.storage import Store


class FakeCollector:
    status={'connected':True,'last_sample':time.time(),'started_at':time.time(),'totals':{}}
    def is_alive(self):return True


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'db.sqlite3')
        self.server=Server(('127.0.0.1',0),BaseHTTPRequestHandler)
        self.port=self.server.server_address[1]
        self.server.RequestHandlerClass=handler(self.store,FakeCollector(),'test-csrf',self.port)
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':0.02},daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.thread.join();self.server.server_close();self.temp.cleanup()
    def call(self,path,method='GET',body=None,headers=None):
        client=HTTPConnection('127.0.0.1',self.port,timeout=2)
        try:
            client.request(method,path,json.dumps(body) if body is not None else None,headers or {})
            response=client.getresponse();return response.status,dict(response.getheaders()),response.read()
        finally:client.close()
    def auth(self):return {'Origin':f'http://127.0.0.1:{self.port}','X-CSRF-Token':'test-csrf','Content-Type':'application/json'}
    def test_status_and_security_headers(self):
        code,headers,data=self.call('/api/status');self.assertEqual(code,200)
        self.assertEqual(json.loads(data)['csrf'],'test-csrf')
        self.assertEqual(headers['Cache-Control'],'no-store');self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])
        self.assertNotIn('Access-Control-Allow-Origin',headers)
    def test_host_rebinding_rejected(self):
        self.assertEqual(self.call('/api/summary',headers={'Host':'attacker.example'})[0],403)
    def test_cross_origin_and_missing_token_rejected(self):
        body={'retention_days':0,'max_mb':8}
        self.assertEqual(self.call('/api/settings','POST',body)[0],403)
        headers=self.auth();headers['Origin']='https://attacker.example'
        self.assertEqual(self.call('/api/settings','POST',body,headers)[0],403)
    def test_settings_round_trip(self):
        code,_,data=self.call('/api/settings','POST',{'retention_days':90,'max_mb':64},self.auth())
        self.assertEqual(code,200);self.assertEqual(json.loads(data)['settings'],{'retention_days':90,'max_mb':64})
    def test_preferences_security_and_round_trip(self):
        body={'chart_type':'line','app_mode':'separate','detail_mode':'sources'}
        self.assertEqual(self.call('/api/preferences','POST',body)[0],403)
        self.assertEqual(self.call('/api/preferences','POST',body,self.auth())[0],200)
        self.assertEqual(json.loads(self.call('/api/preferences')[2]),body)
        self.assertEqual(self.call('/api/preferences','POST',{'chart_type':'invalid'},self.auth())[0],400)
        self.assertEqual(json.loads(self.call('/api/preferences')[2]),body)
    def test_cleanup_needs_explicit_confirmation(self):
        self.assertEqual(self.call('/api/cleanup','POST',{'scope':'all'},self.auth())[0],400)
        self.assertEqual(self.call('/api/cleanup','POST',{'scope':'all','confirm':True},self.auth())[0],200)
    def test_range_validation_and_no_arbitrary_paths(self):
        self.assertEqual(self.call('/api/summary?from=bad')[0],400)
        self.assertEqual(self.call('/api/summary?group=invalid')[0],400)
        self.assertEqual(self.call('/../../traffic.sqlite3')[0],404)
    def test_next_export_routes_and_csp(self):
        from clash_traffic.web_assets import WebAssets
        root=Path(__file__).parents[1]/'clash_traffic/static/ui'
        if not (root/'index.html').exists():self.skipTest('Build frontend first')
        for route in ['/','/details/','/settings/','/mapping/','/about/','/manual/index.html']:
            code,headers,body=self.call(route)
            self.assertEqual(code,200)
            self.assertTrue(headers['Content-Type'].startswith('text/html'))
            self.assertIn("'sha256-",headers['Content-Security-Policy'])
            script_policy=headers['Content-Security-Policy'].split('script-src ')[1].split(';')[0]
            self.assertNotIn('unsafe-inline',script_policy)
            self.assertNotIn('unsafe-eval',script_policy)
        asset=next(name for name in WebAssets(root).files if name.startswith('/_next/') and name.endswith('.js'))
        self.assertEqual(self.call(asset)[0],200)
        self.assertEqual(self.call('/_next/%2e%2e/%2e%2e/traffic.sqlite3')[0],404)
    def test_html_assets_and_csv(self):
        for url,kind in [('/','text/html'),('/app.js','text/javascript'),('/style.css','text/css'),('/api/export.csv','text/csv'),('/vendor/flatpickr/flatpickr.min.js','text/javascript'),('/vendor/flatpickr/zh.js','text/javascript'),('/vendor/flatpickr/flatpickr.min.css','text/css')]:
            status,headers,_=self.call(url);self.assertEqual(status,200);self.assertTrue(headers['Content-Type'].startswith(kind))


if __name__=='__main__':unittest.main()
