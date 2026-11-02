#!/usr/bin/env python3
"""Tests for Nimbus Update's helper (os/overlay/usr/lib/nimbus/nimbus-update) and the package maker
(os/update-bundle.py). They run on a made-up system in a temporary folder, so nothing real is touched.
usage: python3 os/test-update.py
"""
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile

here = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, os.path.join(here, path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


nu = load("nimbus_update_helper", "overlay/usr/lib/nimbus/nimbus-update")
ub = load("update_bundle", "update-bundle.py")

failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  " + str(detail)))
    if not cond:
        failures.append(name)


def sha(data):
    return hashlib.sha256(data).hexdigest()


tmp = tempfile.mkdtemp(prefix="nimbus-update-test-")
ROOT, SERVER = os.path.join(tmp, "root"), os.path.join(tmp, "server")
MARKER = os.path.join(tmp, "migration-ran")

# The made-up system: version 1 as an ISO would leave it
V1 = {
    "usr/bin/nimbus-shell": (b"#!/usr/bin/python3\nprint('shell 1')\n", 0o755),
    "usr/lib/nimbus/nimbus_sys.py": (b"VERSION = 1\n", 0o644),
    "usr/lib/nimbus/nimbus-update": (b"#!/usr/bin/python3 -I\nprint('helper 1')\n", 0o755),
    "usr/lib/nimbus/old-tool": (b"#!/bin/sh\necho old\n", 0o755),
    "usr/share/nimbus/shell/index.html": (b"<html>1</html>", 0o644),
    "etc/sudoers.d/nimbus-sys": (b"nimbus ALL=(root) NOPASSWD: /usr/lib/nimbus/nimbus-sys\n", 0o440),
    "etc/systemd/system/nimbus-session.service": (b"[Service]\nExecStart=/usr/bin/nimbus-session\n", 0o644),
    "etc/default/locale": (b"LANG=en_US.UTF-8\n", 0o644),
    "etc/xdg/mimeapps.list": (b"[Default Applications]\n", 0o644),
}
# Version 2: two files change, one is new, one goes, one only changes its permissions
V2 = dict(V1)
V2.update({
    "usr/bin/nimbus-shell": (b"#!/usr/bin/python3\nprint('shell 2')\n", 0o755),
    "usr/share/nimbus/shell/index.html": (b"<html>2</html>", 0o644),
    "usr/lib/nimbus/nimbus_store.py": (b"STORE = True\n", 0o644),
    "usr/lib/nimbus/nimbus-update": (b"#!/usr/bin/python3 -I\nprint('helper 2')\n", 0o755),
    "usr/lib/nimbus/nimbus_sys.py": (b"VERSION = 1\n", 0o600),
    "etc/default/locale": (b"LANG=en_US.UTF-8\nLC_TIME=en_US.UTF-8\n", 0o644),
    "etc/xdg/mimeapps.list": (b"[Default Applications]\ntext/html=nimbus-web.desktop\n", 0o644),
})
del V2["usr/lib/nimbus/old-tool"]


def manifest_for(files, commit, date, **extra):
    m = {"format": 1, "name": "Nimbus OS 0.1", "version": "0.1", "commit": commit, "date": date, "suite": nu.suite() or "noble",
         "base": 1, "files": {p: {"sha256": sha(d), "size": len(d), "mode": mode} for p, (d, mode) in files.items()},
         "packages": [], "migrations": [], "notes": []}
    m.update(extra)
    return m


def publish(files, commit, date, migrations=None, mutate=None, **extra):
    """Write version files as the release would publish it (into SERVER)."""
    migrations = migrations or {}
    m = manifest_for(files, commit, date, migrations=[{"name": n, "sha256": sha(d)} for n, d in sorted(migrations.items())], **extra)
    shutil.rmtree(SERVER, ignore_errors=True)
    os.makedirs(SERVER)
    ub.write_bundle(os.path.join(SERVER, "nimbus-os-update-%s.tar.xz" % commit[:7]), m, lambda p: files[p][0], lambda n: migrations[n])
    if mutate:
        mutate(m)
    with open(os.path.join(SERVER, nu.MANIFEST), "w") as f:
        json.dump(m, f)
    return m


def install_v1():
    shutil.rmtree(ROOT, ignore_errors=True)
    for path, (data, mode) in V1.items():
        full = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(data)
        os.chmod(full, mode)
    m = manifest_for(V1, "a" * 40, 1000)
    os.makedirs(os.path.join(ROOT, "usr/share/nimbus"), exist_ok=True)
    with open(os.path.join(ROOT, nu.FILES_REL), "w") as f:
        json.dump({"commit": m["commit"], "files": m["files"]}, f)
    with open(os.path.join(ROOT, nu.BUILD_REL), "w") as f:
        json.dump({"version": "0.1", "commit": "a" * 40, "date": 1000, "base": 1}, f)
    state = os.path.join(ROOT, "var/lib/nimbus/update")
    shutil.rmtree(state, ignore_errors=True)
    os.makedirs(state)
    with open(os.path.join(state, "migrations.done"), "w") as f:
        f.write("0001-first\n")
    if os.path.exists(MARKER):
        os.unlink(MARKER)


def read_root(path):
    try:
        with open(os.path.join(ROOT, path), "rb") as f:
            return f.read()
    except OSError:
        return None


def mode_of(path):
    return os.stat(os.path.join(ROOT, path)).st_mode & 0o777


def matches(files):
    return [p for p, (d, mode) in files.items() if read_root(p) != d or mode_of(p) != mode]


# Point the helper at the made-up system
state_dir = os.path.join(ROOT, "var/lib/nimbus/update")
nu.ROOT = ROOT
nu.STATE_DIR = state_dir
nu.STATE = os.path.join(state_dir, "state.json")
nu.DONE = os.path.join(state_dir, "migrations.done")
nu.STAGED = os.path.join(state_dir, "staged")
nu.BACKUP = os.path.join(state_dir, "backup")
nu.DOWNLOADS = os.path.join(state_dir, "download")
nu.LOCK = os.path.join(tmp, "lock")
nu.source = lambda: ("file://" + SERVER + "/", True)
nu.own = lambda path: None  # files here belong to whoever runs the test
nu.need_root = lambda: None
nu.os.sync = lambda: None
SAVING = {"on": True}
nu.saving = lambda: SAVING["on"]
PKG = {"have": set(), "installed": []}
nu.missing_packages = lambda names: [n for n in names if n not in PKG["have"]]


def fake_apt(names):
    PKG["installed"].extend(names)
    PKG["have"].update(names)


nu.install_packages = fake_apt
TRIG = []
nu.triggers = lambda paths, now=True: TRIG.append(sorted(paths)) or []


def run(cmd):
    """Run a helper command; return its JSON lines (the last is the result)."""
    out = io.StringIO()
    nu.CANCEL.update(asked=False, allowed=True)
    nu.OUT.update(closed=False, t=0.0, phase=None)
    with contextlib.redirect_stdout(out):
        try:
            cmd()
        except nu.Failure as exc:
            nu.say(ok=False, error=str(exc))
        except nu.Cancelled:
            nu.say(ok=False, cancelled=True)
        nu.release()  # as the real program does when it ends (a power cut, SystemExit here, skips this)
    return [json.loads(l) for l in out.getvalue().splitlines() if l.strip()]


def state():
    return nu.load_json(nu.STATE, {}) or {}


migration = ("#!/bin/sh\necho ran >> %s\n" % MARKER).encode()

# ---- a normal update ----
install_v1()
m2 = publish(V2, "b" * 40, 2000, migrations={"0001-first": b"#!/bin/sh\nexit 1\n", "0002-second": migration}, packages=["hello"],
             notes=[{"commit": "bbbbbbb", "date": 2000, "subject": "Second"}, {"commit": "aaaaaaa", "date": 1000, "subject": "First"}])
# Someone changed this one by hand: it stays
with open(os.path.join(ROOT, "etc/default/locale"), "w") as f:
    f.write("LANG=de_DE.UTF-8\n")
lines = run(nu.cmd_check)
c = lines[-1]
check("check finds the newer version", c.get("available") and c["available"]["commit"] == "bbbbbbb", c)
check("check says it installs in place", c.get("inplace") is True and c.get("why") == "", c)
check("check counts the packages it needs", c["available"]["packages"] == 1, c["available"])
check("check lists only what's new", [n["subject"] for n in c["available"]["notes"]] == ["Second"], c["available"]["notes"])
ORDER = []
plain_install_file = nu.install_file
nu.install_file = lambda src, path, mode: ORDER.append(path) or plain_install_file(src, path, mode)
lines = run(nu.cmd_install)
nu.install_file = plain_install_file
res = lines[-1]
check("install succeeds", res.get("ok") is True, lines[-3:])
check("the helper replaces itself first (it finishes the job after a power cut)", ORDER[:1] == ["usr/lib/nimbus/nimbus-update"], ORDER)
phases = [l.get("phase") for l in lines if "phase" in l]
check("install reports downloading, then installing", "download" in phases and "install" in phases and phases.index("download") < phases.index("install"), phases)
check("every new file is in place", not matches({p: v for p, v in V2.items() if p != "etc/default/locale"}),
      matches({p: v for p, v in V2.items() if p != "etc/default/locale"}))
check("a removed file is gone", read_root("usr/lib/nimbus/old-tool") is None)
check("a settings file changed by hand stays", read_root("etc/default/locale") == b"LANG=de_DE.UTF-8\n", read_root("etc/default/locale"))
check("...and is reported", "etc/default/locale" in res.get("kept", []), res.get("kept"))
check("an unchanged /etc file Nimbus owns is updated", read_root("etc/xdg/mimeapps.list") == V2["etc/xdg/mimeapps.list"][0])
check("permissions follow the new version", mode_of("usr/lib/nimbus/nimbus_sys.py") == 0o600)
info = nu.load_json(os.path.join(ROOT, nu.BUILD_REL))
check("build-info names the new version", info["commit"] == "b" * 40 and info["date"] == 2000, info)
check("build-info keeps the ISO's base and records the ISO", info["base"] == 1 and info["iso"]["commit"] == "a" * 40, info)
check("files.json lists the new files", nu.load_json(os.path.join(ROOT, nu.FILES_REL))["files"] == m2["files"])
check("the missing package is installed", PKG["installed"] == ["hello"], PKG)
check("only new migrations run", open(MARKER).read() == "ran\n" if os.path.exists(MARKER) else False)
check("...and are remembered", open(nu.DONE).read().split() == ["0001-first", "0002-second"], open(nu.DONE).read())
st = state()
check("the journal asks for a restart", st.get("state") == "restart" and st.get("boot") == nu.boot_id(), st)
check("nothing is left in the staging folder", not os.path.exists(nu.STAGED))
s = run(nu.cmd_status)[-1]
check("status shows the restart waiting", s["pending"] and s["pending"]["commit"] == "b" * 40, s)
check("status offers going back", s["back"] and s["back"]["commit"] == "aaaaaaa", s)
c = run(nu.cmd_check)[-1]
check("after installing, check finds nothing newer", c.get("available") is None, c)
check("the files that changed are rebuilt from (schemas, fonts...)", TRIG and "usr/bin/nimbus-shell" in TRIG[0], TRIG)

# ---- going back ----
lines = run(nu.cmd_back)
check("going back succeeds", lines[-1].get("ok") is True and lines[-1].get("commit") == "aaaaaaa", lines[-1])
v1_expect = {p: v for p, v in V1.items() if p != "etc/default/locale"}
check("going back restores every file", not matches(v1_expect), matches(v1_expect))
check("...the removed one too", read_root("usr/lib/nimbus/old-tool") == V1["usr/lib/nimbus/old-tool"][0])
check("...and removes the added one", read_root("usr/lib/nimbus/nimbus_store.py") is None)
check("...and keeps the hand-made change", read_root("etc/default/locale") == b"LANG=de_DE.UTF-8\n")
check("build-info is the old version again", nu.load_json(os.path.join(ROOT, nu.BUILD_REL))["commit"] == "a" * 40)
s = run(nu.cmd_status)[-1]
check("after going back there's nothing to go back to", s["back"] is None and s["pending"]["back"] is True, s)
check("going back twice fails cleanly", run(nu.cmd_back)[-1].get("ok") is False)

# ---- a power cut halfway through ----
install_v1()
publish(V2, "c" * 40, 3000)
real_install_file = nu.install_file
count = {"n": 0}


def cut_power(src, path, mode):
    count["n"] += 1
    if count["n"] == 4:
        raise SystemExit("power cut")
    real_install_file(src, path, mode)


nu.install_file = cut_power
try:
    run(nu.cmd_install)
except SystemExit:
    nu.release()  # the process a power cut stops lets go of its lock
nu.install_file = real_install_file
check("a power cut leaves the journal at 'applying'", state().get("state") == "applying", state())
check("...with the helper itself already replaced", read_root("usr/lib/nimbus/nimbus-update") == V2["usr/lib/nimbus/nimbus-update"][0])
run(nu.cmd_boot)
check("the next start finishes the update", not matches({p: v for p, v in V2.items()}), matches(V2))
check("...and asks for another restart", state().get("state") == "restart" and state().get("commit") == "c" * 40, state())

# ---- a failure halfway puts everything back ----
install_v1()
publish(V2, "d" * 40, 4000)
count["n"] = 0


def disk_full(src, path, mode):
    count["n"] += 1
    if count["n"] == 3:
        raise OSError(28, "No space left on device")
    real_install_file(src, path, mode)


nu.install_file = disk_full
res = run(nu.cmd_install)[-1]
nu.install_file = real_install_file
check("a failure halfway is reported", res.get("ok") is False and "put the earlier version back" in res.get("error", ""), res)
check("...and the old files are back", not matches(V1), matches(V1))
check("...with nothing to go back to", not os.path.exists(nu.BACKUP))

# ---- refusals: nothing changes ----
install_v1()


def refused(label, expect, **kw):
    publish(V2, "e" * 40, 5000, **kw)
    res = run(nu.cmd_install)[-1]
    check(label, res.get("ok") is False and expect in res.get("error", "") and not matches(V1), (res, matches(V1)))


refused("a damaged package is refused", "damaged", mutate=lambda m: m["files"]["usr/bin/nimbus-shell"].update(sha256="0" * 64))
refused("a wrong package checksum is refused", "checksum", mutate=lambda m: m["bundle"].update(sha256="0" * 64))
refused("a path outside Nimbus's folders is refused", "may not change", mutate=lambda m: m["files"].update({"usr/../etc/shadow": m["files"]["usr/bin/nimbus-shell"]}))
refused("a newer Ubuntu release needs the ISO", "newer Ubuntu release", mutate=lambda m: m.update(suite="zesty"))
refused("a newer base needs the ISO", "needs the new ISO", mutate=lambda m: m.update(base=2))
refused("a newer update format needs the ISO", "newer way", mutate=lambda m: m.update(format=2))
bad_sudo = dict(V2)
bad_sudo["etc/sudoers.d/nimbus-sys"] = (b"nimbus ALL=(root NOPASSWD /oops\n", 0o440)
if shutil.which("visudo"):
    publish(bad_sudo, "f" * 40, 6000)
    res = run(nu.cmd_install)[-1]
    check("broken sudo rules are refused", res.get("ok") is False and "sudo rules" in res.get("error", "") and not matches(V1), res)
bad_py = dict(V2)
bad_py["usr/lib/nimbus/nimbus_store.py"] = (b"def (:\n", 0o644)
publish(bad_py, "f" * 40, 6000)
res = run(nu.cmd_install)[-1]
check("Python that doesn't compile is refused", res.get("ok") is False and "compile" in res.get("error", "") and not matches(V1), res)
SAVING["on"] = False
publish(V2, "f" * 40, 6000)
res = run(nu.cmd_install)[-1]
check("without saving, nothing installs", res.get("ok") is False and "Saving is off" in res.get("error", ""), res)
c = run(nu.cmd_check)[-1]
check("...and check says why", c.get("inplace") is False and c.get("why") == "saving", c)
SAVING["on"] = True
publish(V2, "a" * 40, 1000)
res = run(nu.cmd_install)[-1]
check("the same version isn't installed again", res.get("ok") is True and res.get("current") is True, res)
publish(V2, "9" * 40, 500)
check("an older version isn't offered", run(nu.cmd_check)[-1].get("available") is None)

# A package with something extra in it
publish(V2, "f" * 40, 7000)
bundle = os.path.join(SERVER, "nimbus-os-update-fffffff.tar.xz")
with tarfile.open(bundle, "r:xz") as t:
    members = [(m, t.extractfile(m).read() if m.isfile() else None) for m in t]
with tarfile.open(bundle, "w:xz") as t:
    for m, data in members:
        t.addfile(m, io.BytesIO(data) if data is not None else None)
    link = tarfile.TarInfo("files/etc/shadow")
    link.type, link.linkname = tarfile.SYMTYPE, "/etc/shadow"
    t.addfile(link)
mf = json.load(open(os.path.join(SERVER, nu.MANIFEST)))
mf["bundle"].update(size=os.path.getsize(bundle), sha256=hashlib.sha256(open(bundle, "rb").read()).hexdigest())
json.dump(mf, open(os.path.join(SERVER, nu.MANIFEST), "w"))
res = run(nu.cmd_install)[-1]
check("a package with a link in it is refused", res.get("ok") is False and "shouldn't" in res.get("error", "") and not matches(V1), res)

# ---- the test copy the boot test installs ----
src = os.path.join(tmp, "release")
os.makedirs(os.path.join(src, "chroot"))
for path, (data, mode) in V1.items():
    full = os.path.join(src, "chroot", path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(data)
    os.chmod(full, mode)
for extra in ("usr/bin/nimbus-wm", "usr/share/fonts/truetype/nimbus/a.ttf", "usr/share/doc/nimbus-os/README.md",
              "usr/share/keyrings/google-chrome.gpg", "usr/lib/os-release", "etc/issue"):
    full = os.path.join(src, "chroot", extra)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(extra.encode())
overlay = os.path.join(tmp, "overlay")
os.makedirs(os.path.join(overlay, "usr/lib/nimbus/__pycache__"))
open(os.path.join(overlay, "usr/lib/nimbus/nimbus_sys.py"), "w").close()
open(os.path.join(overlay, "usr/lib/nimbus/__pycache__/x.pyc"), "w").close()
migs = os.path.join(tmp, "migrations")
os.makedirs(migs)
with open(os.path.join(migs, "0001-first.sh"), "w") as f:
    f.write("#!/bin/sh\ntrue\n")
with open(os.path.join(migs, "README.md"), "w") as f:
    f.write("not a migration\n")
sys.argv = ["update-bundle.py", "build", os.path.join(src, "chroot"), os.path.join(src, "out"), "--overlay", overlay, "--migrations", migs,
            "--version", "0.1", "--commit", "1234567" * 5 + "12345", "--date", "1000", "--suite", "noble", "--base", "1", "--packages", "xwayland cage"]
with contextlib.redirect_stdout(io.StringIO()):
    ub.main()
built = json.load(open(os.path.join(src, "out", ub.MANIFEST)))
check("the package maker lists the overlay and Nimbus's other files", "usr/lib/nimbus/nimbus_sys.py" in built["files"] and "usr/bin/nimbus-wm" in built["files"]
      and not any("__pycache__" in p for p in built["files"]), sorted(built["files"]))
check("...leaves out files written per system", nu.BUILD_REL not in built["files"])
check("...and marks every migration done in the new system", open(os.path.join(src, "chroot/var/lib/nimbus/update/migrations.done")).read() == "0001-first\n")
check("...writes the system's file list", json.load(open(os.path.join(src, "chroot", nu.FILES_REL)))["files"] == built["files"])
nu.check_full(built)
check("...and the helper accepts its description", True)
sys.argv = ["update-bundle.py", "test", os.path.join(src, "out", ub.MANIFEST), os.path.join(src, "test")]
with contextlib.redirect_stdout(io.StringIO()):
    ub.main()
t = json.load(open(os.path.join(src, "test", ub.MANIFEST)))
check("the boot test's copy is newer and needs 'hello'", t["date"] > built["date"] and t["commit"].startswith("7e57") and "hello" in t["packages"], t["commit"])
check("...adds a file and removes /etc/issue", "usr/share/nimbus/update-test.txt" in t["files"] and "etc/issue" not in t["files"])
nu.check_full(t)
with tarfile.open(os.path.join(src, "test", t["bundle"]["name"]), "r:xz") as tar:
    names = tar.getnames()
check("...and its package holds what it lists", sorted(names) == sorted(["files/" + p for p in t["files"]] + ["migrations/%s.sh" % x["name"] for x in t["migrations"]]))

shutil.rmtree(tmp, ignore_errors=True)
print("\n%d failed" % len(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)
