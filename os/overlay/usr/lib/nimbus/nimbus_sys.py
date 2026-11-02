"""The computer behind Nimbus's Settings: sound (PipeWire), displays and input (through nimbus-wm), Bluetooth (BlueZ),
power, the clock, storage, printers (CUPS), networks (NetworkManager), screenshots and the clipboard. Updates are in
nimbus_update.py.

SysMethods is mixed into nimbus-shell's Shell: each m_<name> answers the page's Native.call('<name>'), on a worker
thread unless the launcher lists it as a main-thread call. Changes the page should hear about go out with
self.emit(<name>, data) and arrive on the page's bus as 'native:<name>'.
Anything that needs root goes through /usr/lib/nimbus/nimbus-sys, which sudo allows for this user only."""
import base64
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

from gi.repository import Gio, GLib

HELPER = "/usr/lib/nimbus/nimbus-sys"
APPS_HELPER = "/usr/lib/nimbus/nimbus-apps"
CONFIG_DIR = os.path.join(GLib.get_user_config_dir(), "nimbus")
DATA_DIR = os.path.join(GLib.get_user_data_dir(), "nimbus")
BUILD_INFO = "/usr/share/nimbus/build-info.json"
PRIVATE_ENV = ("NIMBUS_WM_FD", "WAYLAND_SOCKET", "NIMBUS_TEST")


class SysError(Exception):
    pass


def env():
    e = {k: v for k, v in os.environ.items() if k not in PRIVATE_ENV}
    e.setdefault("LC_ALL", "C.UTF-8")
    return e


def run(argv, timeout=20, check=True, data=None):
    try:
        r = subprocess.run(argv, input=data, capture_output=True, text=not isinstance(data, bytes), timeout=timeout, env=env())
    except FileNotFoundError:
        raise SysError("%s isn't installed" % argv[0])
    except subprocess.TimeoutExpired:
        raise SysError("%s took too long" % os.path.basename(argv[0]))
    if check and r.returncode != 0:
        err = r.stderr if isinstance(r.stderr, str) else r.stderr.decode(errors="replace")
        out = r.stdout if isinstance(r.stdout, str) else r.stdout.decode(errors="replace")
        raise SysError((err or out or "%s failed" % argv[0]).strip().splitlines()[-1][:300])
    return r.stdout


def helper(*args, timeout=60):
    """The root helper (sudo, without a password, for this command only)."""
    return run(["sudo", "-n", HELPER, *[str(a) for a in args]], timeout=timeout)


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def du(path):
    total = 0
    for root, dirs, files in os.walk(path, onerror=lambda e: None):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_blocks * 512
            except OSError:
                pass
    return total


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


# ================================================================ sound (PipeWire, through its PulseAudio side)
def pactl_json(*args):
    out = run(["pactl", "-f", "json", *args], timeout=6)
    return json.loads(out or "null")


def vol_percent(v):
    try:
        vals = [int(str(c.get("value_percent", "0")).rstrip("%")) for c in (v or {}).values()]
        return max(vals) if vals else 0
    except (ValueError, AttributeError):
        return 0


def device_kind(d, source=False):
    p = d.get("properties", {})
    port = (d.get("active_port") or "").lower()
    if p.get("device.bus") == "bluetooth":
        return "bluetooth"
    if "hdmi" in port or "hdmi" in d.get("name", "").lower():
        return "hdmi"
    if "headphone" in port or "headset" in port or p.get("device.form_factor") in ("headphone", "headset"):
        return "headphones"
    if p.get("device.bus") == "usb":
        return "usb"
    return "mic" if source else "speaker"


def device_entry(d, default_name, source=False):
    p = d.get("properties", {})
    port = next((x for x in d.get("ports") or [] if x.get("name") == d.get("active_port")), None)
    # "Built-in Audio" reads better than the chip's full name (shown in Windows as "Realtek(R) Audio")
    card = re.sub(r"\s*\([^)]*\)", "", p.get("device.description") or p.get("alsa.card_name") or p.get("device.product.name") or d.get("description", "")).strip()
    name = (port or {}).get("description") or d.get("description") or d.get("name")
    if p.get("device.bus") == "bluetooth":
        name, card = d.get("description") or name, "Bluetooth"
    if name == card:
        card = ""
    return {"id": d.get("index"), "name": name, "desc": card, "kind": device_kind(d, source), "default": d.get("name") == default_name,
            "volume": vol_percent(d.get("volume")), "muted": bool(d.get("mute")), "key": d.get("name")}


def sound_status():
    try:
        info = pactl_json("info")
        sinks = pactl_json("list", "sinks") or []
        sources = [s for s in pactl_json("list", "sources") or [] if s.get("properties", {}).get("device.class") != "monitor" and not s.get("name", "").endswith(".monitor")]
        inputs = pactl_json("list", "sink-inputs") or []
    except (SysError, ValueError) as exc:
        return {"available": False, "error": str(exc), "outputs": [], "inputs": [], "streams": []}
    streams = []
    for s in inputs:
        p = s.get("properties", {})
        if p.get("media.role") == "event" or p.get("application.id") == "org.PulseAudio.pavucontrol":
            continue
        app = p.get("application.name") or p.get("application.process.binary") or "Program"
        if re.match(r"^(Chromium|Google Chrome)", app):
            app = "Google Chrome"
        elif app in ("WebKitGTK", "nimbus-shell", "python3"):
            app = "Nimbus"
        streams.append({"id": s.get("index"), "app": app, "name": p.get("media.name") or app, "volume": vol_percent(s.get("volume")), "muted": bool(s.get("mute"))})
    return {"available": True, "outputs": [device_entry(s, info.get("default_sink_name")) for s in sinks],
            "inputs": [device_entry(s, info.get("default_source_name"), True) for s in sources], "streams": streams}


def sound_set(what, kind, dev, value):
    kinds = {"sink": "sink", "source": "source", "stream": "sink-input"}
    if kind not in kinds or not isinstance(dev, int):
        raise SysError("Unknown sound device")
    k = kinds[kind]
    if what == "default" and kind != "stream":
        listing = pactl_json("list", kind + "s") or []
        name = next((d["name"] for d in listing if d.get("index") == dev), None)
        if not name:
            raise SysError("That sound device is gone")
        run(["pactl", "set-default-" + kind, name])
    elif what == "volume":
        run(["pactl", "set-%s-volume" % k, str(dev), "%d%%" % max(0, min(150, int(value)))])
    elif what == "mute":
        run(["pactl", "set-%s-mute" % k, str(dev), "1" if value else "0"])
    else:
        raise SysError("Unknown sound setting")
    return True


def test_tone(path):
    """A short chime as a WAV file (the sound troubleshooter plays it)."""
    import math
    import struct
    import wave
    rate = 44100
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(rate * 0.9)):
            t = i / rate
            env_ = min(1, t * 40) * math.exp(-t * 4)
            v = int(12000 * env_ * (math.sin(2 * math.pi * 659.25 * t) + 0.5 * math.sin(2 * math.pi * 987.77 * t)) / 1.5)
            frames += struct.pack("<hh", v, v)
        w.writeframes(bytes(frames))


