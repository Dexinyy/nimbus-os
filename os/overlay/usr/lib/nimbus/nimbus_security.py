"""Nimbus Security, the machine side of the Security app (like Windows Security):

- virus and threat protection with ClamAV: quick, full and custom scans, real-time protection of the folders new
  files arrive in (downloads especially), quarantine, allowed threats, exclusions, and protection history;
- the firewall (ufw, through the root helper), with Private and Public network profiles;
- what the device's hardware and kernel do for its security (Secure Boot, the TPM, exploit mitigations), and a
  health report.

SecurityMethods is mixed into nimbus-shell's Shell. Scans and alerts reach the page as 'native:security-scan' and
'native:security-alert' events. Virus definitions live in /var/lib/clamav (downloaded by freshclam through the root
helper); scanning runs as this user, so it reaches what this user can read."""
import base64
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

from gi.repository import Gio, GLib

DB_DIR = "/var/lib/clamav"
HELPER = "/usr/lib/nimbus/nimbus-sys"
HOME = os.path.expanduser("~")
SEC_DIR = os.path.join(GLib.get_user_data_dir(), "nimbus", "security")
QUARANTINE = os.path.join(SEC_DIR, "quarantine")
HISTORY = os.path.join(SEC_DIR, "history.json")
PREFS = os.path.join(GLib.get_user_config_dir(), "nimbus", "security.json")
NET_PROFILES = os.path.join(GLib.get_user_config_dir(), "nimbus", "network-profiles.json")
DEFAULT_PREFS = {"realtime": True, "downloads": True, "pua": True, "puaDownloads": True, "notify": True,
                 "exclusions": [], "allowed": [], "lastQuick": 0, "lastFull": 0}
SKIP = re.compile(r"\.(crdownload|part|partial|download|tmp|swp)$|~$", re.I)
# folders a quick scan looks through: where new files and things that start by themselves live
QUICK = ["Downloads", "Desktop", "Documents", ".config/autostart", ".local/bin", ".local/share/applications"]
# never worth scanning: Flatpak's store of app files (what's installed is scanned where it runs), caches, quarantine
ALWAYS_EXCLUDED = [os.path.join(HOME, ".local/share/flatpak/repo"), os.path.join(HOME, ".cache"), SEC_DIR,
                   "/proc", "/sys", "/dev", "/run"]
_lock = threading.Lock()


class SecurityError(Exception):
    pass


def _load(path, default):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, type(default)) else default
    except (OSError, ValueError):
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def prefs():
    p = dict(DEFAULT_PREFS)
    p.update(_load(PREFS, {}))
    return p


def set_prefs(changes):
    p = prefs()
    for k, v in changes.items():
        if k in DEFAULT_PREFS:
            p[k] = v
    _save(PREFS, p)
    return p


def _run(argv, timeout=30, check=False):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                           env=dict(os.environ, LC_ALL="C.UTF-8"))
    except (OSError, subprocess.TimeoutExpired) as exc:
        if check:
            raise SecurityError(str(exc))
        return ""
    if check and r.returncode != 0:
        raise SecurityError((r.stderr or r.stdout or "%s failed" % argv[0]).strip().splitlines()[-1][:300])
    return r.stdout


def _read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


# ---------- definitions (security intelligence) ----------

def _cvd_header(path):
    """A ClamAV database's header: ClamAV-VDB:build time:version:signatures:..."""
    try:
        with open(path, "rb") as f:
            head = f.read(512).decode("ascii", "replace")
    except OSError:
        return None
    parts = head.split(":")
    if len(parts) < 4 or parts[0] != "ClamAV-VDB" or not parts[2].isdigit():
        return None
    built = 0
    try:
        built = int(time.mktime(time.strptime(parts[1].split(" +")[0].split(" -")[0].strip(), "%d %b %Y %H-%M")))
    except ValueError:
        pass
    return {"version": int(parts[2]), "sigs": int(parts[3]) if parts[3].isdigit() else 0, "built": built}


