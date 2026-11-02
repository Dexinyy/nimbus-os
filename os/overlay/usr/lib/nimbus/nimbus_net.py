"""Wi-Fi and network status for the Nimbus desktop, through NetworkManager's command line (nmcli).

Every function returns plain data for the page, or raises NetError with a message a person can act on.
"""
import os
import shutil
import subprocess


class NetError(Exception):
    pass


def split_terse(line):
    """Split one line of `nmcli -t` output: fields are separated by ':', with '\\:' and '\\\\' escaped."""
    out, cur, escaped = [], [], False
    for ch in line:
        if escaped:
            cur.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


def fields(line, count):
    parts = split_terse(line)
    return (parts + [""] * count)[:count]


def friendly(message, ssid=""):
    """Turn nmcli's error text into something a person can act on."""
    text = (message or "").strip()
    low = text.lower()
    if "secrets were required" in low or "802-1x supplicant failed" in low or "no secrets" in low or "authentication" in low:
        return "The password for %s isn't right." % (ssid or "this network")
    if "psk: property is invalid" in low or "invalid passphrase" in low or "key-mgmt" in low and "invalid" in low:
        return "Wi-Fi passwords have 8 to 63 characters."
    if "no network with ssid" in low or ("ssid" in low and "not found" in low):
        return "%s is out of range." % (ssid or "That network")
    if "timeout" in low or "timed out" in low:
        return "%s didn't answer in time. Try again closer to the router." % (ssid or "The network")
    if "ip configuration could not be reserved" in low or "dhcp" in low:
        return "Connected to %s, but it didn't give this PC an address." % (ssid or "the network")
    if "not authorized" in low or "insufficient privileges" in low:
        return "This account isn't allowed to change network settings."
    if "networkmanager is not running" in low or "could not create nmclient" in low:
        return "The network service isn't running."
    first = text.splitlines()[0] if text else "Something went wrong."
    return first[7:] if first.startswith("Error: ") else first


def nmcli(*args, timeout=25, check=True, ssid=""):
    try:
        r = subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout,
                           env=dict(os.environ, LC_ALL="C", LANG="C"))
    except FileNotFoundError:
        raise NetError("The network service isn't installed.")
    except subprocess.TimeoutExpired:
        raise NetError(friendly("timeout", ssid))
    if check and r.returncode != 0:
        raise NetError(friendly(r.stderr or r.stdout, ssid))
    return r.stdout


def available():
    return shutil.which("nmcli") is not None


def devices():
    out = []
    for line in nmcli("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status").splitlines():
        dev, typ, state, conn = fields(line, 4)
        if dev:
            out.append({"device": dev, "type": typ, "state": state, "connection": conn})
    return out


def saved_wifi():
    """Names of saved Wi-Fi connections (nmcli names them after the network)."""
    names = set()
    for line in nmcli("-t", "-f", "NAME,TYPE", "connection", "show").splitlines():
        name, typ = fields(line, 2)
        if typ in ("802-11-wireless", "wifi"):
            names.add(name)
    return names


def status():
    if not available():
        return {"available": False}
    devs = devices()
    wifi_devs = [d for d in devs if d["type"] == "wifi"]
    wired = [d for d in devs if d["type"] == "ethernet"]
    hw, wifi_on, wwan_on = "enabled", "enabled", "enabled"
    radio = nmcli("-t", "-f", "WIFI-HW,WIFI,WWAN", "radio", check=False).strip()
    if radio:
        hw, wifi_on, wwan_on = fields(radio, 3)
    connectivity = nmcli("-t", "-f", "CONNECTIVITY", "general", check=False).strip() or "unknown"
    active = next((d for d in wifi_devs if d["state"].startswith("connected")), None)
    connecting = next((d for d in wifi_devs if d["state"].startswith("connecting")), None)
    ssid, signal = "", 0
    if active:
        for line in nmcli("-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "ifname", active["device"],
                          "--rescan", "no", check=False).splitlines():
            act, s, sig = fields(line, 3)
            if act == "yes":
                ssid, signal = s, int(sig or 0)
                break
        ssid = ssid or active["connection"]
    wired_on = next((d for d in wired if d["state"].startswith("connected")), None)
    return {
        "available": True,
        "wifi": {
            "present": bool(wifi_devs),
            "hardware": hw == "enabled",
            "enabled": wifi_on == "enabled",
            "ssid": ssid,
            "signal": signal,
            "connecting": connecting["connection"] if connecting else "",
            "device": (active or connecting or (wifi_devs[0] if wifi_devs else {})).get("device", ""),
        },
        "wired": {"present": bool(wired), "connected": bool(wired_on), "name": wired_on["connection"] if wired_on else ""},
        "connectivity": connectivity,
        "airplane": wifi_on != "enabled" and wwan_on != "enabled",
    }


def networks(rescan=False):
    """Wi-Fi networks in range, strongest first, the connected one on top."""
    out = nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
                "--rescan", "yes" if rescan else "no", timeout=40, check=False)
    saved = saved_wifi()
    best = {}
    for line in out.splitlines():
        in_use, ssid, signal, security = fields(line, 4)
        if not ssid:
            continue  # hidden network
        sig = int(signal) if signal.isdigit() else 0
        entry = {"ssid": ssid, "signal": sig, "secure": security not in ("", "--"), "security": security,
                 "active": in_use == "*", "saved": ssid in saved}
        cur = best.get(ssid)
        if cur is None or sig > cur["signal"]:
            entry["active"] = entry["active"] or bool(cur and cur["active"])
            best[ssid] = entry
        elif entry["active"]:
            cur["active"] = True
    return sorted(best.values(), key=lambda n: (not n["active"], -n["signal"], n["ssid"].lower()))


def connect(ssid, password=None, hidden=False):
    ssid = str(ssid)
    if not ssid:
        raise NetError("Choose a network first.")
    password = password or None
    if password is not None and not 8 <= len(password) <= 63:
        raise NetError("Wi-Fi passwords have 8 to 63 characters.")
    saved = ssid in saved_wifi()
    if saved and password is None:
        nmcli("--wait", "45", "connection", "up", "id", ssid, timeout=60, ssid=ssid)
        return status()
    if saved:  # a new password for a saved network: start from a fresh profile
        nmcli("connection", "delete", "id", ssid, check=False)
    args = ["--wait", "45", "device", "wifi", "connect", ssid]
    if password is not None:
        args += ["password", password]
    if hidden:
        args += ["hidden", "yes"]
    try:
        nmcli(*args, timeout=60, ssid=ssid)
    except NetError:
        # Don't keep a profile with a wrong password
        nmcli("connection", "delete", "id", ssid, check=False)
        raise
    return status()


def disconnect():
    for d in devices():
        if d["type"] == "wifi" and d["state"].startswith(("connected", "connecting")):
            nmcli("device", "disconnect", d["device"])
    return status()


def forget(ssid):
    nmcli("connection", "delete", "id", str(ssid), ssid=str(ssid))
    return status()


def set_wifi(on):
    nmcli("radio", "wifi", "on" if on else "off")
    return status()


def set_airplane(on):
    nmcli("radio", "all", "off" if on else "on")
    return status()
