#!/usr/bin/env python3
"""Tests for os/overlay/usr/lib/nimbus/nimbus_net.py against a fake nmcli with canned answers.
usage: python3 os/test-net.py
"""
import os
import stat
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "overlay/usr/lib/nimbus"))
import nimbus_net as net  # noqa: E402

failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  " + str(detail)))
    if not cond:
        failures.append(name)


FAKE = r'''#!/bin/bash
# Fake nmcli for tests. State lives in $NMSTATE (a directory).
log() { printf '%s\n' "$*" >> "$NMSTATE/calls"; }
log "$*"
args="$*"
connected=$(cat "$NMSTATE/connected" 2>/dev/null)
case "$args" in
  "-t -f DEVICE,TYPE,STATE,CONNECTION device status")
    echo "enp0s3:ethernet:connected:Wired connection 1"
    if [ -n "$connected" ]; then echo "wlan0:wifi:connected:$connected"; else echo "wlan0:wifi:disconnected:"; fi
    echo "lo:loopback:connected (externally):lo";;
  "-t -f WIFI-HW,WIFI,WWAN radio") cat "$NMSTATE/radio" 2>/dev/null || echo "enabled:enabled:enabled";;
  "-t -f CONNECTIVITY general") echo "full";;
  "-t -f NAME,TYPE connection show")
    echo "Wired connection 1:802-3-ethernet"
    cat "$NMSTATE/saved" 2>/dev/null || true;;
  "-t -f ACTIVE,SSID,SIGNAL device wifi list ifname wlan0 --rescan no")
    echo "yes:${connected}:71"; echo "no:Neighbors:40";;
  "-t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list --rescan "*)
    echo " :Caf\\:e Wi-Fi:80:WPA2"
    echo " :Caf\\:e Wi-Fi:55:WPA2"
    echo "*:Home:71:WPA2 WPA3"
    echo " ::90:WPA2"
    echo " :Library:30:--";;
  "--wait 45 device wifi connect Home password goodpassword")
    echo "Home" > "$NMSTATE/connected"; echo "Home:802-11-wireless" >> "$NMSTATE/saved"
    echo "Device 'wlan0' successfully activated";;
  "--wait 45 device wifi connect Home password wrongpassword")
    echo "Home:802-11-wireless" >> "$NMSTATE/saved"
    echo "Error: Connection activation failed: Secrets were required, but not provided." >&2; exit 4;;
  "connection delete id Home") grep -v '^Home:' "$NMSTATE/saved" > "$NMSTATE/s2"; mv "$NMSTATE/s2" "$NMSTATE/saved"; rm -f "$NMSTATE/connected"; true;;
  "radio wifi off") echo "enabled:disabled:enabled" > "$NMSTATE/radio";;
  "radio all off") echo "enabled:disabled:disabled" > "$NMSTATE/radio";;
  "device disconnect wlan0") rm -f "$NMSTATE/connected";;
  *) echo "Error: unexpected call: $args" >&2; exit 2;;
esac
'''
d = tempfile.mkdtemp()
state = os.path.join(d, "state")
os.mkdir(state)
fake = os.path.join(d, "nmcli")
with open(fake, "w") as f:
    f.write(FAKE)
os.chmod(fake, stat.S_IRWXU)
os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]
os.environ["NMSTATE"] = state

check("terse fields with escaped colons", net.split_terse(r"a\:b:c\\d:") == ["a:b", "c\\d", ""], net.split_terse(r"a\:b:c\\d:"))

s = net.status()
check("status: wired connected, Wi-Fi on but not connected",
      s["available"] and s["wired"]["connected"] and s["wifi"]["present"] and s["wifi"]["enabled"] and not s["wifi"]["ssid"] and not s["airplane"], s)

nets = net.networks(rescan=True)
names = [n["ssid"] for n in nets]
check("networks: active first, then by signal, hidden ones skipped, duplicates merged",
      names == ["Home", "Caf:e Wi-Fi", "Library"], names)
cafe = next(n for n in nets if n["ssid"] == "Caf:e Wi-Fi")
check("networks: strongest signal kept, security read", cafe["signal"] == 80 and cafe["secure"] and not nets[2]["secure"], nets)

try:
    net.connect("Home", "wrongpassword")
    check("wrong password is reported", False, "no error")
except net.NetError as e:
    check("wrong password is reported in plain words", str(e) == "The password for Home isn't right.", str(e))
check("a profile with a wrong password isn't kept", "Home" not in net.saved_wifi(), open(os.path.join(state, "saved")).read())

try:
    net.connect("Home", "short")
    check("short password is refused", False, "no error")
except net.NetError as e:
    check("short password is refused before trying", "8 to 63" in str(e), str(e))

s = net.connect("Home", "goodpassword")
check("connect: status shows the network and its signal", s["wifi"]["ssid"] == "Home" and s["wifi"]["signal"] == 71, s["wifi"])
check("connect: network is saved", "Home" in net.saved_wifi(), net.saved_wifi())

s = net.disconnect()
check("disconnect", not s["wifi"]["ssid"], s["wifi"])

s = net.forget("Home")
check("forget", "Home" not in net.saved_wifi(), net.saved_wifi())

s = net.set_wifi(False)
check("Wi-Fi off", not s["wifi"]["enabled"] and not s["airplane"], s)
s = net.set_airplane(True)
check("airplane mode", s["airplane"], s)

check("friendly: out of range", net.friendly("Error: No network with SSID 'X' found.", "X") == "X is out of range.")
check("friendly: unknown errors lose the 'Error:' prefix", net.friendly("Error: something odd") == "something odd")

print()
print("All network tests passed" if not failures else "%d failed: %s" % (len(failures), ", ".join(failures)))
sys.exit(1 if failures else 0)
