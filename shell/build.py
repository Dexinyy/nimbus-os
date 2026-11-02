#!/usr/bin/env python3
"""Build the Nimbus desktop into one self-contained HTML page.

  python3 build.py                 web build: dist/index.html (+ dist/test.html for browser tests)
  python3 build.py --native DIR    Nimbus OS build: DIR/index.html with local fonts in DIR/fonts
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
FONTS = ROOT.parent / "os" / "fonts"

CSS_ORDER = ["base.css", "shell.css", "apps.css"]
JS_ORDER = [
    "core.js", "native.js", "net.js", "store.js", "walls.js", "ui.js", "wm.js", "shell.js",
    "app-files.js", "app-notes.js", "app-photos.js", "app-paint.js",
    "app-settings.js", "app-calc.js", "app-terminal.js", "app-taskmgr.js",
    "app-clock.js", "app-mines.js", "app-assistant.js", "app-welcome.js",
    "main.js",
]
LOCAL_FONTS = """
@font-face { font-family: "Figtree"; src: url("fonts/Figtree.ttf") format("truetype"); font-weight: 300 900; font-display: swap; }
@font-face { font-family: "Sora"; src: url("fonts/Sora.woff2") format("woff2"); font-weight: 100 800; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("fonts/JetBrainsMono.ttf") format("truetype"); font-weight: 100 800; font-display: swap; }
"""


def bundle(test_hook=False):
    css = "\n".join((SRC / "css" / f).read_text() for f in CSS_ORDER)
    js = "\n".join(f"/* ---- {f} ---- */\n" + (SRC / "js" / f).read_text() for f in JS_ORDER)
    if test_hook:
        js += "\nwindow.__n = { WM, S, FS, Store, Flyouts, Power, Notif, Clock, Desktop, Menu, caps, bus, Native, Net, QS };\n"
    return css, "(() => {\n" + js + "\n})();\n"


def page(template, css, js):
    return template.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)


def main():
    template = (SRC / "index.html").read_text()
    if len(sys.argv) >= 3 and sys.argv[1] == "--native":
        out = Path(sys.argv[2])
        out.mkdir(parents=True, exist_ok=True)
        native_tpl = re.sub(r'\s*<link rel="(preconnect|stylesheet)" href="https://fonts\.[^"]+"[^>]*>', "", template)
        css, js = bundle()
        (out / "index.html").write_text(page(native_tpl, LOCAL_FONTS + css, js))
        (out / "fonts").mkdir(exist_ok=True)
        for f in FONTS.iterdir():
            shutil.copy2(f, out / "fonts" / f.name)
        print(f"Built native shell in {out} ({len(js) // 1024} KB of script)")
        return
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    css, js = bundle()
    (dist / "index.html").write_text(page(template, css, js))
    (dist / "app.js").write_text(js)
    _, test_js = bundle(test_hook=True)
    (dist / "test.html").write_text(page(template, css, test_js))
    print(f"Built dist/index.html: {len(page(template, css, js)) // 1024} KB")


if __name__ == "__main__":
    main()
