#!/usr/bin/env python3
"""Tests for the safety rules of os/overlay/usr/lib/nimbus/nimbus-storage (no real disks touched).
usage: python3 os/test-storage.py
"""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile

here = os.path.dirname(os.path.abspath(__file__))
loader = importlib.machinery.SourceFileLoader("nimbus_storage", os.path.join(here, "overlay/usr/lib/nimbus/nimbus-storage"))
spec = importlib.util.spec_from_loader("nimbus_storage", loader)
st = importlib.util.module_from_spec(spec)
loader.exec_module(st)

failures = []
GiB, MiB = 1 << 30, 1 << 20


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  " + str(detail)))
    if not cond:
        failures.append(name)


def image(size=4 * MiB, fill=None):
    """A file standing in for a disk: zeros, or filled with a byte."""
    f = tempfile.NamedTemporaryFile(delete=False)
    f.write(fill * size if fill else bytes(size))
    f.close()
    return f.name


real_run = st.run


def fake_run(answers):
    def run(*args, check=True, input=None):
        key = " ".join(args)
        for prefix, out in answers.items():
            if key.startswith(prefix):
                return out
        raise AssertionError("unexpected command: " + key)
    return run


# ---- empty disks ----
zero = image(size=2 * MiB)
st.run = fake_run({"wipefs": ""})
check("an all-zero disk without signatures is empty", st.is_empty({"path": zero, "name": "sdc"}))
check("a disk with a partition table is not empty", not st.is_empty({"path": zero, "name": "sdc", "pttype": "gpt"}))
check("a disk with partitions is not empty", not st.is_empty({"path": zero, "name": "sdc", "children": [{"name": "sdc1"}]}))
check("a disk with a file system is not empty", not st.is_empty({"path": zero, "name": "sdc", "fstype": "ntfs"}))
st.run = fake_run({"wipefs": "0x0 ext4 [filesystem]"})
check("a disk where wipefs finds a signature is not empty", not st.is_empty({"path": zero, "name": "sdc"}))
st.run = fake_run({"wipefs": ""})
data = image(size=2 * MiB, fill=b"\x01")
check("a disk with data at the start is not empty, signature or not", not st.is_empty({"path": data, "name": "sdc"}))

# ---- what gets offered ----
iso = image(size=MiB, fill=b"\x02")
devs = [
    {"name": "sda", "path": "/dev/sda", "type": "disk", "size": 500 * GiB, "ro": False, "model": "Windows SSD",
     "pttype": "gpt", "children": [{"name": "sda1", "path": "/dev/sda1", "type": "part", "fstype": "ntfs", "mountpoints": [None]}]},
    {"name": "sdb", "path": iso, "type": "disk", "size": 16 * GiB, "ro": False, "rm": True, "tran": "usb", "vendor": "SanDisk", "model": "Ultra",
     "pttype": "dos", "children": [{"name": "sdb1", "path": "/dev/sdb1", "type": "part", "fstype": "iso9660", "mountpoints": ["/cdrom"]}]},
    {"name": "sdc", "path": zero, "type": "disk", "size": 8 * GiB, "ro": False, "model": "VBOX HARDDISK", "mountpoints": [None]},
    {"name": "sr0", "path": "/dev/sr0", "type": "rom", "size": GiB, "ro": True},
]
st.run = fake_run({"wipefs": ""})
offers = st.candidates(devs)
ids = [c["id"] for c in offers]
check("offers only the empty disk: never the Windows disk or the Nimbus stick", ids == ["empty:sdc"], ids)
check("describes the disk for the confirmation", offers[0]["disk"] == {"name": "VBOX HARDDISK", "kind": "disk", "size": 8 * GiB}, offers[0]["disk"])
small = dict(devs[2], size=GiB // 2)
check("a disk under 1 GiB isn't offered", st.candidates([small]) == [], st.candidates([small]))

devs[2]["children"] = [{"name": "sdc1", "path": "/dev/sdc1", "type": "part", "label": st.LABEL, "mountpoints": ["/cow"]}]
# Mounted out of sight (as casper does): only /proc/fs/ext4 knows, and the root reports the size
hidden = [dict(devs[0]), dict(devs[1]), dict(devs[2], children=[{"name": "sdc1", "path": "/dev/sdc1", "type": "part", "label": st.LABEL, "mountpoints": [None]}])]
real_isdir, real_cmdline = os.path.isdir, st.booted_persistent
os.path.isdir = lambda p: p == "/proc/fs/ext4/sdc1" or real_isdir(p)
st.booted_persistent = lambda: True
cur = st.current(hidden)
check("a storage area casper mounted out of sight counts as in use", cur and cur["active"] and cur["size"] > 0, cur)
st.booted_persistent = lambda: False
cur = st.current(hidden)
check("...but not when started without 'persistent' (then casper only keeps logs there)", cur and not cur["active"], cur)
os.path.isdir, st.booted_persistent = real_isdir, real_cmdline

real_statvfs = os.statvfs
os.statvfs = lambda p: real_statvfs("/")
st.booted_persistent = lambda: True
cur = st.current(devs)
check("finds a storage area that's in use", cur and cur["device"] == "/dev/sdc1" and cur["active"], cur)
check("offers nothing more once one exists", st.candidates(devs) == [], st.candidates(devs))
os.statvfs = real_statvfs
st.booted_persistent = lambda: False
cur = st.current(devs)
check("a storage area whose mount can't be read still counts", cur and cur["size"] == 0 and cur["free"] is None, cur)
st.booted_persistent = real_cmdline

st.run = real_run
for path in (iso, zero, data):
    os.unlink(path)
print()
print("All storage tests passed" if not failures else "%d failed: %s" % (len(failures), ", ".join(failures)))
sys.exit(1 if failures else 0)