def definitions():
    info = {"present": False, "version": None, "built": 0, "sigs": 0, "updated": 0, "parts": {}}
    for name in ("main", "daily", "bytecode"):
        for ext in ("cld", "cvd"):
            path = os.path.join(DB_DIR, "%s.%s" % (name, ext))
            head = _cvd_header(path)
            if head:
                info["parts"][name] = head
                info["sigs"] += head["sigs"]
                info["built"] = max(info["built"], head["built"])
                info["updated"] = max(info["updated"], int(os.path.getmtime(path)))
                break
    extra = [p for e in ("hdb", "hsb", "ndb", "ldb", "cud") for p in glob.glob(os.path.join(DB_DIR, "*." + e))]
    for p in extra:
        info["updated"] = max(info["updated"], int(os.path.getmtime(p)))
        info["sigs"] += sum(1 for line in open(p, errors="replace") if line.strip() and not line.startswith("#"))
    info["present"] = "main" in info["parts"] or "daily" in info["parts"] or bool(extra)
    if "daily" in info["parts"]:
        info["version"] = "1.%d" % info["parts"]["daily"]["version"]
    elif extra:
        info["version"] = "test"
    return info


def engine_version():
    out = _run(["clamscan", "--version"], timeout=20)
    m = re.match(r"ClamAV ([\d.]+)", out.strip())
    return m.group(1) if m else None


# ---------- protection history ----------

def history():
    return _load(HISTORY, [])


def _history_add(entry):
    with _lock:
        items = history()
        entry.setdefault("id", uuid.uuid4().hex[:12])
        entry.setdefault("time", int(time.time()))
        items.insert(0, entry)
        _save(HISTORY, items[:300])
    return entry


def _history_update(entry_id, **changes):
    with _lock:
        items = history()
        for e in items:
            if e.get("id") == entry_id:
                e.update(changes)
        _save(HISTORY, items)


def severity(threat):
    t = threat.lower()
    if t.startswith("pua.") or any(k in t for k in ("adware", "packed", "tool", "coinminer", "miner")):
        return "low" if t.startswith("pua.") else "medium"
    if t.startswith("heuristics.") or "phishing" in t:
        return "medium"
    if any(k in t for k in ("trojan", "ransom", "backdoor", "exploit", "worm", "virus", "malware", "rootkit", "test", "eicar")):
        return "severe"
    return "high"


def threat_kind(threat):
    t = threat.lower()
    if t.startswith("pua."):
        return "Potentially unwanted app"
    if "test" in t or "eicar" in t:
        return "Test file (harmless)"
    for word, label in (("ransom", "Ransomware"), ("trojan", "Trojan"), ("backdoor", "Backdoor"), ("worm", "Worm"),
                        ("exploit", "Exploit"), ("phishing", "Phishing"), ("miner", "Coin miner"), ("adware", "Adware")):
        if word in t:
            return label
    return "Malware"


# ---------- quarantine ----------

def quarantine(path, threat):
    """Move a threat where it can't run; returns the quarantine id."""
    os.makedirs(QUARANTINE, mode=0o700, exist_ok=True)
    qid = uuid.uuid4().hex[:16]
    dest = os.path.join(QUARANTINE, qid + ".bin")
    try:
        size = os.lstat(path).st_size
        try:
            os.rename(path, dest)
        except OSError:
            shutil.copyfile(path, dest)
            os.remove(path)
        os.chmod(dest, 0)
    except OSError as exc:
        raise SecurityError("Couldn't move %s to quarantine: %s" % (os.path.basename(path), exc.strerror or exc))
    _save(os.path.join(QUARANTINE, qid + ".json"), {"id": qid, "path": path, "threat": threat, "time": int(time.time()), "size": size})
    return qid


def quarantined():
    out = []
    for meta in glob.glob(os.path.join(QUARANTINE, "*.json")):
        m = _load(meta, {})
        if m.get("id") and os.path.exists(os.path.join(QUARANTINE, m["id"] + ".bin")):
            out.append(m)
    return sorted(out, key=lambda m: -m.get("time", 0))


def restore(qid):
    if not re.match(r"^[0-9a-f]{16}$", qid or ""):
        raise SecurityError("Unknown item")
    meta = _load(os.path.join(QUARANTINE, qid + ".json"), {})
    src = os.path.join(QUARANTINE, qid + ".bin")
    if not meta or not os.path.exists(src):
        raise SecurityError("It isn't in quarantine anymore")
    dest = meta["path"]
    if os.path.exists(dest):
        base, ext = os.path.splitext(dest)
        dest = "%s (restored)%s" % (base, ext)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    os.chmod(src, 0o600)
    try:
        os.rename(src, dest)
    except OSError:
        shutil.copyfile(src, dest)
        os.remove(src)
    os.remove(os.path.join(QUARANTINE, qid + ".json"))
    allow(meta["path"], meta["threat"])
    return dest


