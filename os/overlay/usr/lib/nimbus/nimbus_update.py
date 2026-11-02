"""Nimbus Update for the desktop. It finds new versions of Nimbus OS and installs them in place through the update
helper (/usr/lib/nimbus/nimbus-update, run as root through sudo). It also checks for Google Chrome updates and keeps
the history that Settings shows.

UpdateMethods is mixed into nimbus-shell's Shell, like nimbus_sys.SysMethods: each m_<name> answers the page's
Native.call('<name>'). Progress goes to the page as 'native:update-progress' events."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time

from gi.repository import GLib

import nimbus_sys

UPDATER = "/usr/lib/nimbus/nimbus-update"
FILES = "/usr/share/nimbus/files.json"


class UpdateError(Exception):
    pass


def last_json(text):
    for line in reversed((text or "").splitlines()):
        try:
            data = json.loads(line)
        except ValueError:
            continue
        if isinstance(data, dict) and "ok" in data:
            return data
    return None


def updater(cmd, timeout=120):
    """'check' or 'status': these run as this user (only installing and going back need root)."""
    try:
        r = subprocess.run([UPDATER, cmd], capture_output=True, text=True, timeout=timeout, env=nimbus_sys.env())
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise UpdateError("Couldn't check for updates (%s)" % exc)
    data = last_json(r.stdout)
    if data is None:
        err = [l for l in r.stderr.splitlines() if l.strip()]
        raise UpdateError((err[-1] if err else "The update helper didn't answer")[:300])
    return data


def file_sha(path):
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


class UpdateMethods:
    upd_proc = None
    upd_lock = threading.Lock()

    def upd_emit(self, data):
        GLib.idle_add(lambda: self.emit("update-progress", data) and False)

    def m_updateCheck(self, _args):
        """The newest Nimbus OS and whether it installs here, what's waiting for a restart, and Chrome's updates."""
        result = updater("check")
        result["nimbusNew"] = bool(result.get("available"))
        result["chrome"] = None
        if os.path.exists("/usr/bin/google-chrome-stable"):
            try:
                out = nimbus_sys.run(["sudo", "-n", nimbus_sys.APPS_HELPER, "check", "chrome"], timeout=120)
                last = json.loads(out.strip().splitlines()[-1])
                result["chrome"] = {"installed": True, "version": last.get("installed", ""), "candidate": last.get("candidate", ""),
                                    "update": bool(last.get("candidate") and last.get("candidate") != last.get("installed"))}
            except Exception as exc:
                result["chrome"] = {"installed": True, "error": str(exc)}
        return result

    def m_updateStatus(self, _args):
        """What's installed, what's waiting for a restart and what to go back to, without going online."""
        return updater("status", timeout=30)

    def m_updateInstall(self, _args):
        with self.upd_lock:
            if self.upd_proc and self.upd_proc.poll() is None:
                raise UpdateError("Nimbus OS is already being updated")
            proc = subprocess.Popen(["sudo", "-n", UPDATER, "install"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                    env=nimbus_sys.env())
            self.upd_proc = proc
        errors = []

        def drain():  # the helper's messages go to the system log too
            for line in proc.stderr:
                if line.strip():
                    errors.append(line.strip())
                    print(line.rstrip(), file=sys.stderr, flush=True)
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        result = None
        for line in proc.stdout:
            try:
                data = json.loads(line)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if "ok" in data:
                result = data
            elif "phase" in data:
                self.upd_emit(data)
        proc.wait()
        reader.join(5)
        with self.upd_lock:
            self.upd_proc = None
        if result is None:
            raise UpdateError((errors[-1] if errors else "The update stopped unexpectedly")[:300])
        if not result.get("ok"):
            if result.get("cancelled"):
                raise UpdateError("cancelled")
            self.record_update("Nimbus OS update", False, result.get("error", ""))
            raise UpdateError(result.get("error") or "The update didn't finish")
        if not result.get("current"):
            self.record_update("%s (build %s)" % (result.get("name") or "Nimbus OS", result.get("commit", "")), True)
        return result

    def m_updateCancel(self, _args):
        with self.upd_lock:
            proc = self.upd_proc
        if proc and proc.poll() is None:
            proc.send_signal(signal.SIGTERM)  # sudo hands it on; the helper stops while nothing has changed yet
        return True

    def m_updateBack(self, _args):
        try:
            r = subprocess.run(["sudo", "-n", UPDATER, "back"], capture_output=True, text=True, timeout=900, env=nimbus_sys.env())
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise UpdateError("Couldn't go back (%s)" % exc)
        result = last_json(r.stdout)
        if not result or not result.get("ok"):
            raise UpdateError((result or {}).get("error") or (r.stderr.strip().splitlines() or ["Couldn't go back"])[-1][:300])
        self.record_update("Went back to Nimbus OS %s (build %s)" % (result.get("version", ""), result.get("commit", "")), True)
        return result

    def record_update(self, name, ok, detail=""):
        path = os.path.join(nimbus_sys.DATA_DIR, "updates.json")
        hist = nimbus_sys.load_json(path, [])
        hist.insert(0, {"name": name, "ok": ok, "time": int(time.time()), "detail": detail})
        nimbus_sys.save_json(path, hist[:50])

    def m_updateHistory(self, _args):
        return nimbus_sys.load_json(os.path.join(nimbus_sys.DATA_DIR, "updates.json"), [])

    def m_updatePrefs(self, args):
        nimbus_sys.save_json(os.path.join(nimbus_sys.CONFIG_DIR, "updates.json"), {k: args.get(k) for k in ("auto", "metered", "paused")})
        return True

    def m_updateTest(self, _args):
        """Boot test only ("nimbus.test=update", os/test-boot.sh): does every file match the version it says it is?"""
        if "nimbus.test=update" not in nimbus_sys.read("/proc/cmdline").split():
            raise UpdateError("This is only for Nimbus Update's boot test")
        files = (nimbus_sys.load_json(FILES, {}) or {}).get("files") or {}
        bad, checked = [], 0
        for path, f in sorted(files.items()):
            full = "/" + path
            try:
                os.stat(full)
                readable = os.access(full, os.R_OK)
            except PermissionError:  # in a folder only root can open (polkit's rules)
                readable = False
            except OSError:
                readable = True  # missing: that counts
            if not readable:
                continue  # root's own (the sudo rules)
            checked += 1
            if file_sha(full) != f.get("sha256"):
                bad.append(path)
        try:
            hello = subprocess.run(["dpkg-query", "-W", "-f=${Status}", "hello"], capture_output=True, text=True, timeout=30).stdout
        except (OSError, subprocess.TimeoutExpired):
            hello = ""
        return {"build": nimbus_sys.load_json("/usr/share/nimbus/build-info.json", {}), "files": len(files), "checked": checked,
                "bad": bad[:5], "badCount": len(bad), "migration": os.path.exists("/var/lib/nimbus/update-test-migration"),
                "hello": hello.endswith(" installed"), "added": os.path.exists("/usr/share/nimbus/update-test.txt"),
                "issue": os.path.exists("/etc/issue"), "status": updater("status", timeout=30)}
