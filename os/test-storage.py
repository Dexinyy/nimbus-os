#!/usr/bin/env python3
"""Tests for the safety rules of os/overlay/usr/lib/nimbus/nimbus-storage (no real disks touched).
usage: python3 os/test-storage.py
"""
import importlib.machinery
import importlib.util
import json
import os
import struct
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


def image(iso_blocks, size=4 * MiB, fill=None):
    """A file with an ISO 9660 primary volume descriptor saying the image is iso_blocks * 2048 bytes."""
    f = tempfile.NamedTemporaryFile(delete=False)
    data = bytearray(fill * size if fill else size)
    if iso_blocks:
        pvd = bytearray(2048)
        pvd[0] = 1
        pvd[1:6] = b"CD001"
        struct.pack_into("<I", pvd, 80, iso_blocks)
        struct.pack_into("<H", pvd, 128, 2048)
        data[16 * 2048:17 * 2048] = pvd
    f.write(data)
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


# ---- the image's own size ----
iso = image(1000)
check("reads the image size from the ISO header", st.iso_size(iso) == 1000 * 2048, st.iso_size(iso))
blank = image(0)
check("no ISO header means size 0", st.iso_size(blank) == 0)

# ---- free space after the image ----
def table(label, parts, sector=512):
    return json.dumps({"partitiontable": {"label": label, "sectorsize": sector,
                                          "partitions": [{"node": "x%d" % i, "start": s, "size": n} for i, (s, n) in enumerate(parts, 1)]}})


st.run = fake_run({"sfdisk --json": table("dos", [(0, 4000), (4000, 2000)])})
free = st.free_after_image({"path": iso, "size": 8 * GiB, "name": "sdb"})
check("free space starts after the last partition, on a MiB boundary", free["start"] == 3 * MiB and free["size"] == 8 * GiB - 3 * MiB, free)

st.run = fake_run({"sfdisk --json": table("dos", [(0, 1000)])})
free = st.free_after_image({"path": iso, "size": 8 * GiB, "name": "sdb"})
check("never inside the image, even if no partition covers all of it", free["start"] >= 1000 * 2048 and free["start"] == 2 * MiB, free)

st.run = fake_run({"sfdisk --json": table("gpt", [(64, 4000)])})
free = st.free_after_image({"path": iso, "size": 8 * GiB, "name": "sdb"})
check("GPT: room is left at the end for the backup table", free["start"] + free["size"] == 8 * GiB - MiB, free)

st.run = fake_run({"sfdisk --json": ""})
free = st.free_after_image({"path": iso, "size": 8 * GiB, "name": "sdb"})
check("no partition table: still stays clear of the image", free["start"] == 2 * MiB, free)

# ---- empty disks ----
zero = image(0, size=2 * MiB)
st.run = fake_run({"wipefs": ""})
check("an all-zero disk without signatures is empty", st.is_empty({"path": zero, "name": "sdc"}))
check("a disk with a partition table is not empty", not st.is_empty({"path": zero, "name": "sdc", "pttype": "gpt"}))
check("a disk with partitions is not empty", not st.is_empty({"path": zero, "name": "sdc", "children": [{"name": "sdc1"}]}))
check("a disk with a file system is not empty", not st.is_empty({"path": zero, "name": "sdc", "fstype": "ntfs"}))
st.run = fake_run({"wipefs": "0x0 ext4 [filesystem]"})
check("a disk where wipefs finds a signature is not empty", not st.is_empty({"path": zero, "name": "sdc"}))
st.run = fake_run({"wipefs": ""})
data = image(0, size=2 * MiB, fill=b"\x01")
check("a disk with data at the start is not empty, signature or not", not st.is_empty({"path": data, "name": "sdc"}))

# ---- what gets offered ----
devs = [
    {"name": "sda", "path": "/dev/sda", "type": "disk", "size": 500 * GiB, "ro": False, "model": "Windows SSD",
     "pttype": "gpt", "children": [{"name": "sda1", "path": "/dev/sda1", "type": "part", "fstype": "ntfs", "mountpoints": [None]}]},
    {"name": "sdb", "path": iso, "type": "disk", "size": 16 * GiB, "ro": False, "rm": True, "tran": "usb", "vendor": "SanDisk", "model": "Ultra",
     "pttype": "dos", "children": [{"name": "sdb1", "path": "/dev/sdb1", "type": "part", "fstype": "iso9660", "mountpoints": ["/cdrom"]}]},
    {"name": "sdc", "path": zero, "type": "disk", "size": 8 * GiB, "ro": False, "model": "VBOX HARDDISK", "mountpoints": [None]},
    {"name": "sr0", "path": "/dev/sr0", "type": "rom", "size": GiB, "ro": True},
]
st.run = fake_run({"sfdisk --json": table("dos", [(0, 4000)]), "wipefs": "", "findmnt": "/dev/sdb1\n"})
offers = st.candidates(devs)
ids = [c["id"] for c in offers]
check("offers the boot stick's free space and the empty disk, never the Windows disk", ids == ["free:sdb", "empty:sdc"], ids)
check("describes the stick for the confirmation", offers[0]["disk"] == {"name": "SanDisk Ultra", "kind": "USB stick", "size": 16 * GiB}, offers[0]["disk"])

devs[2]["children"] = [{"name": "sdc1", "path": "/dev/sdc1", "type": "part", "label": st.LABEL, "mountpoints": ["/cow"]}]
real_statvfs = os.statvfs
os.statvfs = lambda p: real_statvfs("/")
cur = st.current(devs)
check("finds a storage area that's in use", cur and cur["device"] == "/dev/sdc1" and cur["active"], cur)
check("offers nothing more once one exists", st.candidates(devs) == [], st.candidates(devs))
os.statvfs = real_statvfs
cur = st.current(devs)
check("a storage area whose mount can't be read still counts", cur and cur["size"] == 0 and cur["free"] is None, cur)

st.run = real_run
for path in (iso, blank, zero, data):
    os.unlink(path)
print()
print("All storage tests passed" if not failures else "%d failed: %s" % (len(failures), ", ".join(failures)))
sys.exit(1 if failures else 0)