def remove_quarantined(qid):
    if not re.match(r"^[0-9a-f]{16}$", qid or ""):
        raise SecurityError("Unknown item")
    for ext in (".bin", ".json"):
        try:
            p = os.path.join(QUARANTINE, qid + ext)
            os.chmod(p, 0o600)
            os.remove(p)
        except OSError:
            pass


def allow(path, threat):
    p = prefs()
    allowed = [a for a in p["allowed"] if not (a.get("path") == path and a.get("threat") == threat)]
    allowed.append({"path": path, "threat": threat, "time": int(time.time())})
    set_prefs({"allowed": allowed[-200:]})


def is_allowed(path, threat, allowed):
    return any(a.get("threat") == threat and a.get("path") in (path, "*") for a in allowed)


# ---------- scanning ----------

def _regex_dir(path):
    return "^" + re.escape(path.rstrip("/")) + "(/|$)"


def scan_targets(kind, paths=None):
    if kind == "quick":
        return [p for p in (os.path.join(HOME, q) for q in QUICK) if os.path.exists(p)] + [p for p in ("/tmp", "/var/tmp", "/dev/shm") if os.path.isdir(p)]
    if kind == "full":
        mounts = [m for base in ("/media", "/run/media", "/mnt") for m in glob.glob(os.path.join(base, "*", "*")) + glob.glob(os.path.join(base, "*")) if os.path.ismount(m)]
        return [HOME, "/tmp", "/var/tmp", "/opt", "/usr/local"] + sorted(set(mounts))
    out = []
    for p in paths or []:
        p = os.path.abspath(os.path.expanduser(str(p)))
        if os.path.exists(p):
            out.append(p)
    if not out:
        raise SecurityError("Choose a folder or file that exists")
    return out


def count_files(targets, excluded, limit=3000000):
    n = 0
    ex = tuple(e.rstrip("/") + "/" for e in excluded)
    for t in targets:
        if os.path.isfile(t):
            n += 1
            continue
        for root, dirs, files in os.walk(t, onerror=lambda e: None):
            if (root + "/").startswith(ex):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d)) and not (os.path.join(root, d) + "/").startswith(ex)]
            n += len(files)
            if n > limit:
                return n
    return n


class Scan:
    """One clamscan run over some targets; report(state dict) as it goes, threats in self.threats."""

    def __init__(self, kind, targets, report, pua=True, realtime=False):
        self.kind, self.targets, self.report = kind, targets, report
        self.pua, self.realtime = pua, realtime
        self.proc = None
        self.cancelled = False
        self.state = {"kind": kind, "state": "starting", "scanned": 0, "total": 0, "threats": [], "current": "",
                      "started": int(time.time()), "id": uuid.uuid4().hex[:8]}

    def cancel(self):
        self.cancelled = True
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def run(self):
        p = prefs()
        excluded = ALWAYS_EXCLUDED + [e["path"] for e in p["exclusions"] if e.get("type") == "folder"]
        ex_files = [e["path"] for e in p["exclusions"] if e.get("type") == "file"]
        ex_types = [e["path"].lstrip("*.").lower() for e in p["exclusions"] if e.get("type") == "type"]
        if not self.realtime:
            self.state["state"] = "counting"
            self.report(self.state)
            self.state["total"] = count_files(self.targets, excluded)
        argv = ["clamscan", "--database=" + DB_DIR, "--stdout", "--no-summary", "-r", "--max-filesize=200M",
                "--max-scansize=400M", "--max-recursion=12", "--follow-dir-symlinks=0", "--follow-file-symlinks=0",
                "--detect-pua=" + ("yes" if self.pua else "no")]
        argv += ["--exclude-dir=" + _regex_dir(e) for e in excluded]
        argv += ["--exclude=^" + re.escape(f) + "$" for f in ex_files]
        argv += ["--exclude=\\." + re.escape(t) + "$" for t in ex_types if re.match(r"^[A-Za-z0-9]{1,12}$", t)]
        argv += ["--"] + self.targets
        if shutil.which("stdbuf"):
            argv = ["stdbuf", "-oL"] + argv
        self.state["state"] = "loading"  # clamscan reads its definitions first (tens of seconds with the full set)
        self.report(self.state)
        try:
            self.proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace",
                                         env=dict(os.environ, LC_ALL="C.UTF-8"))
        except OSError as exc:
            raise SecurityError("The virus scanner isn't installed (%s)" % exc)
        last = 0
        for line in self.proc.stdout:
            line = line.rstrip("\n")
            m = re.match(r"^(.*): (.+?) FOUND$", line)
            if m:
                self.state["threats"].append({"path": m.group(1), "threat": m.group(2)})
                self.state["scanned"] += 1
            elif re.match(r"^(.*): (OK|Empty file|Excluded|Symbolic link|Access denied|.*ERROR)$", line):
                self.state["scanned"] += 1
                self.state["current"] = line.rsplit(": ", 1)[0]
            else:
                continue
            if self.state["state"] != "scanning":
                self.state["state"] = "scanning"
            now = time.time()
            if now - last > 0.3:
                last = now
                self.report(self.state)
        err = self.proc.stderr.read()
        code = self.proc.wait()
        if self.cancelled:
            self.state["state"] = "cancelled"
        elif code == 2 and not self.state["threats"] and not self.state["scanned"]:
            msg = [l for l in err.splitlines() if "ERROR" in l] or err.strip().splitlines() or ["The scan didn't start"]
            self.state["state"] = "failed"
            self.state["error"] = re.sub(r"^.*ERROR:\s*", "", msg[-1])[:300]
        else:
            self.state["state"] = "done"
        self.state["finished"] = int(time.time())
        self.state["total"] = max(self.state["total"], self.state["scanned"])
        self.report(self.state)
        return self.state


