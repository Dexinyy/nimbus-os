"""The Store behind Nimbus's Store app: programs from Flathub (flatpak, installed for this user only, no password),
and Windows game launchers (Battle.net, EA app, Ubisoft Connect) set up through Lutris, which runs them with Wine.

StoreMethods is mixed into nimbus-shell's Shell like nimbus_sys.SysMethods: each m_<name> answers the page's
Native.call('<name>') on a worker thread, and progress goes to the page as 'native:store-progress' events.

The catalog is Flathub's AppStream data, which flatpak downloads (about 30 MB the first time, then only changes);
it is read into a small index in ~/.cache/nimbus/store so searching is instant and works offline."""
import configparser
import glob
import gzip
import html
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import threading
import time
import xml.etree.ElementTree as ET

from gi.repository import GLib

try:
    import gi
    gi.require_version("Flatpak", "1.0")
    from gi.repository import Flatpak, Gio
except (ImportError, ValueError):
    Flatpak = None

FLATHUB = "flathub"
FLATHUB_REPO = "https://dl.flathub.org/repo/flathub.flatpakrepo"
FLATPAK = "/usr/bin/flatpak"
USER_DATA = GLib.get_user_data_dir()
FP_USER = os.path.join(USER_DATA, "flatpak")
EXPORTS = [os.path.join(FP_USER, "exports", "share"), "/var/lib/flatpak/exports/share"]
CACHE = os.path.join(GLib.get_user_cache_dir(), "nimbus", "store")
INDEX = os.path.join(CACHE, "catalog.json")
LUTRIS = "net.lutris.Lutris"
LUTRIS_DB = os.path.join(os.path.expanduser("~"), ".var", "app", LUTRIS, "data", "lutris", "pga.db")
LUTRIS_ICONS = os.path.join(os.path.expanduser("~"), ".var", "app", LUTRIS, "data", "icons", "hicolor", "128x128", "apps")

# Windows game launchers Lutris installs (with Wine, in its own sandbox): its install scripts do the work
LAUNCHERS = {
    "battlenet": {
        "name": "Battle.net", "dev": "Blizzard Entertainment", "cats": ["Game"], "wmclass": r"battle\.net|blizzard|agent\.exe",
        "summary": "Play Blizzard games: Overwatch 2, Diablo IV, World of Warcraft, Hearthstone, Call of Duty and more",
        "desc": ["Battle.net is Blizzard's launcher for installing, updating and playing their games, and for chatting with friends.",
                 "Battle.net is a Windows program. Nimbus sets it up with Lutris, which runs it with Wine: Lutris opens and "
                 "walks you through installing it (a few clicks). After that, Battle.net is in Start like your other apps.",
                 "Some games' anti-cheat doesn't work outside Windows; check a game on ProtonDB before buying it."],
    },
    "ea-app": {
        "name": "EA app", "dev": "Electronic Arts", "cats": ["Game"], "wmclass": r"eadesktop|ea app|eabackground",
        "summary": "Play EA games: EA SPORTS FC, Battlefield, The Sims, Apex Legends and more",
        "desc": ["The EA app installs and launches games from Electronic Arts.",
                 "It is a Windows program: Nimbus sets it up with Lutris, which runs it with Wine. Lutris opens and walks you "
                 "through installing it."],
    },
    "ubisoft-connect": {
        "name": "Ubisoft Connect", "dev": "Ubisoft", "cats": ["Game"], "wmclass": r"upc\.exe|ubisoft",
        "summary": "Play Ubisoft games: Assassin's Creed, Far Cry, Rainbow Six and more",
        "desc": ["Ubisoft Connect installs and launches games from Ubisoft.",
                 "It is a Windows program: Nimbus sets it up with Lutris, which runs it with Wine. Lutris opens and walks you "
                 "through installing it."],
    },
}

# What the Store shows first: well-known apps, and what search ranks higher when names match equally well
GAMING = ["com.valvesoftware.Steam", "lutris:battlenet", "com.discordapp.Discord", "com.heroicgameslauncher.hgl",
          "lutris:ea-app", "lutris:ubisoft-connect", "net.lutris.Lutris", "com.usebottles.bottles", "org.prismlauncher.PrismLauncher",
          "org.libretro.RetroArch", "net.davidotek.pupgui2", "io.github.limo_app.limo", "com.obsproject.Studio"]
ESSENTIALS = ["com.discordapp.Discord", "com.spotify.Client", "org.videolan.VLC", "org.mozilla.firefox",
              "org.libreoffice.LibreOffice", "com.visualstudio.code", "org.gimp.GIMP", "org.telegram.desktop", "us.zoom.Zoom",
              "org.mozilla.Thunderbird", "org.signal.Signal", "com.slack.Slack", "org.audacityteam.Audacity",
              "org.blender.Blender", "org.kde.krita", "com.obsproject.Studio", "org.inkscape.Inkscape", "md.obsidian.Obsidian",
              "com.github.tchx84.Flatseal", "org.kde.kdenlive", "io.github.shiftey.Desktop", "com.bitwarden.desktop",
              "org.qbittorrent.qBittorrent", "com.brave.Browser", "com.microsoft.Edge", "org.chromium.Chromium"]
