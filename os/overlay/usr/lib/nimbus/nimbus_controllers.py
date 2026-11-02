"""Game controllers for Settings > Bluetooth & devices > Game controllers: which are connected (PlayStation
DualSense, DualShock 4 and 3, Xbox, Switch Pro and Joy-Cons, Steam, 8BitDo and other gamepads, over USB or Bluetooth),
their batteries, a live test of buttons and sticks, and rumble.

The kernel drives them (hid-playstation, hid-sony, xpad, hid-microsoft, hid-nintendo, hid-steam...); udev lets the
signed-in user open them (70-uaccess for event devices, /usr/lib/udev/rules.d/70-nimbus-controllers.rules for hidraw
and uinput, which Steam Input needs), so this reads /dev/input/event* directly, without root."""
import fcntl
import glob
import os
import re
import select
import struct
import threading
import time

from gi.repository import GLib

EV_SYN, EV_KEY, EV_ABS, EV_FF = 0x00, 0x01, 0x03, 0x15
BUTTONS = {  # code -> generic name (the page labels them per controller family)
    0x130: "south", 0x131: "east", 0x133: "north", 0x134: "west", 0x136: "lb", 0x137: "rb", 0x138: "lt", 0x139: "rt",
    0x13a: "select", 0x13b: "start", 0x13c: "home", 0x13d: "ls", 0x13e: "rs",
    0x220: "up", 0x221: "down", 0x222: "left", 0x223: "right", 0x2c0: "touchpad",
}
AXES = {0x00: "lx", 0x01: "ly", 0x03: "rx", 0x04: "ry", 0x02: "lt", 0x05: "rt", 0x10: "hatx", 0x11: "haty"}
FAMILIES = [  # (vendor, product or None, family, model)
    ("054c", "0ce6", "playstation", "DualSense"), ("054c", "0df2", "playstation", "DualSense Edge"),
    ("054c", "05c4", "playstation", "DualShock 4"), ("054c", "09cc", "playstation", "DualShock 4"),
    ("054c", "0ba0", "playstation", "DualShock 4 USB adapter"), ("054c", "0268", "playstation", "DualShock 3"),
    ("054c", None, "playstation", "PlayStation controller"),
    ("045e", None, "xbox", "Xbox controller"), ("057e", "2009", "nintendo", "Switch Pro Controller"),
    ("057e", "2006", "nintendo", "Joy-Con (L)"), ("057e", "2007", "nintendo", "Joy-Con (R)"), ("057e", None, "nintendo", "Nintendo controller"),
    ("28de", None, "steam", "Steam Controller"), ("2dc8", None, "xbox", "8BitDo controller"),
    ("0e6f", None, "xbox", "PDP controller"), ("0f0d", None, "xbox", "Hori controller"), ("20d6", None, "xbox", "PowerA controller"),
    ("146b", None, "playstation", "Nacon controller"), ("0738", None, "xbox", "Mad Catz controller"), ("046d", None, "xbox", "Logitech gamepad"),
]
INPUT_EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit: time (2 longs), type, code, value


def _read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def _udev_props(event):
    """udev's properties of an input event device (from its database), like ID_INPUT_JOYSTICK"""
    dev = _read("/sys/class/input/%s/dev" % event)
    props = {}
    for line in _read("/run/udev/data/c%s" % dev).splitlines():
        if line.startswith("E:") and "=" in line:
            k, v = line[2:].split("=", 1)
            props[k] = v
    return props


def _battery(event):
    """A controller's battery: the kernel attaches it to the controller's HID device, a few levels up."""
    path = os.path.realpath("/sys/class/input/%s/device" % event)
    for _ in range(4):
        for cap in glob.glob(os.path.join(path, "power_supply", "*", "capacity")):
            status = _read(os.path.join(os.path.dirname(cap), "status"))
            level = _read(cap)
            if level.isdigit():
                return {"level": int(level), "charging": status in ("Charging", "Full")}
        for lvl in glob.glob(os.path.join(path, "power_supply", "*", "capacity_level")):
            return {"level": {"Full": 100, "High": 80, "Normal": 55, "Low": 20, "Critical": 5}.get(_read(lvl), None), "charging": False}
        path = os.path.dirname(path)
        if path in ("/", "/sys", "/sys/devices"):
            break
    return None


def family(vendor, product):
    for v, p, fam, model in FAMILIES:
        if v == vendor and (p is None or p == product):
            return fam, model
    return "generic", "Game controller"