# ---------- the device ----------

def secure_boot():
    if not os.path.isdir("/sys/firmware/efi"):
        return {"supported": False, "on": False}
    for path in glob.glob("/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c"):
        try:
            with open(path, "rb") as f:
                data = f.read()
            return {"supported": True, "on": len(data) >= 5 and data[4] == 1}
        except OSError:
            pass
    return {"supported": True, "on": False}


def tpm():
    for dev in sorted(glob.glob("/sys/class/tpm/tpm*")):
        major = _read(os.path.join(dev, "tpm_version_major"))
        desc = _read(os.path.join(dev, "device", "description")) or _read(os.path.join(dev, "device", "modalias"))
        return {"present": True, "version": ("%s.0" % major) if major else "", "name": desc[:80]}
    return {"present": False}


def mitigations():
    """What the processor and kernel do against attacks (Windows' exploit protection)."""
    flags = ""
    for line in _read("/proc/cpuinfo").splitlines():
        if line.startswith("flags"):
            flags = line
            break
    out = [
        {"name": "Address space layout randomization (ASLR)", "on": _read("/proc/sys/kernel/randomize_va_space") == "2",
         "desc": "Programs are loaded at unpredictable places in memory."},
        {"name": "Data Execution Prevention (NX)", "on": " nx" in flags or not flags,
         "desc": "Memory that holds data can't be run as code."},
        {"name": "Control-flow protection (CET)", "on": " user_shstk" in flags or " ibt" in flags,
         "desc": "The processor checks that programs return where they were called from."},
        {"name": "Kernel lockdown", "on": "[none]" not in _read("/sys/kernel/security/lockdown", "[none]"),
         "desc": "Even administrators can't change the running kernel's code."},
    ]
    vulns = []
    for path in sorted(glob.glob("/sys/devices/system/cpu/vulnerabilities/*")):
        state = _read(path)
        if state.lower().startswith("vulnerable"):
            vulns.append(os.path.basename(path))
    out.append({"name": "Processor side-channel mitigations (Spectre, Meltdown...)", "on": not vulns,
                "desc": "All known issues are mitigated." if not vulns else "Not mitigated: " + ", ".join(vulns)})
    return out


def kernel_lockdown():
    m = re.search(r"\[(\w+)\]", _read("/sys/kernel/security/lockdown"))
    return m.group(1) if m else "none"


