#!/usr/bin/env bash
# A quick check of nimbus-wm without a virtual machine (a CI server works): the window manager runs
# headless with the real Nimbus desktop, opens Google Chrome (already installed on GitHub's servers)
# through the desktop's Chrome test, and takes screenshots with grim while keys and clicks go in
# through wtype and wlrctl (allowed by nimbus-wm --test).
# usage: wm/test-headless.sh OUTDIR     needs: grim wtype wlrctl dbus-run-session google-chrome python3-gi
#                                              gir1.2-webkit2-4.1, and wm/nimbus-wm built
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${1:-out/wm}"
OUT="$(cd "${1:-out/wm}" && pwd)"
export XDG_RUNTIME_DIR=/tmp/nimbus-wm-test
rm -rf "$XDG_RUNTIME_DIR" && mkdir -m 700 -p "$XDG_RUNTIME_DIR"
python3 "$ROOT/shell/build.py" --native /tmp/nimbus-wm-shell >/dev/null
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1
export NIMBUS_SHELL_DIR=/tmp/nimbus-wm-shell NIMBUS_LIB_DIR="$ROOT/os/overlay/usr/lib/nimbus" NIMBUS_SOFTWARE=1
export NIMBUS_TEST=chrome XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=Nimbus GDK_BACKEND=wayland NO_AT_BRIDGE=1
export PYTHONUNBUFFERED=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
unset WAYLAND_DISPLAY DISPLAY
FAILED=0
summary="$OUT/summary.md"
printf '## nimbus-wm headless check\n\n' > "$summary"
note() { if [ "$1" = ok ]; then echo "PASS $2"; echo "- ✅ $2" >> "$summary"; else echo "FAIL $2"; echo "- ❌ $2" >> "$summary"; FAILED=1; fi; }

dbus-run-session -- "$ROOT/wm/nimbus-wm" --test -- python3 "$ROOT/os/overlay/usr/bin/nimbus-shell" > "$OUT/wm.log" 2>&1 &
SESSION=$!
for _ in $(seq 100); do [ -S "$XDG_RUNTIME_DIR/wayland-0" ] && break; sleep 0.2; done
export WAYLAND_DISPLAY=wayland-0
[ -S "$XDG_RUNTIME_DIR/wayland-0" ] && note ok "The window manager starts" || note fail "The window manager starts"

shot() { grim "$OUT/$1.png" 2>>"$OUT/grim.log" && echo "screenshot $1"; }
wait_log() { # pattern seconds
  local end=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$end" ]; do
    grep -q "$1" "$OUT/wm.log" && return 0
    grep -q "test chrome: failed" "$OUT/wm.log" && return 1
    kill -0 "$SESSION" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}
differs() { # a b: share of pixels that changed, as a percentage
  python3 - "$OUT/$1.png" "$OUT/$2.png" <<'PY'
import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert("L").resize((160, 90)); b = Image.open(sys.argv[2]).convert("L").resize((160, 90))
pa, pb = a.load(), b.load()
print(round(100 * sum(1 for x in range(160) for y in range(90) if abs(pa[x, y] - pb[x, y]) > 24) / 14400))
PY
}

wait_log "the desktop is on screen" 40 && note ok "The desktop shows" || note fail "The desktop shows"
sleep 8
shot 01-desktop
if wait_log "test chrome: ready" 90; then note ok "Chrome opens as a window and maximizes"; else note fail "Chrome opens as a window and maximizes ($(grep -o 'test chrome: failed.*' "$OUT/wm.log" | head -1))"; fi
sleep 2
shot 02-chrome
blue() { # share of the screen showing the test page's blue, as a percentage
  python3 - "$OUT/$1.png" <<'PY'
import sys
from PIL import Image
px = Image.open(sys.argv[1]).convert("RGB").resize((160, 90)).load()
print(round(100 * sum(1 for x in range(160) for y in range(90)
                      if abs(px[x, y][0] - 0x1a) < 40 and abs(px[x, y][1] - 0x73) < 40 and abs(px[x, y][2] - 0xe8) < 40) / 14400))
PY
}
[ "$(blue 02-chrome)" -gt 50 ] && note ok "Chrome shows its page over the desktop" || note fail "Chrome shows its page over the desktop ($(blue 02-chrome)% blue)"

wtype -k Super_L; sleep 2
shot 03-start-over-chrome
[ "$(differs 02-chrome 03-start-over-chrome)" -gt 5 ] && note ok "The Windows key opens Start over Chrome" || note fail "The Windows key opens Start over Chrome"
wtype settings; sleep 1; wtype -k Return; sleep 4
shot 04-settings-over-chrome
[ "$(differs 02-chrome 04-settings-over-chrome)" -gt 15 ] && note ok "Settings opens over Chrome" || note fail "Settings opens over Chrome"

# Click a part of Chrome that Settings doesn't cover (its left edge): Chrome comes forward
wlrctl pointer move -2000 -2000; wlrctl pointer move 12 360; sleep 0.3; wlrctl pointer click left; sleep 2
shot 05-click-chrome
[ "$(differs 02-chrome 05-click-chrome)" -lt 8 ] && note ok "Clicking Chrome brings it forward" || note fail "Clicking Chrome brings it forward ($(differs 02-chrome 05-click-chrome)% differs)"

# The taskbar stays above Chrome: clicking Chrome's taskbar button minimizes it
wtype -k Super_L; sleep 1.5; wtype -k Escape; sleep 1.5
shot 06-after-start
kill -0 "$SESSION" 2>/dev/null && note ok "The window manager is still running" || note fail "The window manager is still running"
grep -E "window [0-9]+ \(|key |the desktop|screen " "$OUT/wm.log" | head -40
kill "$SESSION" 2>/dev/null; wait "$SESSION" 2>/dev/null
cat "$summary"
exit "$FAILED"
