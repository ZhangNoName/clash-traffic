#!/usr/bin/env python3
"""Install, start, stop and remove the user-level macOS service.

Uninstall deliberately preserves historical data. No Clash files are changed.
"""
import argparse
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
BASE = Path.home() / "Library/Application Support/ClashTraffic"
LABEL = "local.clash-traffic.collector"
PLIST = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
TARGET = f"gui/{os.getuid()}/{LABEL}"
APP = Path.home() / "Applications/Clash 流量簿.app"
URL = "http://127.0.0.1:19797"


def run(args, check=True):
    return subprocess.run([str(a) for a in args], check=check)


def stop():
    previous = subprocess.run(["/bin/launchctl", "print", TARGET], capture_output=True, text=True)
    match = re.search(r"\n\s*pid = (\d+)", previous.stdout)
    subprocess.run(["/bin/launchctl", "bootout", TARGET], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if match:
        for _ in range(50):
            try:
                os.kill(int(match.group(1)), 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)


def start():
    if not PLIST.exists():
        raise SystemExit("尚未安装，请先运行 manage.py install。")
    result = subprocess.run(["/bin/launchctl", "print", TARGET], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode:
        run(["/bin/launchctl", "bootstrap", f"gui/{os.getuid()}", PLIST])
    run(["/bin/launchctl", "kickstart", TARGET])
    for _ in range(30):
        try:
            with urllib.request.urlopen(URL + "/api/status", timeout=1) as response:
                if response.status == 200:
                    print("记录服务已启动：" + URL)
                    return
        except Exception:
            time.sleep(0.3)
    raise SystemExit("服务尚未响应。请检查 ClashTraffic/service.log 和 macOS 后台项目权限。")


def make_app():
    macos = APP / "Contents/MacOS"
    resources = APP / "Contents/Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    launcher = macos / "launcher"
    # Paths are not interpolated into shell code. HOME only locates the existing
    # managed service; the UI is a fixed loopback URL.
    launcher.write_text('''#!/bin/sh
/bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$HOME/Library/LaunchAgents/local.clash-traffic.collector.plist" >/dev/null 2>&1
/bin/launchctl kickstart "gui/$(/usr/bin/id -u)/local.clash-traffic.collector" >/dev/null 2>&1
/usr/bin/open "http://127.0.0.1:19797"
''')
    launcher.chmod(0o755)
    info = {"CFBundleIdentifier": "local.clash-traffic.launcher", "CFBundleName": "Clash 流量簿",
            "CFBundleDisplayName": "Clash 流量簿", "CFBundleExecutable": "launcher",
            "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
            "CFBundlePackageType": "APPL", "LSUIElement": True,
            "NSHighResolutionCapable": True}
    icon = SOURCE / "assets/AppIcon.icns"
    if icon.exists():
        shutil.copy2(icon, resources / "AppIcon.icns")
        info["CFBundleIconFile"] = "AppIcon"
    with (APP / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(info, stream)


def install():
    if sys.platform != "darwin":
        raise SystemExit("此安装器仅适用于 macOS。")
    native = SOURCE.parent / "Clash 流量簿.app"
    if native.exists():
        stop()
        if APP.exists():
            with (APP / "Contents/Info.plist").open("rb") as stream:
                bundle_id = plistlib.load(stream).get("CFBundleIdentifier")
            if bundle_id not in ("local.clash-traffic.launcher", "local.clash-traffic.app"):
                raise SystemExit("目标位置存在其他应用，请自行选择安装位置。")
            shutil.rmtree(APP)
        shutil.copytree(native, APP, symlinks=True)
        run(["/usr/bin/open", APP])
        print("已安装独立桌面版：" + str(APP))
        return
    os.umask(0o077)
    BASE.mkdir(parents=True, exist_ok=True)
    target = BASE / "app"
    venv = BASE / "venv"
    if not (venv / "bin/python3").exists():
        run([sys.executable, "-m", "venv", venv])
    pip = [venv / "bin/python3", "-m", "pip", "install", "--disable-pip-version-check"]
    wheels = SOURCE / "wheels"
    if wheels.exists():
        pip += ["--no-index", "--find-links", wheels]
    run(pip + ["-r", SOURCE / "requirements.txt"])
    # Install dependencies before stopping a running previous version.
    stop()
    target.mkdir(exist_ok=True)
    shutil.copytree(SOURCE / "clash_traffic", target / "clash_traffic", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("manage.py", "requirements.txt"):
        shutil.copy2(SOURCE / name, target / name)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    config = {"Label": LABEL,
              "ProgramArguments": [str(venv / "bin/python3"), "-m", "clash_traffic.server", "--data-dir", str(BASE)],
              "WorkingDirectory": str(target), "RunAtLoad": True, "KeepAlive": True,
              "ThrottleInterval": 15, "ProcessType": "Background",
              "EnvironmentVariables": {"PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"},
              "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null"}
    with PLIST.open("wb") as stream:
        plistlib.dump(config, stream)
    make_app()
    start()
    print("已安装登录自启，以及应用入口：" + str(APP))


def main():
    parser = argparse.ArgumentParser(description="Clash 流量簿服务管理")
    parser.add_argument("command", choices=["install", "start", "stop", "restart", "status", "uninstall", "open"])
    command = parser.parse_args().command
    if command == "install":
        install()
    elif command == "start":
        start()
    elif command == "stop":
        stop();print("记录服务已停止；运行 start 或下次登录可恢复。")
    elif command == "restart":
        stop();start()
    elif command == "status":
        run(["/bin/launchctl", "print", TARGET], check=False)
    elif command == "open":
        if APP.exists():
            run(["/usr/bin/open", APP])
        elif Path("/Applications/Clash 流量簿.app").exists():
            run(["/usr/bin/open", "/Applications/Clash 流量簿.app"])
        else:
            start();run(["/usr/bin/open", URL])
    elif command == "uninstall":
        stop()
        PLIST.unlink(missing_ok=True)
        if APP.exists():shutil.rmtree(APP)
        for path in (BASE / "app", BASE / "venv"):
            if path.exists():shutil.rmtree(path)
        print("后台服务、启动项和入口已卸载；历史与配置保留在 " + str(BASE))


if __name__ == "__main__":main()
