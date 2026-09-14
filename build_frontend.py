#!/usr/bin/env python3
"""Build Next static export, then stage assets for the existing Python service."""
import argparse
import shutil
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true', help='Install locked Node dependencies first')
    args = parser.parse_args()
    frontend = ROOT / 'frontend'
    if args.install:
        subprocess.run(['npm', 'ci'], cwd=frontend, check=True)
    subprocess.run(['npm', 'run', 'build'], cwd=frontend, check=True)
    target = ROOT / 'clash_traffic/static/ui'
    staged = target.with_name('ui-staging')
    if staged.exists(): shutil.rmtree(staged)
    shutil.copytree(frontend / 'out', staged)
    shutil.copytree(ROOT / 'docs', staged / 'manual')
    if target.exists(): shutil.rmtree(target)
    staged.rename(target)
    print('Staged Next.js export:', target)
if __name__ == '__main__': main()