def health():
    st = os.statvfs(HOME)
    free = st.f_bavail * st.f_frsize
    total = st.f_blocks * st.f_frsize or 1
    items = [{"id": "storage", "title": "Storage capacity", "ok": free / total > 0.1 and free > 2e9,
              "desc": "%.1f GB free of %.1f GB" % (free / 1e9, total / 1e9)}]
    bats = glob.glob("/sys/class/power_supply/BAT*")
    if bats:
        full = _read(bats[0] + "/energy_full") or _read(bats[0] + "/charge_full")
        design = _read(bats[0] + "/energy_full_design") or _read(bats[0] + "/charge_full_design")
        pct = int(100 * int(full) / int(design)) if full.isdigit() and design.isdigit() and int(design) else None
        items.append({"id": "battery", "title": "Battery life", "ok": pct is None or pct >= 60,
                      "desc": ("Holds %d%% of its original charge" % pct) if pct else "No issues"})
    synced = "NTPSynchronized=yes" in _run(["timedatectl", "show", "-p", "NTPSynchronized"], timeout=10)
    items.append({"id": "time", "title": "Time service", "ok": synced, "desc": "The clock is set from the internet" if synced else "The clock isn't synchronized"})
    return items


# ---------- networks: Private or Public ----------

def active_connection():
    out = _run(["nmcli", "-t", "-f", "UUID,TYPE,NAME,DEVICE", "connection", "show", "--active"], timeout=10)
    for line in out.splitlines():
        parts = re.split(r"(?<!\\):", line)
        if len(parts) >= 4 and parts[1] in ("802-11-wireless", "802-3-ethernet", "gsm", "vpn", "wireguard") and parts[3] != "lo":
            return {"uuid": parts[0], "type": parts[1], "name": parts[2].replace("\\:", ":")}
    return None


def network_profile(conn_uuid):
    return _load(NET_PROFILES, {}).get(conn_uuid, "public")


def set_network_profile(conn_uuid, profile):
    if profile not in ("public", "private") or not re.match(r"^[0-9a-f-]{36}$", conn_uuid or ""):
        raise SecurityError("Unknown network")
    data = _load(NET_PROFILES, {})
    data[conn_uuid] = profile
    _save(NET_PROFILES, data)