POPULAR = list(dict.fromkeys(GAMING + ESSENTIALS))

_lock = threading.Lock()
_catalog = None          # the index, read once
_jobs = {}               # id -> Gio.Cancellable of installs and updates going on


class StoreError(Exception):
    pass


def available():
    return os.access(FLATPAK, os.X_OK)


def _env():
    e = {k: v for k, v in os.environ.items() if k not in ("NIMBUS_WM_FD", "WAYLAND_SOCKET", "NIMBUS_TEST")}
    e.setdefault("LC_ALL", "C.UTF-8")
    return e


def _flatpak(*args, timeout=600):
    try:
        r = subprocess.run([FLATPAK, *args], capture_output=True, text=True, timeout=timeout, env=_env())
    except FileNotFoundError:
        raise StoreError("Flatpak isn't installed")
    except subprocess.TimeoutExpired:
        raise StoreError("Flathub took too long to answer")
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "flatpak failed").strip().splitlines()
        raise StoreError(re.sub(r"^error:\s*", "", msg[-1] if msg else "flatpak failed", flags=re.I)[:300])
    return r.stdout


def arch():
    if Flatpak:
        try:
            return Flatpak.get_default_arch()
        except Exception:
            pass
    return {"aarch64": "aarch64", "arm64": "aarch64"}.get(os.uname().machine, "x86_64")


def file_uri(path):
    return GLib.filename_to_uri(path, None) if path else None


def image_data_url(path):
    import base64
    try:
        with open(path, "rb") as f:
            data = f.read(512 * 1024)
    except OSError:
        return None
    mime = "image/svg+xml" if path.endswith(".svg") else "image/png"
    return "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())


# ---------- the catalog (Flathub's AppStream data) ----------

def _appstream_dir():
    return os.path.join(FP_USER, "appstream", FLATHUB, arch(), "active")


def _appstream_file():
    d = _appstream_dir()
    for name in ("appstream.xml.gz", "appstream.xml"):
        if os.path.exists(os.path.join(d, name)):
            return os.path.join(d, name)
    return None


def remote_ready():
    try:
        return FLATHUB in _flatpak("remotes", "--user", "--columns=name", timeout=30).split()
    except StoreError:
        return False


def ensure_remote():
    if not available():
        raise StoreError("Flatpak isn't installed")
    if not remote_ready():
        _flatpak("remote-add", "--user", "--if-not-exists", FLATHUB, FLATHUB_REPO, timeout=120)


def _text(el):
    return (el.text or "").strip() if el is not None else ""


def _untranslated(parent, tag):
    """The element in the default language (AppStream repeats names and summaries per language)."""
    best = None
    for el in parent.findall(tag):
        if not el.get("{http://www.w3.org/XML/1998/namespace}lang"):
            return el
        best = best if best is not None else el
    return best


def _desc_html(el):
    """AppStream's description markup, rebuilt with only safe tags (the text comes from app developers)."""
    if el is None:
        return ""
    out = []

    def inline(node):
        s = html.escape(node.text or "")
        for child in node:
            inner = inline(child)
            s += "<%s>%s</%s>" % (child.tag, inner, child.tag) if child.tag in ("em", "code") else inner
            s += html.escape(child.tail or "")
        return s

    for node in el:
        if node.get("{http://www.w3.org/XML/1998/namespace}lang"):
            continue
        if node.tag == "p":
            out.append("<p>%s</p>" % inline(node).strip())
        elif node.tag in ("ul", "ol"):
            items = "".join("<li>%s</li>" % inline(li).strip() for li in node.findall("li")
                            if not li.get("{http://www.w3.org/XML/1998/namespace}lang"))
            out.append("<%s>%s</%s>" % (node.tag, items, node.tag))
    return "".join(out)[:20000]


