#!/usr/bin/env python3
"""Run using Python with PyInstaller 6.22.2 and PyYAML 6.0.3 installed."""
import argparse
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from clash_traffic import __version__

ROOT=Path(__file__).resolve().parent

def run(args):subprocess.run([str(x) for x in args],check=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--skip-frontend',action='store_true',help='Reuse an already verified frontend build')
    args=p.parse_args();work=args.work_dir.resolve();output=args.output.resolve()
    work.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True)
    if not args.skip_frontend:
        run([sys.executable,ROOT/'build_docs.py'])
        run([sys.executable,ROOT/'build_frontend.py'])
    if not (ROOT/'clash_traffic/static/ui/index.html').exists():
        raise SystemExit('Build frontend first.')
    run([sys.executable,'-m','PyInstaller','--noconfirm','--onedir','--name','clash-traffic-service',
         '--target-arch','arm64','--distpath',work/'dist','--workpath',work/'build','--specpath',work,
         '--paths',ROOT,'--add-data',str(ROOT/'clash_traffic/static')+':clash_traffic/static',ROOT/'run_backend.py'])
    app=output/'Clash 流量簿.app';contents=app/'Contents';macos=contents/'MacOS';resources=contents/'Resources'
    macos.mkdir(parents=True,exist_ok=True);resources.mkdir(parents=True,exist_ok=True)
    run(['clang','-fobjc-arc','-fmodules','-O2','-mmacosx-version-min=12.0','-framework','Cocoa','-framework','WebKit',ROOT/'native/main.m','-o',macos/'ClashTraffic'])
    service=resources/'service'
    if service.exists():shutil.rmtree(service)
    shutil.copytree(work/'dist/clash-traffic-service',service,symlinks=True)
    shutil.copy2(ROOT/'assets/AppIcon.icns',resources/'AppIcon.icns')
    shutil.copytree(ROOT/'docs',resources/'docs',dirs_exist_ok=True)
    shutil.copy2(ROOT/'THIRD_PARTY_NOTICES.md',resources/'THIRD_PARTY_NOTICES.md')
    shutil.copy2(ROOT/'FRONTEND_LICENSES.txt',resources/'FRONTEND_LICENSES.txt')
    build_number=os.environ.get('CLASH_TRAFFIC_BUILD_NUMBER','6')
    if not build_number.isdigit() or int(build_number) < 1:
        raise SystemExit('CLASH_TRAFFIC_BUILD_NUMBER must be a positive integer.')
    info={'CFBundleIdentifier':'local.clash-traffic.app','CFBundleName':'Clash 流量簿',
          'CFBundleDisplayName':'Clash 流量簿','CFBundleExecutable':'ClashTraffic',
          'CFBundleVersion':build_number,'CFBundleShortVersionString':__version__,'CFBundlePackageType':'APPL',
          'CFBundleIconFile':'AppIcon','LSMinimumSystemVersion':'13.3','NSHighResolutionCapable':True,
          'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},
          'NSHumanReadableCopyright':'Local personal traffic journal. Python and PyYAML retain their respective licenses.'}
    with (contents/'Info.plist').open('wb') as f:plistlib.dump(info,f)
    run(['codesign','--force','--deep','--sign','-',app])
    run(['codesign','--verify','--deep','--strict',app])
    print('Built:',app)

if __name__=='__main__':main()