def controllers():
    out = []
    for path in sorted(glob.glob("/sys/class/input/event*"), key=lambda p: int(re.sub(r"\D", "", p) or 0)):
        event = os.path.basename(path)
        props = _udev_props(event)
        if props.get("ID_INPUT_JOYSTICK") != "1":
            continue
        name = _read(path + "/device/name") or "Game controller"
        if re.search(r"(Motion Sensors|Touchpad|IMU)$", name):
            continue  # a DualSense's or Joy-Con's other parts
        vendor, product = _read(path + "/device/id/vendor").lower(), _read(path + "/device/id/product").lower()
        bus = _read(path + "/device/id/bustype").lower()
        fam, model = family(vendor, product)
        out.append({"id": event, "name": name, "model": model, "family": fam, "vendor": vendor, "product": product,
                    "connection": {"0003": "USB", "0005": "Bluetooth", "0006": "Virtual"}.get(bus, "Wired"),
                    "battery": _battery(event), "rumble": any(int(w, 16) for w in _read(path + "/device/capabilities/ff", "0").split()),
                    "uniq": _read(path + "/device/uniq")})
    return out


def _bits(text):
    """A capabilities bitmap from sysfs ('ff 0 ...', most significant word first) as a set of bit numbers."""
    words = text.split()
    out = set()
    for i, w in enumerate(reversed(words)):
        n = int(w, 16)
        bit = 0
        while n:
            if n & 1:
                out.add(i * 64 + bit)
            n >>= 1
            bit += 1
    return out


def _absinfo(fd, code):
    buf = bytearray(24)
    try:
        fcntl.ioctl(fd, 0x80184540 + code, buf)  # EVIOCGABS(code): value, min, max, fuzz, flat, resolution
    except OSError:
        return None
    return struct.unpack("6i", bytes(buf))


class Watcher:
    """Follows one controller's buttons and sticks, calling report(state) about 30 times a second while they move."""

    def __init__(self, event, report):
        self.event, self.report = event, report
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        path = "/dev/input/" + self.event
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as exc:
            self.report({"error": "Can't read the controller: %s" % (exc.strerror or exc)})
            return
        try:
            keys = _bits(_read("/sys/class/input/%s/device/capabilities/key" % self.event, "0"))
            absb = _bits(_read("/sys/class/input/%s/device/capabilities/abs" % self.event, "0"))
            ranges = {}
            state = {"buttons": {name: False for code, name in BUTTONS.items() if code in keys}, "axes": {}}
            for code, name in AXES.items():
                if code in absb:
                    info = _absinfo(fd, code)
                    if info:
                        ranges[code] = info
                        state["axes"][name] = self.norm(code, info[0], info)
            self.report(dict(state, ready=True))
            last = 0
            dirty = False
            while not self.stop.is_set():
                r, _w, _x = select.select([fd], [], [], 0.25)
                if r:
                    try:
                        data = os.read(fd, INPUT_EVENT.size * 64)
                    except BlockingIOError:
                        continue
                    except OSError:
                        self.report({"gone": True})
                        return
                    for i in range(0, len(data) - INPUT_EVENT.size + 1, INPUT_EVENT.size):
                        _s, _us, typ, code, value = INPUT_EVENT.unpack_from(data, i)
                        if typ == EV_KEY and code in BUTTONS:
                            state["buttons"][BUTTONS[code]] = bool(value)
                            dirty = True
                        elif typ == EV_ABS and code in AXES and code in ranges:
                            state["axes"][AXES[code]] = self.norm(code, value, ranges[code])
                            dirty = True
                now = time.time()
                if dirty and now - last > 0.033:
                    self.report(state)
                    last, dirty = now, False
        finally:
            os.close(fd)

    @staticmethod
    def norm(code, value, info):
        lo, hi = info[1], info[2]
        if hi <= lo:
            return 0
        if code in (0x02, 0x05):  # triggers: 0..1
            return round((value - lo) / (hi - lo), 3)
        if code in (0x10, 0x11):  # the d-pad as a hat: -1, 0, 1
            return max(-1, min(1, value))
        return round(2 * (value - lo) / (hi - lo) - 1, 3)  # sticks: -1..1


