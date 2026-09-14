import csv, io, tempfile, unittest
from datetime import datetime
from pathlib import Path
from clash_traffic.storage import Store, TZ

class ViewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=Store(Path(self.temp.name)/'test.db')
        self.minute=int(datetime(2024,2,29,23,59,tzinfo=TZ).timestamp())
        self.p={'from':'2024-02-01T00:00','to':'2024-03-01T00:00'}
        rows=[]
        for aid,app,node,chain in [('a','Chrome','n','Google'),('a','Chrome','n','Final'),('a','Chrome','n2','Final'),('b','ChatGPT','n','OpenAI'),('c','codex','n','OpenAI'),('d','ChatGPT Computer Use','n','OpenAI'),('e','chrome-headless-shell','n','OpenAI')]:
            rows.append(dict(minute=self.minute,node_key=node,node='same node',subscription_id='s',subscription='sub',app_id=aid,app=app,chain=chain,attribution='match',upload=100,download=200))
        self.store.record(rows,(self.minute,self.minute+60),None,{'started_at':self.minute},{'s':'sub'})
    def tearDown(self):self.temp.cleanup()
    def test_modes_conserve_and_distinguish_nodes(self):
        for mode,count in [('combined',4),('separate',6)]:
            p={**self.p,'app_mode':mode}
            rows=self.store.details(p)['rows']
            self.assertEqual(len(rows),count)
            self.assertEqual(sum(r['upload']+r['download'] for r in rows),2100)
            self.assertEqual(self.store.details({**p,'detail_mode':'sources'})['count'],7)
        chrome=[r for r in self.store.details(self.p)['rows'] if r['app']=='Chrome']
        self.assertEqual(sorted(r['source_count'] for r in chrome),[1,2])
    def test_family_filter_and_sources(self):
        p={**self.p,'app':'family:openai'}
        row=self.store.details(p)['rows'][0]
        self.assertEqual(row['identity_count'],3)
        self.assertEqual(self.store.summary(p)['total']['upload'],300)
        raw=self.store.details({**p,'detail_mode':'sources'})['rows']
        self.assertEqual({r['app'] for r in raw},{'ChatGPT','codex','ChatGPT Computer Use'})
        self.assertEqual(sum(r['download'] for r in raw),row['download'])
    def test_calendar_leap_year_and_exclusive_end(self):
        result=self.store.summary(self.p)
        self.assertEqual(len(result['daily']),29)
        self.assertEqual(result['daily'][-1]['coverage'],60)
        self.assertEqual(sum(r['download'] for r in result['daily']),result['total']['download'])
        self.assertEqual(len(self.store.summary({'from':'2024-01-01T00:00','to':'2025-01-01T00:00'})['daily']),366)
        partial=self.store.summary({'from':'2024-02-29T23:58','to':'2024-02-29T23:59'})
        self.assertEqual(partial['total']['upload'],0)
        self.assertEqual(partial['daily'][0]['duration'],60)
    def test_preferences_persist_and_validate(self):
        self.store.save_preferences({'chart_type':'line'})
        self.assertEqual(Store(self.store.path).preferences()['chart_type'],'line')
        for data in [{'chart_type':'pie'},{'app_mode':'all'},[],{'extra':True}]:
            with self.assertRaises(ValueError):self.store.save_preferences(data)
    def test_export_modes_conserve(self):
        for mode in ['summary','sources']:
            rows=list(csv.reader(io.StringIO(self.store.export({**self.p,'detail_mode':mode}).decode('utf-8-sig'))))[1:]
            self.assertEqual(sum(int(r[7]) for r in rows),2100)
            self.assertTrue(all(r[9] for r in rows))
