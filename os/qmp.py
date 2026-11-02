#!/usr/bin/env python3
"""Drive a Nimbus OS virtual machine through QEMU's QMP socket.

usage: qmp.py SOCKET OUTDIR NAME SLOWNESS SCENARIO
  SCENARIO  full  - boot, open Start, Terminal and Settings, Alt+Tab, then shut down
            settings - Settings' sound, display, input, power, printing and storage through the real services
            short - boot to the desktop, then shut down
            wifi  - boot with nimbus.test=wifi, check the desktop joined NimbusTestAP, then shut down
            storage - boot with nimbus.test=storage from a USB image: set up saving, restart twice, check
            chrome - boot with nimbus.test=chrome: install Chrome from Google, open it as a window, then
                     Start, Settings and Alt+Tab over it, typing into it and closing it
            logs  - boot, take one screenshot, leave the serial log for reading

Screenshots go to OUTDIR/NAME-*.png and results are appended to OUTDIR/summary.md.
Exit status is 1 when a check fails.
"""
import json
import os
import re
import socket
import sys
import time

from PIL import Image

QCODES = {" ": "spc", "\n": "ret", "\t": "tab", "-": "minus", ".": "dot", "/": "slash", ",": "comma", "=": "equal", ";": "semicolon",
          "'": "apostrophe", "\\": "backslash", "`": "grave_accent", "[": "bracket_left", "]": "bracket_right"}
# Characters typed with Shift held, on a US keyboard
SHIFTED = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
           "_": "minus", "+": "equal", ":": "semicolon", '"': "apostrophe", "<": "comma", ">": "dot", "?": "slash",
           "|": "backslash", "~": "grave_accent", "{": "bracket_left", "}": "bracket_right"}


class VM:
    def __init__(self, path, timeout=90):
        self.events = []
        end = time.time() + timeout
        while True:
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                self.sock.connect(path)
                break
            except OSError:
                self.sock.close()
                if time.time() > end:
                    raise
                time.sleep(0.5)
        self.f = self.sock.makefile("rw", encoding="utf-8")
        self._read()
        self.cmd("qmp_capabilities")

    def _read(self):
        while True:
            line = self.f.readline()
            if not line:
                raise EOFError("the virtual machine closed the connection")
            msg = json.loads(line)
            if "event" in msg:
                self.events.append(msg)
                continue
            return msg

    def cmd(self, name, **args):
        req = {"execute": name}
        if args:
            req["arguments"] = args
        self.f.write(json.dumps(req) + "\n")
        self.f.flush()
        reply = self._read()
        if "error" in reply:
            raise RuntimeError(reply["error"].get("desc", reply["error"]))
        return reply.get("return")

    def shot(self, path):
        tmp = path + ".ppm"
        self.cmd("screendump", filename=os.path.abspath(tmp))
        Image.open(tmp).save(path)
        os.remove(tmp)
        return path

    def brightness(self):
        tmp = "/tmp/nimbus-probe.png"
        self.shot(tmp)
        img = Image.open(tmp).convert("L").resize((80, 50))
        data = list(img.getdata())
        return sum(data) / len(data)

    def key(self, *names, hold=70):
        self.cmd("send-key", keys=[{"type": "qcode", "data": n} for n in names], **{"hold-time": hold})
        time.sleep(0.12)

    def press(self, name, down):
        self.cmd("input-send-event", events=[{"type": "key", "data": {"down": down, "key": {"type": "qcode", "data": name}}}])
        time.sleep(0.08)

    def type(self, text):
        for ch in text:
            if ch.isalpha():
                self.key("shift", ch.lower()) if ch.isupper() else self.key(ch)
            elif ch.isdigit():
                self.key(ch)
            elif ch in SHIFTED:
                self.key("shift", SHIFTED[ch])
            else:
                self.key(QCODES[ch])

    def wait_exit(self, timeout):
        end = time.time() + timeout
        try:
            while time.time() < end:
                self.cmd("query-status")
                time.sleep(1)
        except (EOFError, OSError, ValueError):
            return True
        return False


def changed(path_a, path_b):
    """Share of the screen that differs between two screenshots (0..1)."""
    try:
        a = Image.open(path_a).convert("L").resize((160, 100))
        b = Image.open(path_b).convert("L").resize((160, 100))
    except OSError:
        return 0.0
    pa, pb = a.load(), b.load()
    diff = sum(1 for x in range(160) for y in range(100) if abs(pa[x, y] - pb[x, y]) > 24)
    return diff / 16000


