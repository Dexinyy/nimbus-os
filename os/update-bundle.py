#!/usr/bin/env python3
"""Update packages for Nimbus OS. Each package holds Nimbus's own files, so a running system can update in place from
Settings › Nimbus Update instead of the whole ISO being written to its USB stick again.

  update-bundle.py build CHROOT OUTDIR --overlay DIR --migrations DIR --version V --commit SHA --date UNIX
                         --suite NAME --base N --packages "a b ..." [--notes-from REPO]
      Run by build-iso.sh on the finished system. It packs Nimbus's files from CHROOT into
      OUTDIR/nimbus-os-update-<commit>.tar.xz and describes the package in OUTDIR/nimbus-os-update.json (both are
      published next to the ISO). It also writes the same file list to CHROOT/usr/share/nimbus/files.json, which the
      next update compares against. Every migration is marked as done in the new system: the build ran them all.
  update-bundle.py test MANIFEST OUTDIR
      Makes a newer copy of a package for the boot test (os/test-boot.sh). The copy has one changed file, one new
      file and one removed file, plus an extra package and a test migration.

A package holds files/<path> (each file with its mode, owned by root) and migrations/<name>.sh (see
os/migrations/README.md). Its description lists every file with its SHA-256, size and mode, so the helper
(usr/lib/nimbus/nimbus-update) can check all of it before it changes anything.
"""
import argparse
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tarfile

FORMAT = 1
MANIFEST = "nimbus-os-update.json"
# Nimbus's files outside os/overlay: the desktop, the window manager, fonts, the README, Google's signing key
# for Chrome, and the files that name this version
EXTRA = ["usr/share/nimbus", "usr/bin/nimbus-wm", "usr/share/fonts/truetype/nimbus", "usr/share/doc/nimbus-os",
         "usr/share/keyrings/google-chrome.gpg", "usr/lib/os-release", "etc/issue"]