def _component(c, icons_dir):
    kind = c.get("type", "")
    if kind not in ("desktop-application", "desktop", "console-application"):
        return None
    app_id = _text(c.find("id"))
    if app_id.endswith(".desktop"):
        app_id = app_id[:-len(".desktop")]
    bundle = c.find("bundle")
    if not app_id or (bundle is not None and not _text(bundle).startswith("app/")):
        return None
    name, summary = _text(_untranslated(c, "name")), _text(_untranslated(c, "summary"))
    if not name:
        return None
    dev = _text(_untranslated(c, "developer_name"))
    dev_el = c.find("developer")
    if not dev and dev_el is not None:
        dev = _text(_untranslated(dev_el, "name"))
    icon = None
    for ic in c.findall("icon"):
        if ic.get("type") == "cached" and ic.text:
            for size in ("128x128", "64x64"):
                p = os.path.join(icons_dir, size, ic.text.strip())
                if os.path.exists(p):
                    icon = p
                    break
        if icon:
            break
    remote_icon = next((_text(ic) for ic in c.findall("icon") if ic.get("type") == "remote"), None)
    shots = []
    for sc in c.findall("screenshots/screenshot"):
        imgs = [(int(i.get("width") or 0), _text(i), i.get("type")) for i in sc.findall("image") if _text(i)]
        if not imgs:
            continue
        src = next((u for _w, u, t in imgs if t == "source"), imgs[0][1])
        thumbs = sorted([(w, u) for w, u, t in imgs if t == "thumbnail" and w >= 300], key=lambda x: x[0])
        shots.append({"thumb": thumbs[0][1] if thumbs else src, "full": src, "caption": _text(_untranslated(sc, "caption"))})
        if len(shots) >= 8:
            break
    rel = c.find("releases/release")
    custom = {v.get("key"): _text(v) for v in c.findall("custom/value")}
    rating = c.find("content_rating")
    mature = 0
    if rating is not None:
        levels = {"none": 0, "mild": 1, "moderate": 2, "intense": 3}
        mature = max([levels.get(_text(a), 0) for a in rating.findall("content_attribute")] or [0])
    return {
        "id": app_id, "name": name, "summary": summary, "dev": dev,
        "cats": [_text(x) for x in c.findall("categories/category")][:8],
        "kw": [_text(x).lower() for x in c.findall("keywords/keyword") if not x.get("{http://www.w3.org/XML/1998/namespace}lang")][:20],
        "icon": icon, "iconUrl": remote_icon, "desc": _desc_html(_untranslated(c, "description")),
        "shots": shots, "license": _text(c.find("project_license")),
        "homepage": next((_text(u) for u in c.findall("url") if u.get("type") == "homepage"), ""),
        "version": rel.get("version", "") if rel is not None else "",
        "date": int(rel.get("timestamp") or 0) if rel is not None and (rel.get("timestamp") or "").isdigit() else 0,
        "verified": custom.get("flathub::verification::verified") == "true",
        "mature": mature,
    }


def build_index(path):
    icons = os.path.join(os.path.dirname(path), "icons")
    apps = {}
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as f:
        for _event, el in ET.iterparse(f, events=("end",)):
            if el.tag != "component":
                continue
            try:
                app = _component(el, icons)
            except Exception:
                app = None
            if app and app["id"] not in apps:
                apps[app["id"]] = app
            el.clear()
    return apps


def catalog(refresh=False, progress=None):
    """The index of Flathub's apps, downloading or refreshing the catalog when asked or when there is none."""
    global _catalog
    with _lock:
        src = _appstream_file()
        if refresh or not src:
            ensure_remote()
            if progress:
                progress("Getting the list of apps from Flathub", None)
            _flatpak("update", "--user", "--appstream", "--noninteractive", FLATHUB, timeout=900)
            src = _appstream_file()
            if not src:
                raise StoreError("Flathub's list of apps didn't arrive")
        stamp = os.path.getmtime(src)
        if _catalog and _catalog.get("stamp") == stamp:
            return _catalog
        try:
            with open(INDEX) as f:
                cached = json.load(f)
            if cached.get("stamp") == stamp and cached.get("version") == 2:
                _catalog = cached
                return _catalog
        except (OSError, ValueError):
            pass
        if progress:
            progress("Reading the list of apps", None)
        _catalog = {"version": 2, "stamp": stamp, "updated": int(time.time()), "apps": build_index(src)}
        os.makedirs(CACHE, exist_ok=True)
        tmp = INDEX + ".tmp"
        with open(tmp, "w") as f:
            json.dump(_catalog, f)
        os.replace(tmp, INDEX)
        return _catalog


def catalog_age():
    src = _appstream_file()
    return int(time.time() - os.path.getmtime(src)) if src else None


# ---------- what is installed ----------

def _desktop_entries():
    """Programs' .desktop files that flatpak exported (one app can have several, LibreOffice's for example)."""
    seen = {}
    for share in EXPORTS:
        for path in sorted(glob.glob(os.path.join(share, "applications", "*.desktop"))):
            fid = os.path.basename(path)[:-len(".desktop")]
            if fid in seen:
                continue
            cp = configparser.RawConfigParser(strict=False, interpolation=None)
            try:
                cp.read(path, encoding="utf-8")
                e = cp["Desktop Entry"]
            except (configparser.Error, KeyError, UnicodeDecodeError, OSError):
                continue
            if e.get("NoDisplay", "").lower() == "true" or e.get("Hidden", "").lower() == "true" or e.get("Type", "Application") != "Application":
                continue
            seen[fid] = (path, e, share)
    return seen