def main():
    sock, outdir, name, slow, scenario = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
    os.makedirs(outdir, exist_ok=True)
    results = []

    def note(label, ok, detail=""):
        results.append((label, ok, detail))
        print(("PASS " if ok else "FAIL ") + label + (f" ({detail})" if detail else ""), flush=True)

    def finish():
        with open(os.path.join(outdir, "summary.md"), "a", encoding="utf-8") as f:
            f.write(f"\n### {name}\n")
            for label, ok, detail in results:
                f.write(f"- {'✅' if ok else '❌'} {label}{f' ({detail})' if detail else ''}\n")
        return 0 if all(ok for _, ok, _ in results) else 1

    vm = VM(sock)
    t0 = time.time()

    def snap(label):
        path = os.path.join(outdir, f"{name}-{label}.png")
        try:
            vm.shot(path)
            print("screenshot", path, flush=True)
        except Exception as exc:  # the machine may already be off
            print("screenshot failed:", exc, flush=True)

    if scenario != "logs":
        time.sleep(2.5 * slow)
        snap("01-boot-menu")
    # The desktop is up when the screen turns bright (boot screens are dark).
    seen, deadline = False, time.time() + 300 * slow
    while time.time() < deadline:
        time.sleep(3)
        try:
            if vm.brightness() > 45:
                seen = True
                break
        except (EOFError, OSError):
            break
        except Exception as exc:
            print("probe:", exc, flush=True)
    took = time.time() - t0
    time.sleep(6 * slow)
    snap("02-desktop")
    note("Starts to the Nimbus desktop", seen, f"{took:.0f} s")
    if not seen or scenario == "logs":
        if scenario == "logs":
            time.sleep(10 * slow)
            try:
                vm.cmd("quit")
            except Exception:
                pass
        return finish()

    if scenario == "full":
        vm.key("meta_l")
        time.sleep(1.5 * slow)
        snap("03-start-menu")
        share = changed(os.path.join(outdir, f"{name}-02-desktop.png"), os.path.join(outdir, f"{name}-03-start-menu.png"))
        note("The first Windows key press opens Start", share > 0.05, f"{share:.0%} of the screen changed")
        vm.type("terminal")
        time.sleep(1.2 * slow)
        vm.key("ret")
        time.sleep(2.5 * slow)
        vm.type("neofetch\n")
        time.sleep(3 * slow)
        vm.type("echo $USER on $(uname -sr), sudo says $(sudo -n whoami)\n")
        time.sleep(4 * slow)
        snap("04-terminal")
        vm.key("meta_l")
        time.sleep(1.2 * slow)
        vm.type("device spec")
        time.sleep(1.2 * slow)
        vm.key("ret")
        time.sleep(3 * slow)
        snap("05-settings-about")
        vm.press("alt", True)
        vm.key("tab")
        time.sleep(0.8 * slow)
        snap("06-alt-tab")
        vm.press("alt", False)
        time.sleep(1.2 * slow)

    if scenario == "wifi":
        serial = os.path.join(outdir, f"{name}-serial.log")
        ok, detail, end = False, "no result in the system log", time.time() + 150 * slow
        while time.time() < end:
            text = open(serial, errors="replace").read() if os.path.exists(serial) else ""
            if "test wifi: connected" in text:
                ok, detail = True, ""
                break
            m = re.search(r"test wifi: failed: ([^\r\n]*)", text)
            if m:
                detail = m.group(1)
                break
            time.sleep(2)
        time.sleep(3 * slow)
        snap("08-wifi")
        note("Joins a Wi-Fi network with its password", ok, detail)
        text = open(serial, errors="replace").read() if os.path.exists(serial) else ""
        m = re.search(r"test wifi: settings shows ([^\r\n]*)", text)
        note("Settings shows the network it joined", bool(m) and m.group(1).strip() == "NimbusTestAP", m.group(1) if m else "not reported")

    if scenario == "storage":
        serial = os.path.join(outdir, f"{name}-serial.log")

        def wait_log(pattern, seconds):
            end = time.time() + seconds * slow
            while time.time() < end:
                text = open(serial, errors="replace").read() if os.path.exists(serial) else ""
                found = re.findall(pattern, text)
                if found:
                    return found, text
                if "test storage: failed" in text:
                    return [], text
                time.sleep(2)
            return [], open(serial, errors="replace").read() if os.path.exists(serial) else ""

        # From a USB image casper saves by itself ("marker written" first); with an empty disk Nimbus sets it up first
        found, text = wait_log(r"test storage: (set up on \S+|marker written), restarting", 150)
        failed = re.search(r"test storage: failed: ([^\r\n]*)", text)
        if found and found[0].startswith("set up"):
            note("Sets up saving on the empty disk", True)
            found, text = wait_log(r"test storage: marker written, restarting", 240)
            note("Starts with saving on after a restart", bool(found), "" if found else "the second start didn't use the storage area")
        else:
            note("Saves by itself from the first start", bool(found), "" if found else failed.group(1) if failed else "no result in the system log")
        if found:
            # The third start reports "kept"; a second "marker written" means the second start's changes were lost
            result, end = "", time.time() + 240 * slow
            while time.time() < end and not result:
                text = open(serial, errors="replace").read() if os.path.exists(serial) else ""
                if "test storage: kept" in text:
                    result = "kept"
                elif text.count("test storage: marker written") >= 2:
                    result = "lost"
                elif "test storage: failed" in text:
                    result = "failed"
                else:
                    time.sleep(2)
            note("A setting survives a restart", result == "kept", "" if result == "kept" else result or "no result in the system log")
            if result == "kept":
                time.sleep(4 * slow)
                snap("09-saving")

    if scenario == "settings":
        serial = os.path.join(outdir, f"{name}-serial.log")

        def slog():
            return open(serial, errors="replace").read() if os.path.exists(serial) else ""

        def got(pattern, seconds):
            end = time.time() + seconds * slow
            while time.time() < end:
                m = re.search(pattern, slog())
                if m or "test settings: failed" in slog():
                    return m
                time.sleep(2)
            return None

        m = got(r"test settings: sound (\S+)[^\r\n]*? outputs=(\d+) default=([^\r\n]*)", 120)
        note("Sound plays through PipeWire", bool(m) and m.group(1) == "available" and int(m.group(2)) > 0,
             f"{m.group(2)} output(s), default {m.group(3).strip()}" if m else "no result")
        m = got(r"test settings: volume now (\d+)", 30)
        note("Settings changes the real volume", bool(m) and m.group(1) == "37", m.group(1) if m else "no result")
        m = got(r"test settings: display (\S+) (\d+)x(\d+) modes=(\d+)", 60)
        note("Settings lists the display's resolutions", bool(m) and int(m.group(4)) > 1, f"{m.group(1)} {m.group(2)}x{m.group(3)}, {m.group(4)} modes" if m else "no result")
        m = got(r"test settings: resolution changed to (\d+x\d+)", 40)
        note("Settings changes the resolution", bool(m) and m.group(1) != "1440x900", m.group(1) if m else "no result")
        if m:
            time.sleep(0.5)
            snap("03-resolution-changed")
        m = got(r"test settings: resolution back to (\d+x\d+)", 40)
        note("...and puts it back", bool(m) and m.group(1) == "1440x900", m.group(1) if m else "no result")
        m = got(r"test settings: input keyboards=(\d+) pointers=(\d+)", 30)
        note("Settings sees the keyboard and pointer", bool(m) and int(m.group(1)) > 0 and int(m.group(2)) > 0, f"{m.group(1)} keyboard(s), {m.group(2)} pointer(s)" if m else "no result")
        m = got(r"test settings: power modes ([^\r\n]*)", 30)
        note("Power modes answer", bool(m) and "none" not in m.group(1).split(" ")[0], m.group(1).strip() if m else "no result")
        m = got(r"test settings: printing ([^\r\n]*)", 30)
        note("The printing service runs", bool(m) and m.group(1).startswith("ready"), m.group(1).strip() if m else "no result")
        m = got(r"test settings: storage ([^\r\n]*)", 60)
        note("Storage is measured", bool(m) and "failed" not in m.group(1), m.group(1).strip() if m else "no result")
        for i, page in enumerate(["system", "sound", "display", "devices", "network", "personalization", "time", "update"]):
            if got(r"test settings: page " + page, 30):
                time.sleep(0.4 * slow)
                snap(f"{i + 4:02d}-settings-{page}")
        m = got(r"test settings: all pages: (\d+) opened, (\d+) failed([^\r\n]*)", 120)
        bad = re.findall(r"test settings: page (\S+) failed", slog())
        note("Every Settings page opens", bool(m) and m.group(2) == "0" and not bad, (m.group(0).split(": ", 1)[1] if m else "no result") + (" (" + ", ".join(bad) + ")" if bad else ""))
        failed = re.search(r"test settings: failed: ([^\r\n]*)", slog())
        note("The Settings test finished", bool(re.search(r"test settings: done", slog())), failed.group(1) if failed else "")
        try:
            vm.cmd("quit")
        except Exception:
            pass
        return finish()

    if scenario == "chrome":
        serial = os.path.join(outdir, f"{name}-serial.log")

        def log_text():
            return open(serial, errors="replace").read() if os.path.exists(serial) else ""

        def wait_for(pattern, seconds):
            end = time.time() + seconds * slow
            while time.time() < end:
                text = log_text()
                m = re.search(pattern, text)
                if m or "test chrome: failed" in text:
                    return m
                time.sleep(2)
            return None

        def shot_diff(a, b):
            return changed(os.path.join(outdir, f"{name}-{a}.png"), os.path.join(outdir, f"{name}-{b}.png"))

        m = wait_for(r"test chrome: installed in (\d+) s \(([^)]*)\)", 600)
        failed = re.search(r"test chrome: failed: ([^\r\n]*)", log_text())
        note("Installs Google Chrome from Google", bool(m), f"{m.group(1)} s, version {m.group(2)}" if m else failed.group(1) if failed else "no result in the system log")
        m = wait_for(r"test chrome: window opened: ([^\r\n]*)", 120)
        note("Chrome opens as a window on the desktop", bool(m), m.group(1).strip() if m else "")
        m = wait_for(r"test chrome: page loaded: ([^\r\n]*)", 60)
        note("Chrome shows a web page", bool(m), m.group(1).strip() if m else "")
        ready = wait_for(r"test chrome: ready", 60)
        m = re.search(r"test chrome: maximized: (\S+) (\d+)x(\d+)", log_text())
        note("Chrome maximizes through the desktop", bool(m) and m.group(1) == "max", f"{m.group(2)}x{m.group(3)}" if m else "")
        if ready:
            time.sleep(2 * slow)
            snap("10-chrome")
            vm.key("meta_l")
            time.sleep(1.5 * slow)
            snap("11-start-over-chrome")
            share = shot_diff("10-chrome", "11-start-over-chrome")
            note("The Windows key opens Start over Chrome", share > 0.05, f"{share:.0%} of the screen changed")
            vm.type("settings")
            time.sleep(1.2 * slow)
            vm.key("ret")
            time.sleep(3 * slow)
            snap("12-settings-over-chrome")
            share = shot_diff("10-chrome", "12-settings-over-chrome")
            note("A Nimbus window opens over Chrome", share > 0.15, f"{share:.0%} of the screen changed")
            vm.press("alt", True)
            vm.key("tab")
            time.sleep(0.8 * slow)
            snap("13-alt-tab")
            vm.press("alt", False)
            time.sleep(1.5 * slow)
            snap("14-back-to-chrome")
            back = shot_diff("10-chrome", "14-back-to-chrome")
            note("Alt+Tab brings Chrome back to the front", back < 0.08, f"{back:.0%} differs from Chrome before")
            vm.key("ctrl", "l")
            time.sleep(0.6 * slow)
            vm.type("about:blank\n")
            time.sleep(2.5 * slow)
            snap("15-typed-in-chrome")
            share = shot_diff("14-back-to-chrome", "15-typed-in-chrome")
            note("Typing goes to Chrome", share > 0.15, f"{share:.0%} of the screen changed")
            vm.key("alt", "f4")
            m = wait_for(r"test chrome: window closed", 30)
            note("Alt+F4 closes Chrome", bool(m))
            time.sleep(1.5 * slow)
            snap("16-chrome-closed")

    # Alt+F4 closes each window, then on the empty desktop it asks what to do; Enter picks "Shut down".
    for _ in range(4):
        vm.key("alt", "f4")
        time.sleep(1.0 * slow)
    snap("07-shut-down-dialog")
    vm.key("ret")
    off = vm.wait_exit(120 * slow)
    note("Shut down turns the computer off", off)
    return finish()


if __name__ == "__main__":
    sys.exit(main())