# ================================================================ Bluetooth (BlueZ over D-Bus)
BLUEZ = "org.bluez"
AGENT_PATH = "/org/nimbus/agent"
AGENT_XML = """<node><interface name="org.bluez.Agent1">
<method name="Release"/>
<method name="RequestPinCode"><arg type="o" direction="in"/><arg type="s" direction="out"/></method>
<method name="DisplayPinCode"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
<method name="RequestPasskey"><arg type="o" direction="in"/><arg type="u" direction="out"/></method>
<method name="DisplayPasskey"><arg type="o" direction="in"/><arg type="u" direction="in"/><arg type="q" direction="in"/></method>
<method name="RequestConfirmation"><arg type="o" direction="in"/><arg type="u" direction="in"/></method>
<method name="RequestAuthorization"><arg type="o" direction="in"/></method>
<method name="AuthorizeService"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
<method name="Cancel"/></interface></node>"""


def has_adapter():
    return bool(glob.glob("/sys/class/bluetooth/hci*"))


class Bluetooth:
    """BlueZ. Calls are made on worker threads (never the desktop's main loop) and never start BlueZ:
    without an adapter its service doesn't run, and asking for it would wait 25 seconds for nothing."""

    def __init__(self, on_change):
        self.on_change = on_change
        self.bus = None
        self.agent = False
        try:
            self.bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        except GLib.Error:
            return
        self.bus.signal_subscribe(BLUEZ, None, None, None, None, Gio.DBusSignalFlags.NONE, lambda *a: self.changed())
        try:  # the agent object lives on the main loop, where BlueZ's questions are answered
            node = Gio.DBusNodeInfo.new_for_xml(AGENT_XML)
            self.bus.register_object(AGENT_PATH, node.interfaces[0], self.agent_call, None, None)
        except Exception as exc:
            print("nimbus-shell: Bluetooth agent:", exc)
        threading.Thread(target=self.register_agent, daemon=True).start()

    def register_agent(self):
        """Pairing that asks nothing: like Windows' "Just works" for headphones, mice and speakers."""
        if self.agent or not has_adapter():
            return
        try:
            self.call("/org/bluez", "org.bluez.AgentManager1", "RegisterAgent", GLib.Variant("(os)", (AGENT_PATH, "NoInputNoOutput")))
            self.call("/org/bluez", "org.bluez.AgentManager1", "RequestDefaultAgent", GLib.Variant("(o)", (AGENT_PATH,)))
            self.agent = True
        except Exception as exc:  # BlueZ isn't running yet
            print("nimbus-shell: Bluetooth agent:", exc)

    def agent_call(self, _conn, _sender, _path, _iface, method, params, invocation):
        if method == "RequestPinCode":
            invocation.return_value(GLib.Variant("(s)", ("0000",)))
        elif method == "RequestPasskey":
            invocation.return_value(GLib.Variant("(u)", (0,)))
        else:
            if method in ("RequestConfirmation", "RequestAuthorization", "AuthorizeService"):
                path = params.unpack()[0]
                try:
                    self.set_prop(path, "org.bluez.Device1", "Trusted", GLib.Variant("b", True))
                except Exception:
                    pass
            invocation.return_value(None)

    def changed(self):
        if getattr(self, "_due", False):
            return
        self._due = True

        def fire():
            self._due = False
            self.on_change()
            return False
        GLib.timeout_add(300, fire)

    def call(self, path, iface, method, params=None, timeout=25000):
        if not self.bus or not has_adapter():
            raise SysError("This PC has no Bluetooth adapter")
        try:
            return self.bus.call_sync(BLUEZ, path, iface, method, params, None, Gio.DBusCallFlags.NO_AUTO_START, timeout, None)
        except GLib.Error as exc:
            msg = exc.message.split(":", 1)[-1].strip() if exc.message else "Bluetooth didn't answer"
            raise SysError({"Page Timeout": "The device didn't answer. Make sure it's on and nearby.",
                            "Authentication Failed": "Pairing was refused. Put the device in pairing mode and try again.",
                            "Connection refused": "The device refused the connection."}.get(msg, msg))

    def set_prop(self, path, iface, name, value):
        self.call(path, "org.freedesktop.DBus.Properties", "Set", GLib.Variant("(ssv)", (iface, name, value)))

    def objects(self):
        return self.call("/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects").unpack()[0]

    def adapter(self, objs=None):
        objs = objs if objs is not None else self.objects()
        return next(((p, i["org.bluez.Adapter1"]) for p, i in sorted(objs.items()) if "org.bluez.Adapter1" in i), (None, None))

    def status(self):
        if not has_adapter():
            return {"available": False, "devices": []}
        try:
            objs = self.objects()
        except SysError as exc:
            return {"available": False, "error": str(exc), "devices": []}
        path, a = self.adapter(objs)
        if not path:
            return {"available": False, "devices": []}
        devices = []
        for p, ifs in objs.items():
            d = ifs.get("org.bluez.Device1")
            if not d or not p.startswith(path + "/"):
                continue
            name = d.get("Alias") or d.get("Name")
            if not d.get("Paired") and (not d.get("Name") or re.match(r"^([0-9A-F]{2}-){5}[0-9A-F]{2}$", name or "")):
                continue  # unnamed devices nearby aren't worth listing
            devices.append({"address": d.get("Address"), "name": name or d.get("Address"), "icon": d.get("Icon", ""), "paired": bool(d.get("Paired")),
                            "connected": bool(d.get("Connected")), "trusted": bool(d.get("Trusted")), "rssi": d.get("RSSI"),
                            "battery": ifs.get("org.bluez.Battery1", {}).get("Percentage")})
        devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"].lower()))
        return {"available": True, "powered": bool(a.get("Powered")), "discovering": bool(a.get("Discovering")), "name": a.get("Alias") or socket.gethostname(),
                "address": a.get("Address"), "devices": devices}

    def device_path(self, address):
        if not re.match(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$", str(address or "")):
            raise SysError("Unknown Bluetooth device")
        objs = self.objects()
        path = next((p for p, i in objs.items() if i.get("org.bluez.Device1", {}).get("Address") == address), None)
        if not path:
            raise SysError("That device isn't nearby anymore")
        return path

    def do(self, args):
        action = args.get("action")
        path, _a = self.adapter()
        if not path:
            raise SysError("This PC has no Bluetooth adapter")
        if action == "power":
            on = bool(args.get("on"))
            try:
                self.set_prop(path, "org.bluez.Adapter1", "Powered", GLib.Variant("b", on))
            except SysError:
                if not on:
                    raise
                helper("bluetooth-unblock")  # switched off with rfkill (airplane mode, a hardware key)
                time.sleep(1)
                self.set_prop(path, "org.bluez.Adapter1", "Powered", GLib.Variant("b", True))
            if not self.agent:
                self.register_agent()
        elif action == "scan":
            try:
                self.call(path, "org.bluez.Adapter1", "StartDiscovery" if args.get("on") else "StopDiscovery")
            except SysError as exc:
                if "InProgress" not in str(exc) and "progress" not in str(exc).lower() and args.get("on"):
                    raise
        elif action == "pair":
            dev = self.device_path(args.get("address"))
            try:
                self.call(dev, "org.bluez.Device1", "Pair", timeout=60000)
            except SysError as exc:
                if "Already Exists" not in str(exc):
                    raise
            self.set_prop(dev, "org.bluez.Device1", "Trusted", GLib.Variant("b", True))
            self.call(dev, "org.bluez.Device1", "Connect", timeout=30000)
        elif action == "connect":
            self.call(self.device_path(args.get("address")), "org.bluez.Device1", "Connect", timeout=30000)
        elif action == "disconnect":
            self.call(self.device_path(args.get("address")), "org.bluez.Device1", "Disconnect")
        elif action == "remove":
            self.call(path, "org.bluez.Adapter1", "RemoveDevice", GLib.Variant("(o)", (self.device_path(args.get("address")),)))
        else:
            raise SysError("Unknown Bluetooth action")
        return True


# ================================================================ power, battery
def battery_info():
    for d in glob.glob("/sys/class/power_supply/*"):
        if read(d + "/type") != "Battery" or read(d + "/present", "1") == "0" or read(d + "/scope") == "Device":
            continue
        try:
            pct = int(read(d + "/capacity", "0"))
        except ValueError:
            continue
        status = read(d + "/status")
        left = None
        try:
            now = float(read(d + "/energy_now") or read(d + "/charge_now") or 0)
            rate = float(read(d + "/power_now") or read(d + "/current_now") or 0)
            if rate > 0 and status == "Discharging":
                left = int(now / rate * 3600)
        except ValueError:
            pass
        return {"percent": pct, "charging": status == "Charging", "timeLeft": left, "full": status == "Full"}
    return None


def on_ac():
    supplies = [d for d in glob.glob("/sys/class/power_supply/*") if read(d + "/type") in ("Mains", "USB", "USB_C")]
    return not supplies or any(read(d + "/online") == "1" for d in supplies)


def power_profiles():
    try:
        out = run(["powerprofilesctl", "list"], timeout=5)
    except SysError:
        return [], ""
    names = re.findall(r"^\s*(\*?)\s*([a-z-]+):\s*$", out, re.M)
    profiles = [n for _s, n in names]
    active = next((n for s, n in names if s == "*"), "")
    order = ["power-saver", "balanced", "performance"]
    return sorted(profiles, key=lambda p: order.index(p) if p in order else 9), active


# ================================================================ storage
def dpkg_size():
    total = 0
    try:
        with open("/var/lib/dpkg/status") as f:
            for line in f:
                if line.startswith("Installed-Size:"):
                    total += int(line.split()[1]) * 1024
    except (OSError, ValueError):
        pass
    return total


def clean_dir(path, older=0):
    freed = 0
    now = time.time()
    for root, dirs, files in os.walk(path, topdown=False, onerror=lambda e: None):
        for f in files:
            p = os.path.join(root, f)
            try:
                st = os.lstat(p)
                if older and now - st.st_mtime < older:
                    continue
                os.unlink(p)
                freed += st.st_blocks * 512
            except OSError:
                pass
        for d in dirs:
            try:
                os.rmdir(os.path.join(root, d))
            except OSError:
                pass
    return freed


def program_running(name):
    return subprocess.run(["pgrep", "-x", name], capture_output=True).returncode == 0


# ================================================================ networks (NetworkManager)
def nm_fields(line, count):
    # nmcli -t escapes ':' as '\:'
    parts, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":" and len(parts) < count - 1:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts + [""] * (count - len(parts))


def nm_blocks(out):
    """'nmcli -t -f ... device show' output: one dict per device."""
    blocks, cur = [], {}
    for line in out.splitlines():
        if not line.strip():
            continue
        key, _, val = line.partition(":")
        key = re.sub(r"\[\d+\]$", "", key)
        if key == "GENERAL.DEVICE" and cur:
            blocks.append(cur)
            cur = {}
        cur.setdefault(key, [])
        if val and val != "--":
            cur[key].append(val.replace("\\:", ":"))
    if cur:
        blocks.append(cur)
    return blocks


CONN_TYPES = {"802-11-wireless": "wifi", "802-3-ethernet": "ethernet", "wireguard": "wireguard", "vpn": "vpn", "loopback": "loopback", "bridge": "bridge"}


def ipv4_ok(v):
    return bool(re.match(r"^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$", v or ""))


# ================================================================ printers (CUPS)
def lpstat(*args):
    try:
        return run(["lpstat", *args], timeout=10, check=False)
    except SysError:
        return ""


def printer_name(name):
    if not re.match(r"^[A-Za-z0-9_.-]{1,127}$", str(name or "")):
        raise SysError("Printer names use letters, numbers, dots, dashes and underscores")
    return name


class SysMethods:
    """Mixed into nimbus-shell's Shell (which provides emit, wm and program_env)."""

    def sys_init(self):
        self.outputs = []
        self.inputs = {"keyboards": [], "pointers": [], "touchpad": False}
        self.bt = Bluetooth(lambda: self.push("bluetooth", self.bt.status))
        self.clip_proc = None
        threading.Thread(target=self.watch_sound, daemon=True).start()

    def push(self, name, fn):
        """Work out a status on a worker thread, then send it to the page."""
        def work():
            try:
                data = fn()
            except Exception as exc:
                print("nimbus-shell: %s: %s" % (name, exc))
                return
            GLib.idle_add(lambda: self.emit(name, data) and False)
        threading.Thread(target=work, daemon=True).start()

    # ---------------------------------------------------------------- sound
    def watch_sound(self):
        """Follow PipeWire's changes ('pactl subscribe'), sending the page a fresh status each time."""
        while True:
            try:
                proc = subprocess.Popen(["pactl", "subscribe"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env())
            except FileNotFoundError:
                return
            due = [0.0]
            lock = threading.Lock()

            def later():
                time.sleep(0.15)
                with lock:
                    if time.time() < due[0]:
                        return
                    due[0] = 0
                self.push("sound", sound_status)
            self.push("sound", sound_status)
            for line in proc.stdout:
                if re.search(r"on (sink|source|sink-input|server|card)", line):
                    with lock:
                        first = due[0] == 0
                        due[0] = time.time() + 0.1
                    if first:
                        threading.Thread(target=later, daemon=True).start()
            proc.wait()
            time.sleep(3)  # the sound server restarted (or isn't up yet)

    def m_soundStatus(self, _args):
        return sound_status()

    def m_soundSet(self, args):
        return sound_set(args.get("what"), args.get("kind"), args.get("id"), args.get("value"))

    # ---------------------------------------------------------------- displays (the window manager knows them)
    def on_outputs(self, event):
        self.outputs = event.get("list") or []
        self.emit("display", self.display_status())

    def on_inputs(self, event):
        # power buttons, lid switches and media-key halves of keyboards show up as keyboards too
        skip = re.compile(r"Button|Video Bus|Speaker|HD-Audio|HDA |Headphone|Mic|WMI|Consumer Control|System Control|Hotkeys|Lid Switch|Intel HID|Virtual", re.I)
        kbs, seen = [], set()
        for k in event.get("keyboards") or []:
            name = k.get("name", "")
            if not skip.search(name) and name not in seen:
                seen.add(name)
                kbs.append(k)
        event = dict(event, keyboards=kbs)
        self.inputs = {"keyboards": event.get("keyboards") or [], "pointers": event.get("pointers") or [],
                       "touchpad": any(p.get("touchpad") for p in event.get("pointers") or [])}
        self.emit("input", self.inputs)

    def backlight(self):
        best = None
        for d in glob.glob("/sys/class/backlight/*"):
            kind = read(d + "/type")
            rank = {"firmware": 0, "platform": 1, "raw": 2}.get(kind, 3)
            if best is None or rank < best[0]:
                best = (rank, d)
        if not best:
            return None
        d = best[1]
        try:
            mx = int(read(d + "/max_brightness", "0"))
            cur = int(read(d + "/brightness", "0"))
        except ValueError:
            return None
        return {"name": os.path.basename(d), "max": mx, "percent": round(cur * 100 / mx) if mx else 0} if mx else None

    def display_status(self):
        return {"outputs": self.outputs, "backlight": self.backlight()}

    def m_displayStatus(self, _args):
        return self.display_status()

    def m_displaySet(self, args):
        if not self.wm:
            raise SysError("Display settings need the Nimbus window manager")
        o = next((x for x in self.outputs if x.get("name") == args.get("name")), None)
        if not o:
            raise SysError("That display isn't connected")
        mode = args.get("mode") or [o["width"], o["height"], o["refresh"]]
        scale = float(args.get("scale") or o.get("scale") or 1)
        transform = int(args.get("transform") if args.get("transform") is not None else o.get("transform") or 0)
        if not (0.5 <= scale <= 3) or transform not in range(8) or not all(isinstance(v, (int, float)) for v in mode[:3]):
            raise SysError("That display setting isn't possible")
        if not re.match(r"^[A-Za-z0-9_.-]+$", o["name"]):
            raise SysError("Unknown display")
        GLib.idle_add(lambda: self.wm.send("output %s %d %d %d %d %d" % (o["name"], mode[0], mode[1], mode[2], round(scale * 1000), transform)) and False)
        return True

    def m_brightnessSet(self, args):
        b = self.backlight()
        if not b:
            raise SysError("This display has no brightness control")
        value = max(1, round(b["max"] * max(1, min(100, int(args.get("percent", 100)))) / 100))
        run(["busctl", "call", "org.freedesktop.login1", "/org/freedesktop/login1/session/auto", "org.freedesktop.login1.Session",
             "SetBrightness", "ssu", "backlight", b["name"], str(value)], timeout=5)
        return True

    def m_inputStatus(self, _args):
        return self.inputs

    def m_cursorSet(self, args):
        size = max(16, min(128, int(args.get("size") or 24)))
        theme = "DMZ-Black" if args.get("theme") == "black" else "DMZ-White"
        if not os.path.isdir("/usr/share/icons/" + theme):
            theme = "Adwaita"
        for key, val in (("cursor-size", str(size)), ("cursor-theme", theme)):
            run(["gsettings", "set", "org.gnome.desktop.interface", key, val], timeout=5, check=False)
        save_json(os.path.join(CONFIG_DIR, "cursor.json"), {"size": size, "theme": theme})
        return True

    # ---------------------------------------------------------------- Bluetooth
    def m_btStatus(self, _args):
        return self.bt.status()

    def m_btDo(self, args):
        result = self.bt.do(args)
        self.push("bluetooth", self.bt.status)
        return result

    # ---------------------------------------------------------------- power
    def m_powerStatus(self, _args):
        profiles, active = power_profiles()
        return {"battery": battery_info(), "ac": on_ac(), "profiles": profiles, "profile": active}

    def m_powerSet(self, args):
        profile = args.get("profile")
        if profile not in ("power-saver", "balanced", "performance"):
            raise SysError("Unknown power mode")
        run(["powerprofilesctl", "set", profile], timeout=10)
        return True

    def m_firmwareReboot(self, args):
        cmd = ["systemctl", "reboot"] + (["--firmware-setup"] if args.get("firmware") and os.path.isdir("/sys/firmware/efi") else [])
        run(cmd, timeout=20)
        return True

    # ---------------------------------------------------------------- clock, name
    def m_timeStatus(self, _args):
        props = dict(line.split("=", 1) for line in run(["timedatectl", "show"], timeout=5, check=False).splitlines() if "=" in line)
        last = 0
        try:
            last = int(os.stat("/var/lib/systemd/timesync/clock").st_mtime * 1000)
        except OSError:
            pass
        return {"ntp": props.get("NTP") == "yes", "synced": props.get("NTPSynchronized") == "yes", "timezone": props.get("Timezone", "UTC"),
                "canNtp": props.get("CanNTP", "yes") == "yes", "lastSync": last}

    def m_timeSet(self, args):
        if "ntp" in args:
            run(["timedatectl", "set-ntp", "true" if args["ntp"] else "false"], timeout=15)
        if args.get("time"):
            t = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(args["time"]) / 1000))
            run(["timedatectl", "set-time", t], timeout=15)
        return True

    def m_timeSync(self, _args):
        helper("time-sync")
        return True

    def m_hostnameSet(self, args):
        name = str(args.get("name", ""))
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9-]{0,62}$", name):
            raise SysError("Use letters, numbers and hyphens")
        helper("hostname", name)
        return name

    # ---------------------------------------------------------------- storage
    def m_storageUsage(self, _args):
        usage = shutil.disk_usage("/")
        home = os.path.expanduser("~")
        cache = du(os.path.join(home, ".cache"))
        apt = du("/var/cache/apt/archives")
        tmp = du("/tmp") + du("/var/tmp")
        chrome = du("/opt/google") if os.path.isdir("/opt/google") else 0
        data = du(os.path.join(home, ".config")) + du(os.path.join(home, ".local", "share"))
        cats = [{"label": "System", "bytes": max(0, dpkg_size() - chrome), "icon": "system"},
                {"label": "Programs", "bytes": chrome, "icon": "apps", "go": "installedapps"},
                {"label": "Program data", "bytes": data, "icon": "folder"},
                {"label": "Temporary files", "bytes": cache + apt + tmp, "icon": "delete", "go": "cleanup"}]
        return {"label": "Local disk", "total": usage.total, "free": usage.free, "categories": [c for c in cats if c["bytes"]],
                "temp": {"cache": cache, "apt": apt, "tmp": tmp}}

    def m_storageClean(self, args):
        what = set(args.get("what") or [])
        freed = 0
        home = os.path.expanduser("~")
        if "cache" in what:
            for d in glob.glob(os.path.join(home, ".cache", "*")):
                name = os.path.basename(d)
                if name in ("nimbus", "fontconfig") or (name == "google-chrome" and program_running("chrome")):
                    continue
                freed += clean_dir(d) if os.path.isdir(d) else 0
        if "tmp" in what:
            freed += clean_dir("/tmp", older=86400) + clean_dir("/var/tmp", older=86400)
        if "apt" in what:
            try:
                freed += int(helper("clean-apt", timeout=120).strip() or 0)
            except (SysError, ValueError):
                pass
        return {"freed": freed}

    def m_disks(self, _args):
        out = json.loads(run(["lsblk", "-J", "-b", "-o", "NAME,MODEL,SIZE,RM,TYPE,FSTYPE,LABEL,MOUNTPOINTS,TRAN"], timeout=10) or "{}")
        mounts = read("/proc/mounts")
        medium = re.findall(r"^(/dev/\S+) (/cdrom|/run/live/medium|/isodevice)\s", mounts, re.M)
        boot = {os.path.basename(m[0]) for m in medium}
        disks = []
        for d in out.get("blockdevices", []):
            if d.get("type") not in ("disk",) or d.get("name", "").startswith(("loop", "zram", "ram")):
                continue
            parts = [{"name": p.get("name"), "label": p.get("label") or "", "fstype": p.get("fstype") or "", "size": p.get("size") or 0,
                      "mount": ", ".join(x for x in (p.get("mountpoints") or []) if x)} for p in d.get("children") or []]
            disks.append({"name": d.get("name"), "model": (d.get("model") or "").strip() or d.get("name"), "size": d.get("size") or 0,
                          "removable": d.get("rm") in (True, 1, "1") or d.get("tran") == "usb", "parts": parts,
                          "nimbus": d.get("name") in boot or any(p["name"] in boot for p in parts)})
        return disks

    # ---------------------------------------------------------------- troubleshooters
    def m_troubleshoot(self, args):
        kind = args.get("kind")
        steps = []

        def step(title, ok, detail=""):
            steps.append({"title": title, "ok": bool(ok), "detail": detail})
            return ok
        if kind == "audio":
            run(["systemctl", "--user", "restart", "wireplumber", "pipewire", "pipewire-pulse"], timeout=30, check=False)
            time.sleep(2.5)
            st = sound_status()
            if not step("The sound service is running", st["available"], st.get("error", "")):
                return {"steps": steps, "summary": "The sound service didn't start. Restart your PC and try again."}
            if not step("A speaker or headphones are connected", st["outputs"], "" if st["outputs"] else "No sound output was found. In a virtual machine, turn on audio in its settings."):
                return {"steps": steps, "summary": "Nimbus can't find anything to play sound on."}
            d = next((o for o in st["outputs"] if o["default"]), st["outputs"][0])
            fixed = []
            if d["muted"]:
                sound_set("mute", "sink", d["id"], False)
                fixed.append("unmuted")
            if d["volume"] < 10:
                sound_set("volume", "sink", d["id"], 50)
                fixed.append("turned up the volume")
            step("Sound plays on " + d["name"], True, ("Nimbus " + " and ".join(fixed) + ".") if fixed else "")
            tone = os.path.join(tempfile.gettempdir(), "nimbus-test-tone.wav")
            test_tone(tone)
            played = subprocess.run(["paplay", tone], capture_output=True, timeout=10, env=env()).returncode == 0
            step("Played a test sound", played)
            return {"steps": steps, "summary": "Did you hear a chime? If not, check that your speakers are on, or choose another output in Sound."}
        if kind == "network":
            from nimbus_net import status as net_status
            s = net_status()
            if not step("The network service is running", s.get("available")):
                return {"steps": steps, "summary": "Restart your PC and try again."}
            if s.get("airplane"):
                run(["nmcli", "radio", "all", "on"], check=False)
                step("Turned airplane mode off", True)
            connected = s["wifi"].get("ssid") or s["wired"].get("connected")
            if not step("Connected to a network", connected, "" if connected else "Choose a Wi-Fi network or plug in a cable."):
                if s["wifi"].get("present") and not s["wifi"].get("enabled"):
                    run(["nmcli", "radio", "wifi", "on"], check=False)
                    step("Turned Wi-Fi on", True)
                return {"steps": steps, "summary": "Join a network, then run this again."}
            try:
                socket.getaddrinfo("github.com", 443)
                dns = True
            except OSError:
                dns = False
                helper("restart-resolved")
                time.sleep(2)
                try:
                    socket.getaddrinfo("github.com", 443)
                    dns = True
                except OSError:
                    pass
            step("Names of websites can be looked up", dns, "" if dns else "Try setting DNS servers by hand in your connection's properties, like 1.1.1.1.")
            try:
                with urllib.request.urlopen("http://connectivity-check.ubuntu.com/", timeout=8) as r:
                    online = r.status in (200, 204)
            except Exception:
                online = False
            step("This PC reaches the internet", online)
            return {"steps": steps, "summary": "You're online." if online else "This network doesn't reach the internet. If it's public Wi-Fi, open Chrome to sign in."}
        if kind == "bluetooth":
            try:
                helper("bluetooth-unblock")
                step("Bluetooth isn't switched off", True)
            except SysError as exc:
                step("Bluetooth isn't switched off", False, str(exc))
            st = self.bt.status()
            if not step("A Bluetooth adapter was found", st.get("available")):
                return {"steps": steps, "summary": "This PC has no Bluetooth adapter Nimbus can use."}
            if not st.get("powered"):
                self.bt.do({"action": "power", "on": True})
            step("Bluetooth is on", True)
            return {"steps": steps, "summary": "Bluetooth is ready. Add your device from Bluetooth & devices."}
        if kind == "display":
            if self.wm:
                GLib.idle_add(lambda: self.wm.send("output-reset") and False)
            step("Display set to its recommended resolution and 100% scale", bool(self.wm))
            return {"steps": steps, "summary": "Your display is back to its recommended settings."}
        raise SysError("Unknown troubleshooter")

    # ---------------------------------------------------------------- fonts
    def m_fonts(self, _args):
        out = run(["fc-list", "--format", "%{family[0]}|%{file}\n"], timeout=20)
        user = os.path.expanduser("~/.local/share/fonts")
        fams = {}
        for line in out.splitlines():
            fam, _, path = line.partition("|")
            if not fam or fam.startswith("."):
                continue
            f = fams.setdefault(fam, {"family": fam, "styles": 0, "user": False})
            f["styles"] += 1
            f["user"] = f["user"] or path.startswith(user)
        return sorted(fams.values(), key=lambda f: f["family"].lower())

    def m_fontInstall(self, args):
        name = os.path.basename(str(args.get("name", "")))
        if not re.match(r"^[\w .()+-]{1,120}\.(ttf|otf|woff2?|ttc)$", name, re.I):
            raise SysError("That isn't a font file")
        data = base64.b64decode(args.get("data") or "")
        if len(data) > 40 * 1024 * 1024 or data[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf", b"wOFF", b"wOF2"):
            raise SysError("That isn't a font file")
        d = os.path.expanduser("~/.local/share/fonts")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "wb") as f:
            f.write(data)
        run(["fc-cache", "-f", d], timeout=60, check=False)
        return True

    def m_fontRemove(self, args):
        fam = str(args.get("family", ""))
        d = os.path.expanduser("~/.local/share/fonts")
        out = run(["fc-list", "--format", "%{family[0]}|%{file}\n", ":family=" + fam], timeout=20, check=False)
        gone = 0
        for line in out.splitlines():
            f, _, path = line.partition("|")
            if f == fam and os.path.realpath(path).startswith(os.path.realpath(d) + "/"):
                os.unlink(path)
                gone += 1
        if not gone:
            raise SysError("Only fonts you installed can be removed")
        run(["fc-cache", "-f", d], timeout=60, check=False)
        return True

    # ---------------------------------------------------------------- printers and cameras
    def m_printers(self, _args):
        if not shutil.which("lpstat"):
            return {"available": False, "error": "Printing isn't installed", "printers": []}
        if subprocess.run(["lpstat", "-r"], capture_output=True, text=True, env=env()).stdout.find("not running") >= 0:
            return {"available": False, "error": "The printing service isn't running", "printers": []}
        uris = dict(re.findall(r"^device for (\S+): (\S+)", lpstat("-v"), re.M))
        default = (re.findall(r"system default destination: (\S+)", lpstat("-d")) or [""])[0]
        printers = []
        for m in re.finditer(r"^printer (\S+) (?:is )?(idle|now printing|disabled)[^\n]*", lpstat("-p"), re.M):
            name, state = m.group(1), m.group(2)
            jobs = len([x for x in lpstat("-o", name).splitlines() if x.strip()])
            desc = (re.findall(r"Description: (.*)", lpstat("-l", "-p", name)) or [""])[0].strip()
            printers.append({"name": name, "uri": uris.get(name, ""), "default": name == default, "jobs": jobs, "info": desc,
                             "state": {"idle": "Ready", "now printing": "Printing", "disabled": "Offline"}.get(state, state)})
        return {"available": True, "printers": printers}

    def m_printerFind(self, _args):
        out = helper("printer-find", timeout=60)
        found, seen = [], set()
        for line in out.splitlines():
            try:
                uri, info = line.split("\t", 1)
            except ValueError:
                continue
            if uri in seen:
                continue
            seen.add(uri)
            name = re.sub(r"[^A-Za-z0-9_-]+", "_", info).strip("_")[:60] or "Printer"
            found.append({"uri": uri, "name": name, "info": info})
        return found

    def m_printerAdd(self, args):
        uri = str(args.get("uri", ""))
        if not re.match(r"^(ipps?|https?|socket|lpd|dnssd|usb)://[^\s'\"]+$", uri):
            raise SysError("That isn't a printer address")
        helper("printer-add", printer_name(args.get("name")), uri, timeout=90)
        return True

    def m_printerDo(self, args):
        name, action = printer_name(args.get("name")), args.get("action")
        if action == "test":
            page = next((p for p in ("/usr/share/cups/data/testprint", "/usr/share/cups/data/default-testpage.pdf") if os.path.exists(p)), None)
            if not page:
                raise SysError("There's no test page on this PC")
            run(["lp", "-d", name, "-t", "Test page", page], timeout=30)
        elif action == "cancel":
            run(["cancel", "-a", name], timeout=15)
        elif action in ("default", "remove"):
            helper("printer-" + action, name, timeout=30)
        else:
            raise SysError("Unknown printer action")
        return True

    def m_cameras(self, _args):
        cams = []
        for d in sorted(glob.glob("/sys/class/video4linux/video*")):
            if read(d + "/index", "0") != "0":
                continue  # the same camera's metadata node
            cams.append({"name": read(d + "/name") or "Camera", "path": "/dev/" + os.path.basename(d)})
        return cams

    def m_privacySet(self, args):
        if "camera" in args:
            helper("camera", "on" if args["camera"] else "off")
        return True

    # ---------------------------------------------------------------- networks beyond Wi-Fi joining (nimbus_net.py)
    def m_netConns(self, _args):
        out = run(["nmcli", "-t", "-f", "NAME,UUID,TYPE,AUTOCONNECT,ACTIVE,TIMESTAMP", "connection", "show"], timeout=10)
        conns = []
        for line in out.splitlines():
            name, uuid, typ, auto, active, ts = nm_fields(line, 6)
            kind = CONN_TYPES.get(typ, typ)
            if kind in ("loopback", "bridge") or not uuid:
                continue
            props = {}
            detail = run(["nmcli", "-t", "-f", "connection.metered,802-11-wireless.ssid,802-11-wireless.cloned-mac-address,ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns,ipv4.ignore-auto-dns",
                          "connection", "show", uuid], timeout=10, check=False)
            for dl in detail.splitlines():
                k, _, v = dl.partition(":")
                props[k] = v.replace("\\:", ":")
            conns.append({"uuid": uuid, "name": name, "type": kind, "auto": auto == "yes", "active": active == "yes", "last": int(ts or 0),
                          "metered": props.get("connection.metered", "unknown"), "ssid": props.get("802-11-wireless.ssid", ""),
                          "macRandom": props.get("802-11-wireless.cloned-mac-address") or "preserve",
                          "ip4method": "manual" if props.get("ipv4.method") == "manual" else "auto",
                          "addresses": [a for a in props.get("ipv4.addresses", "").split(",") if a.strip()],
                          "gateway": props.get("ipv4.gateway", "") if props.get("ipv4.gateway") != "--" else "",
                          "dns": [a for a in props.get("ipv4.dns", "").split(",") if a.strip()],
                          "ignoreAutoDns": props.get("ipv4.ignore-auto-dns") == "yes"})
        return conns

    def m_netDetails(self, _args):
        out = run(["nmcli", "-t", "-f", "GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.HWADDR,GENERAL.CONNECTION,GENERAL.CON-UUID,GENERAL.MTU,GENERAL.DRIVER,GENERAL.PRODUCT,GENERAL.VENDOR,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS",
                   "device", "show"], timeout=10)
        wifi = run(["nmcli", "-t", "-f", "ACTIVE,SSID,CHAN,FREQ,RATE,SECURITY", "device", "wifi", "list", "--rescan", "no"], timeout=10, check=False)
        cur = next((nm_fields(x, 6) for x in wifi.splitlines() if x.startswith("yes:")), None)
        radio = run(["nmcli", "-t", "radio", "wifi"], timeout=5, check=False).strip()
        devs = []
        for b in nm_blocks(out):
            g = lambda k: (b.get(k) or [""])[0]  # noqa: E731
            typ = g("GENERAL.TYPE")
            state = re.sub(r"^\d+ \((.*)\)$", r"\1", g("GENERAL.STATE"))
            d = {"iface": g("GENERAL.DEVICE"), "type": {"wifi": "wifi", "ethernet": "ethernet", "loopback": "loopback"}.get(typ, typ), "state": state,
                 "mac": g("GENERAL.HWADDR"), "conn": g("GENERAL.CON-UUID"), "connName": g("GENERAL.CONNECTION"), "mtu": g("GENERAL.MTU"),
                 "driver": g("GENERAL.DRIVER"), "product": g("GENERAL.PRODUCT"), "vendor": g("GENERAL.VENDOR"),
                 "ip4": b.get("IP4.ADDRESS", []), "gw4": g("IP4.GATEWAY"), "dns": b.get("IP4.DNS", []), "ip6": b.get("IP6.ADDRESS", [])}
            speed = read("/sys/class/net/%s/speed" % d["iface"])
            if typ == "ethernet" and speed and not speed.startswith("-"):
                d["speed"] = "%s Mb/s" % speed
            if typ == "wifi":
                d["disabled"] = radio == "disabled"
                if cur:
                    _a, ssid, chan, freq, rate, sec = cur
                    mhz = int(re.sub(r"\D", "", freq) or 0)
                    d.update({"channel": chan, "band": "6 GHz" if mhz > 5925 else "5 GHz" if mhz > 4900 else "2.4 GHz", "speed": rate.replace("Mbit/s", "Mb/s"),
                              "security": sec.replace("WPA2", "WPA2-Personal") if sec else "Open", "ssid": ssid})
            elif typ == "ethernet":
                d["disabled"] = state in ("unmanaged",)
            if d["type"] != "loopback" and typ not in ("bridge", "tun", "wireguard", "wifi-p2p"):
                devs.append(d)
        return {"devices": devs}

    def m_netConnSet(self, args):
        uuid = str(args.get("uuid", ""))
        if not re.match(r"^[0-9a-fA-F-]{8,64}$", uuid):
            raise SysError("Unknown network")
        mods, reapply = [], False
        if "auto" in args:
            mods += ["connection.autoconnect", "yes" if args["auto"] else "no"]
        if "metered" in args:
            mods += ["connection.metered", "yes" if args["metered"] else "no"]
        if args.get("macRandom") in ("preserve", "stable", "random"):
            mods += ["802-11-wireless.cloned-mac-address", args["macRandom"]]
            reapply = True
        ip4 = args.get("ip4")
        if ip4:
            if ip4.get("method") == "manual":
                if not ipv4_ok(ip4.get("address")) or not (1 <= int(ip4.get("prefix", 0)) <= 32) or (ip4.get("gateway") and not ipv4_ok(ip4["gateway"])):
                    raise SysError("Check the address, prefix length and gateway")
                mods += ["ipv4.method", "manual", "ipv4.addresses", "%s/%d" % (ip4["address"], int(ip4["prefix"])), "ipv4.gateway", ip4.get("gateway") or ""]
            else:
                mods += ["ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", ""]
            reapply = True
        dns = args.get("dns")
        if dns:
            servers = [s for s in dns.get("servers") or [] if ipv4_ok(s) or re.match(r"^[0-9a-fA-F:]+$", s)]
            if dns.get("auto"):
                mods += ["ipv4.ignore-auto-dns", "no", "ipv4.dns", ""]
            else:
                if not servers:
                    raise SysError("Type at least one DNS server")
                mods += ["ipv4.ignore-auto-dns", "yes", "ipv4.dns", " ".join(servers)]
            reapply = True
        if mods:
            run(["nmcli", "connection", "modify", uuid, *mods], timeout=20)
        if reapply and uuid in run(["nmcli", "-t", "-f", "UUID", "connection", "show", "--active"], timeout=10, check=False):
            run(["nmcli", "connection", "up", uuid], timeout=45, check=False)
        return True

    def m_netConnDel(self, args):
        uuid = str(args.get("uuid", ""))
        if not re.match(r"^[0-9a-fA-F-]{8,64}$", uuid):
            raise SysError("Unknown network")
        run(["nmcli", "connection", "delete", uuid], timeout=20)
        return True

    def m_netConnUp(self, args):
        run(["nmcli", "connection", "up", str(args.get("uuid", ""))], timeout=45)
        return True

    def m_netConnDown(self, args):
        run(["nmcli", "connection", "down", str(args.get("uuid", ""))], timeout=20)
        return True

    def m_vpnImport(self, args):
        name = str(args.get("name", ""))
        conf = str(args.get("conf", ""))
        if not re.match(r"^[A-Za-z0-9_-]{1,15}$", name) or "[Interface]" not in conf or len(conf) > 20000:
            raise SysError("That isn't a WireGuard configuration")
        d = tempfile.mkdtemp(prefix="nimbus-vpn-")
        try:
            path = os.path.join(d, name + ".conf")
            with open(path, "w") as f:
                f.write(conf)
            os.chmod(path, 0o600)
            run(["nmcli", "connection", "import", "type", "wireguard", "file", path], timeout=20)
            run(["nmcli", "connection", "modify", name, "connection.autoconnect", "no"], timeout=10, check=False)
            run(["nmcli", "connection", "down", name], timeout=10, check=False)  # importing connects it
        finally:
            shutil.rmtree(d, ignore_errors=True)
        return True

    def wifi_iface(self):
        out = run(["nmcli", "-t", "-f", "DEVICE,TYPE", "device"], timeout=10, check=False)
        return next((nm_fields(x, 2)[0] for x in out.splitlines() if nm_fields(x, 2)[1] == "wifi"), None)

    def m_hotspotStatus(self, _args):
        iface = self.wifi_iface()
        supported = False
        if iface:
            phy = read("/sys/class/net/%s/phy80211/name" % iface)
            info = run(["iw", "phy", phy, "info"], timeout=5, check=False) if phy else ""
            supported = bool(re.search(r"Supported interface modes:(?:\n\s+\*.*)*\n\s+\* AP\b", info))
        active = run(["nmcli", "-t", "-f", "NAME", "connection", "show", "--active"], timeout=10, check=False).splitlines()
        props = {}
        if "Hotspot" in active:
            for dl in run(["nmcli", "-s", "-t", "-f", "802-11-wireless.ssid,802-11-wireless-security.psk,802-11-wireless.band", "connection", "show", "Hotspot"], timeout=10, check=False).splitlines():
                k, _, v = dl.partition(":")
                props[k] = v
        return {"supported": supported, "on": "Hotspot" in active, "ssid": props.get("802-11-wireless.ssid", ""), "password": props.get("802-11-wireless-security.psk", ""),
                "band": props.get("802-11-wireless.band") or "any"}

    def m_hotspot(self, args):
        iface = self.wifi_iface()
        if not args.get("on"):
            run(["nmcli", "connection", "down", "Hotspot"], timeout=20, check=False)
            if iface:
                try:
                    helper("firewall", "share", iface, "off", timeout=90)
                except SysError:
                    pass
            return self.m_hotspotStatus({})
        if not iface:
            raise SysError("This PC has no Wi-Fi adapter")
        try:  # the firewall lets devices on the hotspot get addresses and look up names
            helper("firewall", "share", iface, "on", timeout=90)
        except SysError as exc:
            print("nimbus-shell: hotspot firewall:", exc)
        ssid, pw, band = str(args.get("ssid", ""))[:32], str(args.get("password", "")), args.get("band")
        if not ssid or len(pw) < 8:
            raise SysError("The hotspot needs a name and a password of at least 8 characters")
        cmd = ["nmcli", "device", "wifi", "hotspot", "ifname", iface, "con-name", "Hotspot", "ssid", ssid, "password", pw]
        if band in ("a", "bg"):
            cmd += ["band", band]
        run(cmd, timeout=45)
        return self.m_hotspotStatus({})

    def m_netUsage(self, _args):
        out = []
        for d in sorted(glob.glob("/sys/class/net/*")):
            iface = os.path.basename(d)
            if iface == "lo" or not os.path.exists(d + "/device") and not iface.startswith(("wg", "tun")):
                continue
            wifi = os.path.isdir(d + "/wireless")
            out.append({"iface": iface, "type": "wifi" if wifi else "ethernet" if os.path.exists(d + "/device") else "vpn",
                        "name": "Wi-Fi" if wifi else "Ethernet" if os.path.exists(d + "/device") else iface,
                        "rx": int(read(d + "/statistics/rx_bytes", "0")), "tx": int(read(d + "/statistics/tx_bytes", "0"))})
        return out

    def m_netDevice(self, args):
        iface = str(args.get("iface", ""))
        if not re.match(r"^[A-Za-z0-9_.-]{1,15}$", iface):
            raise SysError("Unknown network adapter")
        if os.path.isdir("/sys/class/net/%s/wireless" % iface):
            run(["nmcli", "radio", "wifi", "on" if args.get("on") else "off"], timeout=15)
        else:
            run(["nmcli", "device", "connect" if args.get("on") else "disconnect", iface], timeout=30)
        return True

    def m_netReset(self, _args):
        out = run(["nmcli", "-t", "-f", "UUID,TYPE", "connection", "show"], timeout=10)
        for line in out.splitlines():
            uuid, typ = nm_fields(line, 2)
            if CONN_TYPES.get(typ, typ) in ("wifi", "wireguard", "vpn") or typ == "802-11-wireless":
                run(["nmcli", "connection", "delete", uuid], timeout=20, check=False)
        run(["nmcli", "networking", "off"], timeout=20, check=False)
        time.sleep(1)
        run(["nmcli", "networking", "on"], timeout=20, check=False)
        run(["nmcli", "radio", "all", "on"], timeout=20, check=False)
        return True

    def m_proxySet(self, args):
        p = {k: args.get(k) for k in ("auto", "pacOn", "pac", "manual", "host", "port", "bypass", "local")}
        if p["manual"] and (not re.match(r"^[A-Za-z0-9.:\[\]-]{1,253}$", str(p["host"] or "")) or not str(p["port"] or "").isdigit()):
            raise SysError("Type the proxy's address and port")
        if p["pacOn"] and not re.match(r"^(https?|file)://\S+$", str(p["pac"] or "")):
            raise SysError("Type the setup script's address")
        save_json(os.path.join(CONFIG_DIR, "proxy.json"), p)
        gs = lambda *a: run(["gsettings", "set", *a], timeout=5, check=False)  # noqa: E731
        if p["manual"]:
            gs("org.gnome.system.proxy", "mode", "manual")
            for scheme in ("http", "https", "ftp"):
                gs("org.gnome.system.proxy." + scheme, "host", p["host"])
                gs("org.gnome.system.proxy." + scheme, "port", str(int(p["port"])))
            ignore = [x.strip() for x in re.split(r"[;,\s]+", p["bypass"] or "") if x.strip()] + (["localhost", "127.0.0.0/8", "::1", "*.local"] if p["local"] else [])
            gs("org.gnome.system.proxy", "ignore-hosts", json.dumps(ignore).replace('"', "'"))
        elif p["pacOn"] or p["auto"]:
            gs("org.gnome.system.proxy", "mode", "auto")
            gs("org.gnome.system.proxy", "autoconfig-url", p["pac"] if p["pacOn"] else "")
        else:
            gs("org.gnome.system.proxy", "mode", "none")
        return True

    # ---------------------------------------------------------------- screenshots, clipboard
    def m_screenshot(self, args):
        fd, path = tempfile.mkstemp(prefix="nimbus-shot-", suffix=".png")
        os.close(fd)
        try:
            run(["grim", "-t", "png", path], timeout=15)
            with open(path, "rb") as f:
                data = f.read()
            if args.get("clip"):
                subprocess.Popen(["wl-copy", "--type", "image/png"], stdin=open(path, "rb"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env(), start_new_session=True)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        return {"data": "data:image/png;base64," + base64.b64encode(data).decode()}

    def m_clipWatch(self, args):
        on = bool(args.get("on"))
        if on and not self.clip_proc and shutil.which("wl-paste"):
            # wl-paste runs "echo" whenever something is copied; then the newest item is read
            self.clip_proc = subprocess.Popen(["wl-paste", "--watch", "echo", "x"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env())
            threading.Thread(target=self.follow_clipboard, args=(self.clip_proc,), daemon=True).start()
        elif not on and self.clip_proc:
            self.clip_proc.terminate()
            self.clip_proc = None
        return on

    def follow_clipboard(self, proc):
        for _line in proc.stdout:
            try:
                types = run(["wl-paste", "--list-types"], timeout=5, check=False).split()
                if "image/png" in types:
                    data = subprocess.run(["wl-paste", "--type", "image/png"], capture_output=True, timeout=10, env=env()).stdout
                    if 0 < len(data) <= 3 * 1024 * 1024:
                        item = {"image": "data:image/png;base64," + base64.b64encode(data).decode()}
                    else:
                        continue
                elif any(t.startswith("text/") or t in ("UTF8_STRING", "STRING", "TEXT") for t in types):
                    text = run(["wl-paste", "--no-newline", "--type", "text/plain;charset=utf-8" if "text/plain;charset=utf-8" in types else "text"], timeout=5, check=False)
                    if not text.strip():
                        continue
                    item = {"text": text[:20000]}
                else:
                    continue
                GLib.idle_add(lambda i=item: self.emit("clipboard", i) and False)
            except Exception as exc:
                print("nimbus-shell: clipboard:", exc)

    def m_clipboardSet(self, args):
        if args.get("image"):
            m = re.match(r"^data:image/png;base64,(.+)$", str(args["image"]))
            if not m:
                raise SysError("Only pictures in PNG can be copied")
            data = base64.b64decode(m.group(1))
            p = subprocess.Popen(["wl-copy", "--type", "image/png"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env(), start_new_session=True)
        else:
            data = str(args.get("text", "")).encode()
            p = subprocess.Popen(["wl-copy"] if data else ["wl-copy", "--clear"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env(), start_new_session=True)
        p.stdin.write(data)
        p.stdin.close()
        return True

    # ---------------------------------------------------------------- files the page hands over
    def m_saveBackup(self, args):
        name = re.sub(r"[^\w .()-]+", "_", os.path.basename(str(args.get("name") or "Nimbus backup.json")))
        if not name.endswith(".json"):
            name += ".json"
        d = os.path.expanduser("~/Nimbus backups")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, name)
        with open(path, "w") as f:
            f.write(str(args.get("data", "")))
        return {"path": path}