def _export_icon(name, share):
    if not name:
        return None
    if name.startswith("/"):
        return name if os.path.exists(name) else None
    for base in [share] + [s for s in EXPORTS if s != share] + ["/usr/share"]:
        for size in ("256x256", "128x128", "96x96", "64x64", "48x48", "scalable"):
            for ext in ("png", "svg"):
                p = os.path.join(base, "icons", "hicolor", size, "apps", "%s.%s" % (name, ext))
                if os.path.exists(p):
                    return p
    return None


def installed_flatpaks():
    """app id -> {version, size, origin} of the apps flatpak installed for this user (and for everyone)."""
    out = {}
    if Flatpak:
        try:
            for inst in [Flatpak.Installation.new_user(None)] + list(Flatpak.get_system_installations(None)):
                for ref in inst.list_installed_refs_by_kind(Flatpak.RefKind.APP, None):
                    out.setdefault(ref.get_name(), {
                        "version": ref.get_appdata_version() or "", "size": ref.get_installed_size(),
                        "origin": ref.get_origin(), "user": inst.get_is_user(), "branch": ref.get_branch(),
                        "name": ref.get_appdata_name() or "", "summary": ref.get_appdata_summary() or ""})
            return out
        except Exception:
            out = {}
    if not available():
        return out
    try:
        text = _flatpak("list", "--app", "--columns=application,version,size,origin,installation", timeout=60)
    except StoreError:
        return out
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) >= 5 and cols[0]:
            out.setdefault(cols[0], {"version": cols[1], "size": _parse_size(cols[2]), "origin": cols[3], "user": cols[4] == "user",
                                     "branch": "stable", "name": "", "summary": ""})
    return out


def _parse_size(text):
    m = re.match(r"([\d.,]+)\s*([kMGT]?)B", text.replace("\xa0", " ").strip())
    if not m:
        return 0
    return int(float(m.group(1).replace(",", ".")) * {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}[m.group(2)])


def lutris_games():
    """Games and launchers Lutris has installed: slug -> {name, icon}."""
    if not os.path.exists(LUTRIS_DB):
        return {}
    try:
        con = sqlite3.connect("file:%s?mode=ro" % LUTRIS_DB, uri=True, timeout=2)
        try:
            rows = con.execute("SELECT slug, name FROM games WHERE installed = 1").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    games = {}
    for slug, name in rows:
        if not slug:
            continue
        icon = next((p for p in (os.path.join(LUTRIS_ICONS, "lutris_%s.png" % slug),) if os.path.exists(p)), None)
        games[slug] = {"name": name or slug, "icon": icon}
    return games


def programs():
    """Everything Start lists as a program: Flathub apps (each .desktop file they export), and Lutris's games."""
    flatpaks = installed_flatpaks()
    items = []
    for fid, (path, e, share) in _desktop_entries().items():
        app = e.get("X-Flatpak", "") or fid
        if app not in flatpaks and not any(fid.startswith(a) for a in flatpaks):
            continue
        info = flatpaks.get(app, {})
        icon = _export_icon(e.get("Icon", ""), share)
        items.append({
            "id": "fp:" + fid, "app": app, "name": e.get("Name", fid), "desc": e.get("Comment", "") or info.get("summary", ""),
            "icon": image_data_url(icon) if icon else None, "wmclass": e.get("StartupWMClass", ""),
            "cats": [c for c in e.get("Categories", "").split(";") if c], "keywords": e.get("Keywords", "").replace(";", " "),
            "version": info.get("version", ""), "size": info.get("size", 0), "user": info.get("user", True), "kind": "flatpak",
        })
    for slug, g in lutris_games().items():
        meta = LAUNCHERS.get(slug, {})
        items.append({
            "id": "lutris:" + slug, "app": LUTRIS, "name": meta.get("name") or g["name"], "desc": meta.get("summary", "Played with Lutris"),
            "icon": image_data_url(g["icon"]) if g.get("icon") else None, "wmclass": meta.get("wmclass", ""),
            "cats": meta.get("cats", ["Game"]), "keywords": "game lutris wine windows", "version": "", "size": 0, "user": True,
            "kind": "lutris",
        })
    return items


def program_argv(pid):
    """The command that starts a program from programs()"""
    if pid.startswith("lutris:"):
        slug = pid[len("lutris:"):]
        if not re.match(r"^[a-z0-9-]{1,80}$", slug):
            raise StoreError("Unknown program")
        return [FLATPAK, "run", LUTRIS, "lutris:rungame/" + slug]
    if not pid.startswith("fp:"):
        raise StoreError("Unknown program")
    fid = pid[3:]
    entry = _desktop_entries().get(fid)
    if not entry:
        raise StoreError("That program isn't installed anymore")
    path, e, _share = entry
    try:
        argv = shlex.split(e.get("Exec", ""))
    except ValueError:
        argv = []
    argv = [a for a in argv if not re.match(r"^(%[fFuUick]|@@[fu]?)$", a)]
    if not argv or os.path.basename(argv[0]) != "flatpak":
        app = e.get("X-Flatpak", "") or fid
        argv = [FLATPAK, "run", app]
    return argv


