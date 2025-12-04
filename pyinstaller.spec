# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

# __file__ peut manquer; fallback sur cwd (ne pas remonter d'un niveau)
try:
    root = Path(__file__).resolve().parent
except NameError:
    root = Path.cwd()

static_dir = root / "backend" / "static"
static_datas = []
if static_dir.exists():
    static_datas.append((str(static_dir), "backend/static"))

hidden = collect_submodules("backend")

a = Analysis(
    ["run_app.py"],
    pathex=[str(root)],
    binaries=[],
    datas=static_datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="VerifFacture",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="installer\\logo.ico",
)