def helper(*args, timeout=120):
    try:
        r = subprocess.run(["sudo", "-n", HELPER, *[str(a) for a in args]], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SecurityError(str(exc))
    if r.returncode != 0:
        raise SecurityError((r.stderr or r.stdout or "failed").strip().splitlines()[-1][:300])
    return r.stdout


def firewall_status():
    try:
        return json.loads(helper("firewall", "status", timeout=60))
    except (ValueError, SecurityError) as exc:
        return {"available": False, "error": str(exc)}


# the industry's standard antivirus test file (EICAR), for boot tests; stored scrambled so nothing mistakes this file for it
TEST_SAMPLE = "=oCSrgEJhUETJZULUNVRU1yUVJVSWlEVOFULEJVQE5UQUNVLSF0QJVEJ9dTKDN0Np4FUoQTNYpFUcRzWQFEQlAVIPVDW"


def test_sample():
    return base64.b64decode(TEST_SAMPLE[::-1])


def _test_mode():
    return bool(os.environ.get("NIMBUS_TEST")) or "nimbus.test=" in _read("/proc/cmdline")


# ---------- the page's calls ----------

class SecurityMethods:
    """Mixed into nimbus-shell's Shell."""

    def security_init(self):
        self.sec_scan = None          # the scan going on (from the page)
        self.sec_rt_queue = set()
        self.sec_rt_timer = 0
        self.sec_rt_busy = False
        self.sec_monitors = []
        self.sec_watch()

    def sec_emit(self, name, data):
        GLib.idle_add(lambda: self.emit(name, data) and False)

    # ---- status ----
    def m_securityStatus(self, _args):
        d = definitions()
        p = prefs()
        threats = [e for e in history() if e.get("kind") == "threat" and e.get("status") == "active"]
        fw = firewall_status()
        return {
            "engine": engine_version(), "defs": d, "prefs": p, "activeThreats": threats,
            "quarantined": len(quarantined()), "scan": self.sec_scan.state if self.sec_scan else None,
            "realtime": bool(p["realtime"] and d["present"]), "firewall": fw,
            "secureBoot": secure_boot(), "tpm": tpm(), "lockdown": kernel_lockdown(),
            "network": self.sec_network(),
        }

    def sec_network(self):
        conn = active_connection()
        if not conn:
            return None
        return dict(conn, profile=network_profile(conn["uuid"]))

    def m_securityPrefs(self, args):
        changes = {k: v for k, v in (args.get("set") or {}).items() if k in ("realtime", "downloads", "pua", "puaDownloads", "notify")}
        p = set_prefs(changes)
        if "realtime" in changes or "downloads" in changes:
            GLib.idle_add(lambda: self.sec_watch() and False)
        return p

    def m_securityExclusion(self, args):
        kind, path = args.get("type"), str(args.get("path") or "").strip()
        if kind not in ("folder", "file", "type"):
            raise SecurityError("Choose a folder, a file or a file type")
        p = prefs()
        ex = [e for e in p["exclusions"] if not (e["type"] == kind and e["path"] == path)]
        if args.get("add"):
            if kind == "type" and not re.match(r"^\.?[A-Za-z0-9]{1,12}$", path):
                raise SecurityError("Type an extension like .iso")
            if kind != "type":
                path = os.path.abspath(os.path.expanduser(path))
                if not os.path.exists(path):
                    raise SecurityError("%s doesn't exist" % path)
            ex.append({"type": kind, "path": path if kind != "type" else "." + path.lstrip(".").lower()})
        return set_prefs({"exclusions": ex})["exclusions"]

    def m_securityAllowed(self, args):
        """Stop allowing a threat (it's reported again on the next scan)."""
        p = prefs()
        return set_prefs({"allowed": [a for a in p["allowed"] if not (a.get("path") == args.get("path") and a.get("threat") == args.get("threat"))]})["allowed"]

    # ---- definitions ----
    def m_securityUpdate(self, _args):
        """Download the latest security intelligence (ClamAV's virus definitions) through the root helper."""
        before = definitions()
        proc = subprocess.Popen(["sudo", "-n", HELPER, "security-update"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in proc.stdout:
            line = line.strip()
            m = re.search(r"Downloading (\w+)\.(cvd|cdiff|cld)", line) or re.search(r"(daily|main|bytecode) database available for (download|update)", line)
            if m:
                self.sec_emit("security-scan", {"kind": "update", "state": "working", "text": "Downloading %s" % {"main": "the main definitions (about 160 MB)", "daily": "the latest definitions", "bytecode": "detection programs"}.get(m.group(1), m.group(1))})
        err = proc.stderr.read()
        code = proc.wait()
        after = definitions()
        if code != 0:
            msg = [l for l in err.splitlines() if l.strip()] or ["The update didn't finish"]
            _history_add({"kind": "update", "title": "Security intelligence update failed", "detail": msg[-1][:200], "severity": "info", "status": "failed"})
            raise SecurityError(re.sub(r"^.*ERROR:\s*", "", msg[-1])[:300])
        if after.get("version") != before.get("version"):
            _history_add({"kind": "update", "title": "Security intelligence updated", "detail": "Version %s" % after.get("version"), "severity": "info", "status": "done"})
        GLib.idle_add(lambda: self.sec_watch() and False)
        return after

    # ---- scans ----
    def m_securityScan(self, args):
        kind = args.get("kind")
        if kind not in ("quick", "full", "custom"):
            raise SecurityError("Unknown scan")
        if self.sec_scan and self.sec_scan.state["state"] in ("starting", "counting", "loading", "scanning"):
            raise SecurityError("A scan is already running")
        if not definitions()["present"]:
            raise SecurityError("Security intelligence isn't downloaded yet")
        targets = scan_targets(kind, args.get("paths"))
        scan = Scan(kind, targets, lambda st: self.sec_emit("security-scan", dict(st)), prefs()["pua"])
        self.sec_scan = scan
        state = scan.run()
        self.sec_scan_done(state, auto=False)
        return state

    def m_securityCancel(self, _args):
        if self.sec_scan:
            self.sec_scan.cancel()
        return True

    def sec_scan_done(self, state, auto):
        """Record a finished scan; real-time protection quarantines what it finds right away."""
        allowed = prefs()["allowed"]
        found = [t for t in state["threats"] if not is_allowed(t["path"], t["threat"], allowed)]
        state["threats"] = found
        for t in found:
            entry = {"kind": "threat", "title": t["threat"], "threat": t["threat"], "path": t["path"], "severity": severity(t["threat"]),
                     "category": threat_kind(t["threat"]), "status": "active", "source": "realtime" if auto else state["kind"]}
            if auto:
                try:
                    entry["quarantine"] = quarantine(t["path"], t["threat"])
                    entry["status"] = "quarantined"
                except SecurityError as exc:
                    entry["detail"] = str(exc)
            t.update(_history_add(entry))
        if state["state"] in ("done", "cancelled") and not auto:
            names = {"quick": "Quick scan", "full": "Full scan", "custom": "Custom scan"}
            _history_add({"kind": "scan", "title": names.get(state["kind"], "Scan") + (" cancelled" if state["state"] == "cancelled" else ""),
                          "detail": "%d files scanned, %d threats found" % (state["scanned"], len(found)), "severity": "info",
                          "status": state["state"], "scanned": state["scanned"], "found": len(found),
                          "duration": state.get("finished", 0) - state.get("started", 0)})
            if state["state"] == "done":
                set_prefs({"lastQuick" if state["kind"] == "quick" else "lastFull" if state["kind"] == "full" else "lastCustom": int(time.time())})
        if found:
            self.sec_emit("security-alert", {"threats": found, "auto": auto})

    def m_securityAction(self, args):
        """Act on a threat from protection history: quarantine, remove, allow, restore, or delete for good."""
        action, eid = args.get("action"), args.get("id")
        entry = next((e for e in history() if e.get("id") == eid), None)
        if not entry:
            raise SecurityError("It isn't in protection history anymore")
        if action == "quarantine" and entry.get("status") == "active":
            qid = quarantine(entry["path"], entry["threat"])
            _history_update(eid, status="quarantined", quarantine=qid)
        elif action == "remove":
            if entry.get("quarantine"):
                remove_quarantined(entry["quarantine"])
            elif os.path.lexists(entry.get("path", "")):
                try:
                    os.remove(entry["path"])
                except OSError as exc:
                    raise SecurityError("Couldn't remove it: %s" % (exc.strerror or exc))
            _history_update(eid, status="removed")
        elif action == "allow":
            if entry.get("quarantine"):
                restore(entry["quarantine"])
            else:
                allow(entry["path"], entry["threat"])
            _history_update(eid, status="allowed")
        elif action == "restore" and entry.get("quarantine"):
            dest = restore(entry["quarantine"])
            _history_update(eid, status="allowed", detail="Restored to " + dest)
        else:
            raise SecurityError("That can't be done to this item")
        return next((e for e in history() if e.get("id") == eid), None)

    def m_securityActAll(self, _args):
        """'Start actions': quarantine every active threat."""
        done, failed = 0, []
        for e in history():
            if e.get("kind") == "threat" and e.get("status") == "active":
                try:
                    self.m_securityAction({"action": "quarantine", "id": e["id"]})
                    done += 1
                except SecurityError as exc:
                    failed.append(str(exc))
        if failed:
            raise SecurityError(failed[0])
        return done

    def m_securityHistory(self, _args):
        return history()

    def m_securityClearHistory(self, _args):
        _save(HISTORY, [e for e in history() if e.get("kind") == "threat" and e.get("status") in ("active", "quarantined")])
        return True

    # ---- real-time protection ----
    def sec_watch(self):
        """Watch the folders new files arrive in; each file is scanned once it's written."""
        for mon in self.sec_monitors:
            mon.cancel()
        self.sec_monitors = []
        p = prefs()
        if not (p["realtime"] or p["downloads"]) or not definitions()["present"]:
            return
        folders = []
        if p["realtime"]:
            folders += ["Desktop", "Documents", ".config/autostart", ".local/bin", ".local/share/applications"]
        if p["realtime"] or p["downloads"]:
            folders.append("Downloads")
        for name in folders:
            path = os.path.join(HOME, name)
            if not os.path.isdir(path):
                continue
            try:
                mon = Gio.File.new_for_path(path).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, None)
            except GLib.Error:
                continue
            mon.connect("changed", self.sec_file_changed)
            self.sec_monitors.append(mon)

    def sec_file_changed(self, _mon, f, other, event):
        E = Gio.FileMonitorEvent
        target = other if event in (E.RENAMED, E.MOVED_IN) and other else f
        if event == E.MOVED_IN:
            target = f
        if event not in (E.CHANGES_DONE_HINT, E.RENAMED, E.MOVED_IN, E.CREATED):
            return
        path = target.get_path() if target else None
        if not path or SKIP.search(path) or not os.path.exists(path):
            return
        if event == E.CREATED and os.path.isfile(path):
            return  # a file being written: its CHANGES_DONE_HINT follows
        self.sec_rt_queue.add(path)
        if self.sec_rt_timer:
            GLib.source_remove(self.sec_rt_timer)
        self.sec_rt_timer = GLib.timeout_add(1500, self.sec_rt_flush)

    def sec_rt_flush(self):
        self.sec_rt_timer = 0
        if self.sec_rt_busy:
            self.sec_rt_timer = GLib.timeout_add(2000, self.sec_rt_flush)
            return False
        paths = sorted(p for p in self.sec_rt_queue if os.path.exists(p))
        self.sec_rt_queue = set()
        if not paths:
            return False
        self.sec_rt_busy = True

        def work():
            try:
                scan = Scan("realtime", paths, lambda st: None, prefs()["puaDownloads"], realtime=True)
                state = scan.run()
                self.sec_scan_done(state, auto=True)
                print("nimbus-shell: real-time protection scanned %d files, %d threats" % (state["scanned"], len(state["threats"])))
            except Exception as exc:
                print("nimbus-shell: real-time protection:", exc)
            finally:
                self.sec_rt_busy = False
        threading.Thread(target=work, daemon=True).start()
        return False

    # ---- firewall ----
    def m_firewallStatus(self, _args):
        return {"firewall": firewall_status(), "network": self.sec_network()}

    def m_firewallSet(self, args):
        """Change the firewall: what = enabled|block (for a profile), app (allowed app for a profile), port, reset."""
        what = args.get("what")
        profile = args.get("profile")
        if what in ("enabled", "block"):
            helper("firewall", "set", profile, what, "on" if args.get("on") else "off")
        elif what == "app":
            helper("firewall", "app", args.get("app"), profile, "on" if args.get("on") else "off")
        elif what == "port":
            if args.get("remove"):
                helper("firewall", "port", "remove", args.get("app"))
            else:
                helper("firewall", "port", "add", args.get("ports"), args.get("proto"), (args.get("name") or "")[:60])
        elif what == "reset":
            helper("firewall", "reset")
        else:
            raise SecurityError("Unknown firewall setting")
        self.firewall_follow()
        _history_add({"kind": "firewall", "title": "Firewall settings changed", "detail": args.get("label") or what, "severity": "info", "status": "done"})
        return firewall_status()

    def m_networkProfile(self, args):
        conn = self.sec_network() if not args.get("uuid") else {"uuid": args.get("uuid")}
        if not conn:
            raise SecurityError("Not connected")
        if args.get("profile"):
            set_network_profile(conn["uuid"], args.get("profile"))
            self.firewall_follow()
        return network_profile(conn["uuid"])

    def firewall_follow(self):
        """Apply the firewall settings of the network profile in use (Public unless the network was made Private)."""
        net = self.sec_network()
        try:
            helper("firewall", "apply", net["profile"] if net else "public", timeout=120)
        except SecurityError as exc:
            print("nimbus-shell: firewall:", exc)

    # ---- the device ----
    def m_securityDevice(self, _args):
        return {"secureBoot": secure_boot(), "tpm": tpm(), "lockdown": kernel_lockdown(), "mitigations": mitigations(),
                "uefi": os.path.isdir("/sys/firmware/efi")}

    def m_securityHealth(self, _args):
        return health()

    # ---- boot tests: a harmless test signature instead of the real definitions (no 200 MB download) ----
    def m_securityTestSetup(self, _args):
        global DB_DIR
        if not _test_mode():
            raise SecurityError("Only for tests")
        DB_DIR = os.path.join(SEC_DIR, "test-db")
        os.makedirs(DB_DIR, exist_ok=True)
        # the industry's standard test file (EICAR), stored scrambled here so nothing mistakes this file for it
        sample = test_sample()
        with open(os.path.join(DB_DIR, "nimbus-test.hdb"), "w") as f:
            f.write("44d88612fea8a8f36de82e1278abb02f:68:Nimbus.Test.EICAR\n")
        self.sec_watch()
        return {"db": DB_DIR, "size": len(sample)}

    def m_securityTestFile(self, args):
        """Boot tests only: put the test file somewhere (real-time protection or a scan should find it)."""
        if not _test_mode():
            raise SecurityError("Only for tests")
        folder = os.path.expanduser(str(args.get("folder") or "~/Downloads"))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, os.path.basename(str(args.get("name") or "test-sample.com")))
        with open(path + ".part", "wb") as f:
            f.write(test_sample())
        os.rename(path + ".part", path)  # arrives whole, like a finished download
        return path