def flatpak_of_pid(pid):
    """Which Flathub app a process belongs to (it runs in that app's sandbox), or None."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return None
    if pid <= 1:
        return None
    try:
        with open("/proc/%d/cgroup" % pid) as f:
            m = re.search(r"app-flatpak-([A-Za-z0-9_.-]+?)-\d+\.scope", f.read())
        if m:
            return m.group(1)
    except OSError:
        pass
    try:
        cp = configparser.RawConfigParser(strict=False, interpolation=None)
        cp.read("/proc/%d/root/.flatpak-info" % pid, encoding="utf-8")
        return cp.get("Application", "name", fallback=None)
    except (configparser.Error, OSError, UnicodeDecodeError):
        return None


# ---------- installing, updating, removing ----------

class Job:
    """A flatpak transaction (libflatpak), reporting progress as it goes: report(progress 0-100 or None, text)."""

    def __init__(self, report, cancellable=None, names=None):
        self.report = report
        self.cancellable = cancellable
        self.error = None
        self.names = names or {}  # app id -> its name, for the progress text

    def run(self, add):
        inst = Flatpak.Installation.new_user(None)
        t = Flatpak.Transaction.new_for_installation(inst, self.cancellable)
        try:
            t.set_no_interaction(True)
        except AttributeError:
            pass
        t.set_default_arch(arch())
        add(t, inst)
        ops = {"done": 0, "sizes": []}

        def ready(tr):
            sizes = []
            for op in tr.get_operations():
                try:
                    sizes.append(max(1, op.get_download_size()))
                except Exception:
                    sizes.append(1)
            ops["sizes"] = sizes or [1]
            return True

        def new_op(tr, op, progress):
            index = ops["done"]
            total = float(sum(ops["sizes"])) or 1.0
            before = sum(ops["sizes"][:index])
            mine = ops["sizes"][index] if index < len(ops["sizes"]) else 1
            what = {Flatpak.TransactionOperationType.INSTALL: "Installing",
                    Flatpak.TransactionOperationType.UPDATE: "Updating",
                    Flatpak.TransactionOperationType.UNINSTALL: "Removing"}.get(op.get_operation_type(), "Working on")
            ref = op.get_ref().split("/")
            if ref[0] == "runtime":  # what apps run on, shared between them: the platform, drivers, translations
                label = "%s what it needs (%s)" % ({"Installing": "Getting", "Updating": "Updating"}.get(what, "Removing"),
                                                   ref[1].split(".")[-1] if len(ref) > 1 else "runtime")
            else:
                label = "%s %s" % (what, self.names.get(ref[1], ref[1]) if len(ref) > 1 else op.get_ref())
            try:
                progress.set_update_frequency(400)
            except Exception:
                pass

            def changed(p):
                pct = 100.0 * (before + mine * p.get_progress() / 100.0) / total
                self.report(min(99.0, pct), label)
            progress.connect("changed", changed)
            self.report(100.0 * before / total, label)

        def op_done(tr, op, commit, result):
            ops["done"] += 1

        def op_error(tr, op, err, details):
            if details & Flatpak.TransactionErrorDetails.NON_FATAL:
                return True  # an optional part (translations, a debug extension) can fail
            self.error = err.message if hasattr(err, "message") else str(err)
            return False

        t.connect("ready", ready)
        t.connect("new-operation", new_op)
        t.connect("operation-done", op_done)
        t.connect("operation-error", op_error)
        try:
            t.connect("choose-remote-for-ref", lambda tr, ref, runtime, remotes: 0)
        except TypeError:
            pass
        try:
            t.run(self.cancellable)
        except GLib.Error as exc:
            if self.cancellable and self.cancellable.is_cancelled():
                raise StoreError("Cancelled")
            msg = self.error or exc.message
            if "already installed" in msg.lower():
                return
            if "nothing to do" in msg.lower():
                return
            raise StoreError(msg)


def _ref(app_id):
    return "app/%s/%s/stable" % (app_id, arch())


def _check_id(app_id):
    if not re.match(r"^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2,}$", str(app_id or "")) or len(app_id) > 255:
        raise StoreError("Unknown app")
    return app_id


def install(app_id, report, cancellable=None):
    _check_id(app_id)
    ensure_remote()
    if Flatpak:
        try:
            names = {app_id: catalog()["apps"][app_id]["name"]}
        except (KeyError, StoreError, OSError, ValueError):
            names = {}
        Job(report, cancellable, names).run(lambda t, inst: t.add_install(FLATHUB, _ref(app_id), None))
    else:
        report(None, "Installing")
        _flatpak("install", "--user", "-y", "--noninteractive", FLATHUB, _ref(app_id), timeout=7200)


def uninstall(app_id, report, data=False):
    _check_id(app_id)
    if Flatpak:
        Job(report).run(lambda t, inst: t.add_uninstall(_ref(app_id)))
        # what the app needed that nothing else uses anymore goes too (runtimes are big)
        try:
            inst = Flatpak.Installation.new_user(None)
            unused = [r.format_ref() for r in inst.list_unused_refs(None, None)]
            if unused:
                Job(lambda *_: None).run(lambda t, _inst: [t.add_uninstall(r) for r in unused])
        except Exception:
            pass
    else:
        _flatpak("uninstall", "--user", "-y", "--noninteractive", app_id, timeout=600)
        try:
            _flatpak("uninstall", "--user", "-y", "--noninteractive", "--unused", timeout=600)
        except StoreError:
            pass
    if data:
        shutil.rmtree(os.path.join(os.path.expanduser("~"), ".var", "app", app_id), ignore_errors=True)


def updates():
    """Apps (and what they run on) with an update waiting: [{app, name}]"""
    if not available() or not remote_ready():
        return []
    out = []
    if Flatpak:
        try:
            inst = Flatpak.Installation.new_user(None)
            for ref in inst.list_installed_refs_for_update(None):
                out.append({"ref": ref.format_ref(), "app": ref.get_name(), "kind": "app" if ref.get_kind() == Flatpak.RefKind.APP else "runtime",
                            "name": ref.get_appdata_name() or ref.get_name()})
            return out
        except Exception:
            pass
    try:
        text = _flatpak("remote-ls", "--user", "--updates", "--columns=application,ref,name", timeout=120)
    except StoreError:
        return []
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) >= 2 and cols[0]:
            out.append({"ref": cols[1], "app": cols[0], "kind": "app" if cols[1].startswith("app/") else "runtime",
                        "name": cols[2] if len(cols) > 2 else cols[0]})
    return out


def update(refs, report, cancellable=None):
    if Flatpak:
        Job(report, cancellable).run(lambda t, inst: [t.add_update(r, None, None) for r in refs])
    else:
        report(None, "Updating")
        _flatpak("update", "--user", "-y", "--noninteractive", *[r.split("/")[1] for r in refs if "/" in r], timeout=7200)


def remote_size(app_id):
    """(download size, installed size) of an app from Flathub, without what it shares with others."""
    if not Flatpak:
        return None
    try:
        inst = Flatpak.Installation.new_user(None)
        ref = inst.fetch_remote_ref_sync(FLATHUB, Flatpak.RefKind.APP, app_id, arch(), "stable", None)
        return ref.get_download_size(), ref.get_installed_size()
    except Exception:
        return None


def permissions(app_id):
    """What an app's sandbox lets it reach, in words, from Flathub's metadata for it."""
    if not Flatpak:
        return []
    try:
        inst = Flatpak.Installation.new_user(None)
        ref = inst.fetch_remote_ref_sync(FLATHUB, Flatpak.RefKind.APP, app_id, arch(), "stable", None)
        meta = ref.get_metadata()
        text = meta.get_data().decode() if meta else ""
    except Exception:
        return []
    cp = configparser.RawConfigParser(strict=False, interpolation=None)
    try:
        cp.read_string(text)
    except configparser.Error:
        return []
    ctx = {k: [x for x in cp.get("Context", k, fallback="").split(";") if x] for k in ("shared", "sockets", "devices", "filesystems")}
    out = []
    if "network" in ctx["shared"]:
        out.append("Your internet connection")
    fs = ctx["filesystems"]
    if any(f.split(":")[0] in ("host", "host-os") for f in fs):
        out.append("All your files and the system's")
    elif any(f.split(":")[0] in ("home", "~") for f in fs):
        out.append("All the files in your home folder")
    elif any(f.startswith("xdg-") for f in fs):
        out.append("Some of your folders (%s)" % ", ".join(sorted({f.split(":")[0].replace("xdg-", "").split("/")[0] for f in fs if f.startswith("xdg-")})))
    if "all" in ctx["devices"]:
        out.append("Devices like game controllers, cameras and USB devices")
    elif "dri" in ctx["devices"]:
        out.append("Your graphics card")
    if "pulseaudio" in ctx["sockets"]:
        out.append("Your speakers and microphone")
    if "x11" in ctx["sockets"] and "wayland" not in ctx["sockets"]:
        out.append("The X11 display (other X11 programs' windows)")
    if "ssh-auth" in ctx["sockets"]:
        out.append("Your SSH keys")
    talk = cp.get("Session Bus Policy", "org.freedesktop.Flatpak", fallback="")
    if talk == "talk":
        out.append("Starting programs outside its sandbox")
    if not out:
        out.append("Nothing outside its sandbox")
    return out


# ---------- searching ----------

def _launcher_item(slug):
    meta = LAUNCHERS[slug]
    return {"id": "lutris:" + slug, "name": meta["name"], "summary": meta["summary"], "dev": meta["dev"], "cats": meta["cats"],
            "icon": None, "iconUrl": None, "verified": False, "via": "Lutris"}


def summary(app):
    """What a list of apps shows of each"""
    return {"id": app["id"], "name": app["name"], "summary": app.get("summary", ""), "dev": app.get("dev", ""),
            "cats": app.get("cats", [])[:3], "icon": file_uri(app.get("icon")) if app.get("icon") else None,
            "iconUrl": app.get("iconUrl"), "verified": app.get("verified", False), "mature": app.get("mature", 0)}


def search(query, category=None, limit=60):
    cat = catalog()["apps"]
    q = query.strip().lower()
    words = [w for w in re.split(r"\s+", q) if w]
    results = []
    popular = {a: len(POPULAR) - i for i, a in enumerate(POPULAR)}
    for slug, meta in LAUNCHERS.items():
        hay = (meta["name"] + " " + meta["summary"] + " " + slug).lower()
        if words and all(w in hay for w in words):
            results.append((200 if q in meta["name"].lower() else 60, _launcher_item(slug)))
        elif not words and (not category or category in meta["cats"]):
            results.append((popular.get("lutris:" + slug, 0) * 0.6, _launcher_item(slug)))
    for app in cat.values():
        if category and category not in app["cats"]:
            continue
        name = app["name"].lower()
        score = 0
        if words:
            hay_kw = " ".join(app["kw"])
            for w in words:
                if name == q:
                    s = 120
                elif name.startswith(w):
                    s = 70
                elif re.search(r"\b" + re.escape(w), name):
                    s = 55
                elif w in name:
                    s = 40
                elif w in app["id"].lower():
                    s = 30
                elif w in hay_kw:
                    s = 22
                elif w in app["summary"].lower():
                    s = 10
                elif w in app["dev"].lower():
                    s = 8
                else:
                    s = 0
                if not s:
                    score = 0
                    break
                score += s
            if not score:
                continue
        score += popular.get(app["id"], 0) * 0.6 + (4 if app.get("verified") else 0)
        results.append((score, summary(app)))
    results.sort(key=lambda r: (-r[0], r[1]["name"].lower()))
    return [r[1] for r in results[:limit]]


def collection(ids):
    cat = catalog()["apps"]
    out = []
    for app_id in ids:
        if app_id.startswith("lutris:"):
            out.append(_launcher_item(app_id[7:]))
        elif app_id in cat:
            out.append(summary(cat[app_id]))
    return out


def details(app_id):
    if app_id.startswith("lutris:"):
        slug = app_id[7:]
        if slug not in LAUNCHERS:
            raise StoreError("Unknown app")
        meta = LAUNCHERS[slug]
        item = _launcher_item(slug)
        item.update({"desc": "".join("<p>%s</p>" % html.escape(p) for p in meta["desc"]), "shots": [], "license": "Proprietary",
                     "homepage": "", "version": "", "date": 0, "needs": LUTRIS,
                     "installed": slug in lutris_games(), "lutrisInstalled": LUTRIS in installed_flatpaks()})
        return item
    app = catalog()["apps"].get(_check_id(app_id))
    if not app:
        raise StoreError("Flathub doesn't have this app")
    item = summary(app)
    flatpaks = installed_flatpaks()
    item.update({k: app.get(k) for k in ("desc", "shots", "license", "homepage", "version", "date")})
    item["installed"] = app_id in flatpaks
    if item["installed"]:
        item["installedVersion"] = flatpaks[app_id].get("version", "")
        item["installedSize"] = flatpaks[app_id].get("size", 0)
    return item


# ---------- the page's calls ----------

class StoreMethods:
    """Mixed into nimbus-shell's Shell. self.launch(argv) starts a program (nimbus-shell's spawn)."""

    def store_event(self, app_id, progress=None, text="", state="working", error=None):
        data = {"id": app_id, "progress": progress, "text": text, "state": state}
        if error:
            data["error"] = error
        GLib.idle_add(lambda: self.emit("store-progress", data) and False)

    def m_storeStatus(self, _args):
        return {"flatpak": available(), "remote": available() and remote_ready(), "catalogAge": catalog_age(),
                "jobs": sorted(_jobs), "libflatpak": bool(Flatpak)}

    def m_storeCatalog(self, args):
        c = catalog(refresh=bool(args.get("refresh")), progress=lambda text, p: self.store_event("", p, text, "catalog"))
        return {"count": len(c["apps"]), "updated": c.get("updated", 0)}

    def m_storeHome(self, _args):
        return {"gaming": collection(GAMING), "essentials": collection(ESSENTIALS)}

    def m_storeSearch(self, args):
        return search(str(args.get("q") or "")[:200], str(args.get("category") or "") or None, int(args.get("limit") or 60))

    def m_storeApp(self, args):
        app_id = str(args.get("id") or "")
        item = details(app_id)
        if not app_id.startswith("lutris:"):
            sizes = remote_size(app_id)
            if sizes:
                item["download"], item["size"] = sizes
            item["permissions"] = permissions(app_id)
            item["update"] = any(u["app"] == app_id for u in updates()) if item.get("installed") else False
        item["busy"] = app_id in _jobs
        return item

    def m_storeInstall(self, args):
        app_id = str(args.get("id") or "")
        if app_id in _jobs:
            raise StoreError("Already installing")
        cancel = Gio.Cancellable() if Flatpak else None
        _jobs[app_id] = cancel
        report = lambda p, text: self.store_event(app_id, p, text)  # noqa: E731
        try:
            if app_id.startswith("lutris:"):
                slug = app_id[7:]
                if slug not in LAUNCHERS:
                    raise StoreError("Unknown app")
                if LUTRIS not in installed_flatpaks():
                    install(LUTRIS, lambda p, text: report(p, "Getting Lutris, which runs Windows programs: " + text.lower()), cancel)
                report(100, "Lutris opens to install %s" % LAUNCHERS[slug]["name"])
                self.launch([FLATPAK, "run", LUTRIS, "lutris:" + slug])
                result = {"installed": False, "lutris": True}
            else:
                install(_check_id(app_id), report, cancel)
                result = {"installed": True}
        except Exception as exc:
            self.store_event(app_id, None, "", "failed", str(exc))
            raise
        finally:
            _jobs.pop(app_id, None)
        self.store_event(app_id, 100, "", "done")
        GLib.idle_add(lambda: self.emit("programs-changed", {}) and False)
        return result

    def m_storeCancel(self, args):
        cancel = _jobs.get(str(args.get("id") or ""))
        if cancel:
            cancel.cancel()
        return bool(cancel)

    def m_storeRemove(self, args):
        app_id = str(args.get("id") or "")
        if app_id.startswith("lutris:"):
            raise StoreError("Remove it in Lutris (right-click it there, then Uninstall)")
        if app_id in _jobs:
            raise StoreError("It's being installed or updated")
        _jobs[app_id] = None
        try:
            uninstall(app_id, lambda p, text: self.store_event(app_id, p, text), bool(args.get("data")))
        finally:
            _jobs.pop(app_id, None)
        self.store_event(app_id, 100, "", "removed")
        GLib.idle_add(lambda: self.emit("programs-changed", {}) and False)
        return True

    def m_storeUpdates(self, _args):
        return updates()

    def m_storeUpdate(self, args):
        """Bring apps up to date: the ones asked for, or everything."""
        pending = updates()
        want = set(args.get("apps") or [])
        refs = [u["ref"] for u in pending if not want or u["app"] in want or u["kind"] == "runtime"]
        if not refs:
            return {"updated": 0}
        key = "updates"
        cancel = Gio.Cancellable() if Flatpak else None
        _jobs[key] = cancel
        try:
            update(refs, lambda p, text: self.store_event(key, p, text), cancel)
        except Exception as exc:
            self.store_event(key, None, "", "failed", str(exc))
            raise
        finally:
            _jobs.pop(key, None)
        self.store_event(key, 100, "", "done")
        GLib.idle_add(lambda: self.emit("programs-changed", {}) and False)
        return {"updated": len([u for u in pending if u["ref"] in refs and u["kind"] == "app"])}

    def m_programs(self, _args):
        return programs()

    def m_programLaunch(self, args):
        return self.launch(program_argv(str(args.get("id") or "")))

    def m_storeDiag(self, _args):
        """What sandboxes need, for boot tests and troubleshooting: user namespaces, and bubblewrap working."""
        def read(path):
            try:
                with open(path) as f:
                    return f.read().strip()
            except OSError:
                return "n/a"
        try:
            r = subprocess.run(["bwrap", "--ro-bind", "/", "/", "--unshare-user", "--unshare-pid", "--proc", "/proc", "true"],
                               capture_output=True, text=True, timeout=20)
            bwrap = "works" if r.returncode == 0 else (r.stderr.strip() or "exit %d" % r.returncode)[:200]
        except (OSError, subprocess.TimeoutExpired) as exc:
            bwrap = str(exc)
        log = os.path.join(GLib.get_user_cache_dir(), "nimbus", "programs.log")
        try:
            with open(log, errors="replace") as f:
                tail = f.read()[-6000:].splitlines()[-40:]
        except OSError:
            tail = []
        return {"restrictUserns": read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"),
                "maxUserns": read("/proc/sys/user/max_user_namespaces"), "bwrap": bwrap, "log": tail}