# Written per system: the version (the helper writes it from the description) and the list of files itself
SKIP = {"usr/share/nimbus/build-info.json", "usr/share/nimbus/files.json"}
MIGRATION = re.compile(r"^(\d{4}-[a-z0-9-]+)\.sh$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(top, rel_to):
    for root, dirs, files in os.walk(top):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for name in files:
            if not name.endswith(".pyc"):
                yield os.path.relpath(os.path.join(root, name), rel_to)


def collect(chroot, overlay):
    paths = set(walk(overlay, overlay))
    for item in EXTRA:
        full = os.path.join(chroot, item)
        if os.path.isdir(full) and not os.path.islink(full):
            paths.update(walk(full, chroot))
        elif os.path.lexists(full):
            paths.add(item)
        else:
            sys.exit("update-bundle: /%s is missing from the system" % item)
    files = {}
    for path in sorted(paths - SKIP):
        full = os.path.join(chroot, path)
        st = os.lstat(full)
        if not stat.S_ISREG(st.st_mode):
            sys.exit("update-bundle: /%s is not a plain file" % path)
        mode = stat.S_IMODE(st.st_mode)
        if mode & 0o7000:
            sys.exit("update-bundle: /%s has special permission bits (%o)" % (path, mode))
        files[path] = {"sha256": sha256(full), "size": st.st_size, "mode": mode}
    return files


def migrations(folder):
    found = []
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        m = MIGRATION.match(name)
        if m:
            found.append({"name": m.group(1), "sha256": sha256(os.path.join(folder, name)), "path": os.path.join(folder, name)})
    return found


def notes(repo):
    """The latest commits, newest first: Settings shows the ones newer than the version a system has."""
    try:
        out = subprocess.run(["git", "-c", "safe.directory=*", "-C", repo, "log", "-n", "40", "--format=%H%x09%ct%x09%s"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    result = []
    for line in out.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3 and parts[1].isdigit():
            result.append({"commit": parts[0][:7], "date": int(parts[1]), "subject": parts[2][:200]})
    return result


def tar_add(tar, name, data, mode, mtime):
    info = tarfile.TarInfo(name)
    info.size, info.mode, info.mtime = len(data), mode, mtime
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    tar.addfile(info, io.BytesIO(data))


def write_bundle(path, manifest, read_file, read_migration):
    with tarfile.open(path, "w:xz", preset=9, format=tarfile.PAX_FORMAT) as tar:
        for name, f in sorted(manifest["files"].items()):
            tar_add(tar, "files/" + name, read_file(name), f["mode"], manifest["date"])
        for mig in manifest["migrations"]:
            tar_add(tar, "migrations/%s.sh" % mig["name"], read_migration(mig["name"]), 0o755, manifest["date"])
    manifest["bundle"] = {"name": os.path.basename(path), "size": os.path.getsize(path), "sha256": sha256(path)}


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def build(args):
    chroot = os.path.abspath(args.chroot)
    files = collect(chroot, os.path.abspath(args.overlay))
    migs = migrations(args.migrations)
    packages = sorted(set(args.packages.split()))
    for p in packages:
        if not re.match(r"^[a-z0-9][a-z0-9+.-]+$", p):
            sys.exit("update-bundle: %r is not a package name" % p)
    commit = args.commit
    manifest = {
        "format": FORMAT, "name": "Nimbus OS %s" % args.version, "version": args.version, "commit": commit,
        "date": args.date, "suite": args.suite, "base": args.base, "files": files, "packages": packages,
        "migrations": [{"name": m["name"], "sha256": m["sha256"]} for m in migs],
        "notes": notes(args.notes_from) if args.notes_from else [],
    }
    os.makedirs(args.outdir, exist_ok=True)
    bundle = os.path.join(args.outdir, "nimbus-os-update-%s.tar.xz" % commit[:7])
    by_name = {m["name"]: m["path"] for m in migs}
    write_bundle(bundle, manifest, lambda name: open(os.path.join(chroot, name), "rb").read(),
                 lambda name: open(by_name[name], "rb").read())
    save_json(os.path.join(args.outdir, MANIFEST), manifest)
    # The new system: its own file list, and every migration already applied by the build
    save_json(os.path.join(chroot, "usr/share/nimbus/files.json"), {"commit": commit, "files": files})
    state = os.path.join(chroot, "var/lib/nimbus/update")
    os.makedirs(state, exist_ok=True)
    os.chmod(os.path.join(chroot, "var/lib/nimbus"), 0o755)
    os.chmod(state, 0o755)
    with open(os.path.join(state, "migrations.done"), "w") as f:
        f.write("".join(m["name"] + "\n" for m in migs))
    total = sum(f["size"] for f in files.values())
    print("Update package: %s, %d files (%.1f MB), %.1f MB to download, %d packages, %d migrations"
          % (os.path.basename(bundle), len(files), total / 1e6, manifest["bundle"]["size"] / 1e6, len(packages), len(migs)))


def test_copy(args):
    """A newer version for the boot test: the same files, except README.md changes, a test file appears and
    /etc/issue goes away. It also needs the small "hello" package and has a migration that leaves a marker."""
    src_dir = os.path.dirname(os.path.abspath(args.manifest))
    with open(args.manifest) as f:
        manifest = json.load(f)
    with tarfile.open(os.path.join(src_dir, manifest["bundle"]["name"]), "r:xz") as tar:
        data = {m.name: tar.extractfile(m).read() for m in tar if m.isfile()}
    files = {k[len("files/"):]: v for k, v in data.items() if k.startswith("files/")}
    files["usr/share/doc/nimbus-os/README.md"] += b"\nThis copy was updated in place by Nimbus Update's boot test.\n"
    files["usr/share/nimbus/update-test.txt"] = b"Installed by Nimbus Update's boot test\n"
    del files["etc/issue"]
    modes = {k: v["mode"] for k, v in manifest["files"].items()}
    modes["usr/share/nimbus/update-test.txt"] = 0o644
    mig = b"#!/bin/sh\n# Nimbus Update's boot test: shows that an update runs its new migrations\necho \"ran $(date +%s)\" > /var/lib/nimbus/update-test-migration\n"
    migs = {m["name"]: data["migrations/%s.sh" % m["name"]] for m in manifest["migrations"]}
    migs["9001-update-test"] = mig
    commit = "7e57" + manifest["commit"][4:]
    new = dict(manifest)
    new.update({
        "commit": commit, "date": manifest["date"] + 3600,
        "files": {k: {"sha256": hashlib.sha256(v).hexdigest(), "size": len(v), "mode": modes[k]} for k, v in files.items()},
        "packages": sorted(set(manifest["packages"]) | {"hello"}),
        "migrations": [{"name": n, "sha256": hashlib.sha256(v).hexdigest()} for n, v in sorted(migs.items())],
        "notes": [{"commit": commit[:7], "date": manifest["date"] + 3600, "subject": "Boot test: a newer build to update to"}] + manifest.get("notes", []),
    })
    os.makedirs(args.outdir, exist_ok=True)
    bundle = os.path.join(args.outdir, "nimbus-os-update-%s.tar.xz" % commit[:7])
    write_bundle(bundle, new, lambda name: files[name], lambda name: migs[name])
    save_json(os.path.join(args.outdir, MANIFEST), new)
    print("Test update: %s (%d bytes) from %s" % (os.path.basename(bundle), new["bundle"]["size"], manifest["commit"][:7]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("chroot")
    b.add_argument("outdir")
    b.add_argument("--overlay", required=True)
    b.add_argument("--migrations", required=True)
    b.add_argument("--version", required=True)
    b.add_argument("--commit", required=True)
    b.add_argument("--date", type=int, required=True)
    b.add_argument("--suite", required=True)
    b.add_argument("--base", type=int, required=True)
    b.add_argument("--packages", required=True)
    b.add_argument("--notes-from")
    t = sub.add_parser("test")
    t.add_argument("manifest")
    t.add_argument("outdir")
    args = ap.parse_args()
    build(args) if args.cmd == "build" else test_copy(args)


if __name__ == "__main__":
    main()
