import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import yaml
from clash_traffic.core import Attribution, DeltaEngine, split_minutes
from clash_traffic.storage import Store


class FakeResolver:
    def __init__(self): self.sid='s1'
    def resolve(self,c):
        if c.get('direct'): return None,'excluded'
        if c.get('unknown'): return None,'unclassified'
        return dict(node_key='n1',node='Node',subscription_id=self.sid,subscription=self.sid,
                    app_id='app',app='Chrome',chain='Group → Node',attribution='节点配置匹配'),'proxy'


def conn(cid='one',up=100,down=200,start=90,**kw):
    return dict(id=cid,upload=up,download=down,start=datetime.fromtimestamp(start,timezone.utc).isoformat(),**kw)


def snap(*cs): return {'connections':list(cs)}


class AccountingTests(unittest.TestCase):
    def setUp(self): self.resolver=FakeResolver();self.engine=DeltaEngine(self.resolver)
    def test_baseline_never_backfills_lifetime(self):
        rows,totals,_,_=self.engine.consume(snap(conn(up=99999)),100)
        self.assertEqual(rows,[])
        rows,totals,_,_=self.engine.consume(snap(conn(up=100009,down=205)),101)
        self.assertEqual((sum(r['upload'] for r in rows),sum(r['download'] for r in rows)),(10,5))
        self.assertEqual(totals['upload'],10)
    def test_direct_reject_and_unknown_are_not_proxy(self):
        self.engine.consume(snap(conn(direct=True),conn('two',unknown=True)),100)
        rows,totals,_,_=self.engine.consume(snap(conn(up=1000,direct=True),conn('two',up=1000,unknown=True)),101)
        self.assertEqual(rows,[]);self.assertEqual(totals['upload'],0)
        self.assertEqual((totals['excluded'],totals['unclassified']),(1,1))
    def test_new_connection_uses_start_timestamp(self):
        self.engine.consume(snap(),100)
        rows,totals,_,_=self.engine.consume(snap(conn(start=100.2),conn('old',start=80)),101)
        self.assertEqual(totals['upload'],100);self.assertEqual(len(rows),1)
    def test_duplicate_snapshot_is_not_double_counted(self):
        self.engine.consume(snap(conn()),100)
        rows,totals,_,_=self.engine.consume(snap(conn(up=120),conn(up=120)),101)
        self.assertEqual(totals['upload'],20)
        self.assertEqual(self.engine.consume(snap(conn(up=120)),102)[0],[])
    def test_gap_does_not_assign_missing_bytes_to_resume_hour(self):
        self.engine.consume(snap(conn()),100)
        rows,totals,coverage,gap=self.engine.consume(snap(conn(up=2000)),200)
        self.assertEqual(rows,[]);self.assertIsNone(coverage);self.assertEqual(gap,(100,200))
        self.assertEqual(self.engine.consume(snap(conn(up=2005)),201)[1]['upload'],5)
    def test_clock_reversal_and_counter_reset_baseline(self):
        self.engine.consume(snap(conn()),100)
        self.assertEqual(self.engine.consume(snap(conn(up=1,down=1)),101)[1]['resets'],1)
        self.assertEqual(self.engine.consume(snap(conn(up=200)),99)[0],[])
    def test_existing_connection_keeps_original_subscription(self):
        self.engine.consume(snap(conn()),100);self.resolver.sid='s2'
        rows,_,_,_=self.engine.consume(snap(conn(up=150),conn('new',start=100.5)),101)
        self.assertEqual({r['subscription_id'] for r in rows},{'s1','s2'})
    def test_split_across_midnight_conserves_bytes(self):
        rows=split_minutes(86399.5,86400.5,101,333)
        self.assertEqual([r[0] for r in rows],[86340,86400])
        self.assertEqual(sum(r[1] for r in rows),101);self.assertEqual(sum(r[2] for r in rows),333)
    def test_disappeared_connection_does_not_invent_final_bytes(self):
        self.engine.consume(snap(conn()),100)
        rows,totals,_,_=self.engine.consume(snap(),101)
        self.assertEqual(rows,[]);self.assertEqual(totals['closed'],1)


class AttributionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);(self.base/'profiles').mkdir()
        self.one=dict(name='Same name',type='ss',server='one.example',port=443,password='secret1')
        self.two=dict(self.one,server='two.example',password='secret2')
        self.write('profiles.yaml',{'current':'a','items':[{'uid':'a','name':'Alpha','type':'remote','file':'a.yaml'}, {'uid':'b','name':'Beta','type':'remote','file':'b.yaml'}]})
        self.write('profiles/a.yaml',{'proxies':[self.one]});self.write('profiles/b.yaml',{'proxies':[self.two]})
        self.write('clash-verge.yaml',{'proxies':[self.one]})
        self.resolver=Attribution(self.base,b'test-key')
        self.proxies={'proxies':{'Same name':{'type':'Shadowsocks'},'DIRECT':{'type':'Direct'},'REJECT':{'type':'Reject'},'Group':{'type':'Selector'}}}
        self.resolver.refresh(self.proxies)
    def tearDown(self):self.temp.cleanup()
    def write(self,p,data):(self.base/p).write_text(yaml.safe_dump(data))
    def test_same_name_resolves_by_identity_not_name(self):
        info,_=self.resolver.resolve({'chains':['Same name','Group'],'metadata':{'process':'app'}})
        self.assertEqual(info['subscription_id'],'a');key=info['node_key']
        self.write('clash-verge.yaml',{'proxies':[self.two]});self.resolver.refresh(self.proxies)
        info,_=self.resolver.resolve({'chains':['Same name'],'metadata':{}})
        self.assertEqual(info['subscription_id'],'b');self.assertNotEqual(info['node_key'],key)
        self.assertNotIn('secret2',json.dumps(info))
    def test_unmatched_is_explicit_unknown(self):
        self.write('clash-verge.yaml',{'proxies':[dict(self.one,password='new-secret')]});self.resolver.refresh(self.proxies)
        info,_=self.resolver.resolve({'chains':['Same name']})
        self.assertEqual(info['subscription_id'],'unknown')
    def test_builtin_and_group_only(self):
        for chain in [['DIRECT'],['REJECT','Group']]:self.assertEqual(self.resolver.resolve({'chains':chain})[1],'excluded')
        self.assertEqual(self.resolver.resolve({'chains':['Group']})[1],'unclassified')
    def test_helpers_merge_to_app(self):
        one=self.resolver.app({'process':'Example Helper','processPath':'/Applications/Example.app/Contents/Frameworks/Example Helper.app/Contents/MacOS/Example Helper'})
        two=self.resolver.app({'process':'Example','processPath':'/Applications/Example.app/Contents/MacOS/Example'})
        self.assertEqual(one,two);self.assertEqual(one[1],'Example')
    def test_unknown_process_label(self):self.assertEqual(self.resolver.app({}),('unknown','未知应用'))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'test.sqlite3')
        self.t=int(datetime.fromisoformat('2026-09-12T10:00:00+08:00').timestamp())
        self.params={'from':'2026-09-12T10:00','to':'2026-09-12T11:00','granularity':'minute'}
    def tearDown(self):self.temp.cleanup()
    def row(self,**kw):return dict(minute=self.t,node_key='n1',node='Node',subscription_id='s1',subscription='Alpha',app_id='a1',app='Chrome',chain='Node',attribution='配置匹配',upload=100,download=200,**kw)
    def record(self,row=None):self.store.record([row or self.row()],None,None,{'started_at':self.t},{'s1':'Alpha','s2':'Beta'})
    def test_upsert_filter_and_conservation(self):
        self.record();self.record();data=self.store.summary(self.params)
        self.assertEqual(data['total']['upload'],200);self.assertEqual(sum(p['download'] for p in data['series']),400)
        self.assertEqual(self.store.summary(dict(self.params,subscription='s2'))['total']['upload'],0)
    def test_arbitrary_minute_range_excludes_end(self):
        self.record();row=self.row();row['minute']+=60;self.record(row)
        data=self.store.summary(dict(self.params,to='2026-09-12T10:01'))
        self.assertEqual(data['total']['upload'],100);self.assertEqual(len(data['series']),1)
    def test_manual_override_reversible_on_history(self):
        self.record();self.store.set_override('n1','s2')
        self.assertEqual(self.store.details(self.params)['rows'][0]['subscription'],'Beta')
        self.assertEqual(self.store.summary(dict(self.params,subscription='s2'))['total']['upload'],100)
        self.store.set_override('n1',None)
        self.assertEqual(self.store.details(self.params)['rows'][0]['subscription'],'Alpha')
    def test_reopen_persists_history(self):
        self.record();reopened=Store(self.store.path)
        self.assertEqual(reopened.summary(self.params)['total']['download'],200)
    def test_time_granularity_and_range_validation(self):
        for g,n in [('minute',60),('quarter',4),('hour',1),('day',1)]:
            self.assertEqual(len(self.store.summary(dict(self.params,granularity=g))['series']),n)
        with self.assertRaises(ValueError):self.store.summary(dict(self.params,to='2026-09-13T10:00'))
        with self.assertRaises(ValueError):self.store.summary(dict(self.params,to=self.params['from']))
    def test_cleanup_range_preserves_outside_and_settings(self):
        self.record();row=self.row();row['minute']+=3600;self.record(row)
        self.store.save_settings({'retention_days':100,'max_mb':20})
        self.assertEqual(self.store.cleanup(dict(self.params,scope='range'))['deleted_rows'],1)
        self.assertEqual(self.store.storage_info()['rows'],1)
        self.assertEqual(self.store.settings()['max_mb'],20)
    def test_retention_prunes_oldest(self):
        self.record();row=self.row();row['minute']-=86400*10;self.record(row)
        self.store.save_settings({'retention_days':2,'max_mb':256})
        self.store.maintain(self.t+60)
        self.assertEqual(self.store.storage_info()['rows'],1)
    def test_max_size_prunes_and_compacts(self):
        rows=[]
        for i in range(5200):
            r=self.row();r['minute']=self.t-i*60;r['node_key']=str(i);r['chain']='x'*1800;rows.append(r)
        self.store.record(rows,None,None,{'started_at':self.t},{'s1':'Alpha'})
        self.assertGreater(self.store.disk_size(),8*1024*1024)
        self.store.save_settings({'retention_days':0,'max_mb':8});self.store.maintain(self.t)
        self.assertLessEqual(self.store.disk_size(),8*1024*1024)
        self.assertEqual(self.store.storage_info()['newest'],self.t)
    def test_csv_escapes_untrusted_names(self):
        r=self.row();r['app']='=FORMULA()';self.record(r)
        self.assertIn("'=FORMULA()",self.store.export(self.params).decode())
    def test_invalid_settings_and_unknown_mapping(self):
        for s in [{'retention_days':-1,'max_mb':8},{'retention_days':1,'max_mb':0}]:
            with self.assertRaises(ValueError):self.store.save_settings(s)
        with self.assertRaises(ValueError):self.store.set_override('unknown','s1')


if __name__=='__main__':unittest.main()