def rumble(event, strong=0.8, weak=0.6, ms=600):
    """Make a controller vibrate (force feedback: one rumble effect, uploaded and played)."""
    fd = os.open("/dev/input/" + event, os.O_RDWR)
    try:
        effect = bytearray(48)  # struct ff_effect on 64-bit
        struct.pack_into("HhHHHHH", effect, 0, 0x50, -1, 0, 0, 0, ms, 0)  # FF_RUMBLE, id -1 (new), direction, trigger, replay
        struct.pack_into("HH", effect, 16, int(strong * 0xFFFF), int(weak * 0xFFFF))
        fcntl.ioctl(fd, 0x40304580, effect)  # EVIOCSFF
        eid = struct.unpack_from("h", effect, 2)[0]
        os.write(fd, INPUT_EVENT.pack(0, 0, EV_FF, eid, 1))
        time.sleep(ms / 1000 + 0.05)
        try:
            fcntl.ioctl(fd, 0x40044581, eid)  # EVIOCRMFF
        except OSError:
            pass
    finally:
        os.close(fd)


class TestPad:
    """A virtual DualSense (uinput), for boot tests: it shows up like a real one and presses a button."""
    UI_SET_EVBIT, UI_SET_KEYBIT, UI_SET_ABSBIT, UI_DEV_CREATE, UI_DEV_DESTROY = 0x40045564, 0x40045565, 0x40045567, 0x5501, 0x5502

    def __init__(self):
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, self.UI_SET_EVBIT, EV_KEY)
        for code in (0x130, 0x131, 0x133, 0x134, 0x136, 0x137, 0x138, 0x139, 0x13a, 0x13b, 0x13c, 0x13d, 0x13e):
            fcntl.ioctl(self.fd, self.UI_SET_KEYBIT, code)
        fcntl.ioctl(self.fd, self.UI_SET_EVBIT, EV_ABS)
        absmax, absmin = [0] * 64, [0] * 64
        for code in (0x00, 0x01, 0x02, 0x03, 0x04, 0x05):
            fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, code)
            absmin[code], absmax[code] = 0, 255
        for code in (0x10, 0x11):
            fcntl.ioctl(self.fd, self.UI_SET_ABSBIT, code)
            absmin[code], absmax[code] = -1, 1
        name = b"Nimbus Test DualSense".ljust(80, b"\0")
        dev = name + struct.pack("HHHHI", 0x03, 0x054C, 0x0CE6, 0x0100, 0) + struct.pack("64i", *absmax) + struct.pack("64i", *absmin) + struct.pack("64i", *([0] * 64)) * 2
        os.write(self.fd, dev)
        fcntl.ioctl(self.fd, self.UI_DEV_CREATE)

    def emit(self, typ, code, value):
        os.write(self.fd, INPUT_EVENT.pack(0, 0, typ, code, value))
        os.write(self.fd, INPUT_EVENT.pack(0, 0, EV_SYN, 0, 0))

    def close(self):
        try:
            fcntl.ioctl(self.fd, self.UI_DEV_DESTROY)
        finally:
            os.close(self.fd)


class ControllerMethods:
    """Mixed into nimbus-shell's Shell."""

    def m_controllers(self, _args):
        return controllers()

    def m_controllerWatch(self, args):
        """Start (on) or stop following a controller; its state arrives as 'native:controller-input' events."""
        old = getattr(self, "pad_watch", None)
        if old:
            old.stop.set()
            self.pad_watch = None
        event = str(args.get("id") or "")
        if args.get("on") and re.match(r"^event\d{1,4}$", event):
            self.pad_watch = Watcher(event, lambda st: GLib.idle_add(lambda s=dict(st, id=event): self.emit("controller-input", s) and False))
        return True

    def m_controllerRumble(self, args):
        event = str(args.get("id") or "")
        if not re.match(r"^event\d{1,4}$", event):
            raise ValueError("Unknown controller")
        try:
            rumble(event)
        except OSError as exc:
            raise RuntimeError("This controller can't vibrate here (%s)" % (exc.strerror or exc))
        return True

    def m_controllerTest(self, args):
        """Boot tests only: plug in a virtual DualSense, press Cross, then unplug it."""
        if "nimbus.test=" not in _read("/proc/cmdline") and not os.environ.get("NIMBUS_TEST"):
            raise RuntimeError("Only for tests")
        action = args.get("action")
        if action == "plug":
            self.test_pad = TestPad()
            return True
        pad = getattr(self, "test_pad", None)
        if not pad:
            raise RuntimeError("No test controller")
        if action == "press":
            pad.emit(EV_KEY, 0x130, 1)
            pad.emit(EV_ABS, 0x00, 255)
            time.sleep(0.4)
            pad.emit(EV_KEY, 0x130, 0)
            pad.emit(EV_ABS, 0x00, 128)
        elif action == "unplug":
            pad.close()
            self.test_pad = None
        return True
