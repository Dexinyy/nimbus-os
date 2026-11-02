#!/usr/bin/env python3
"""Test bridge: runs the desktop's terminal calls (termOpen, termInput, ...) with nimbus_term.Terminals,
like nimbus-shell does, but on a plain select() loop and talking JSON lines over stdin/stdout.

  in:  {"id": n, "method": "termOpen", "args": {...}}
  out: {"reply": n, "ok": true, "data": ...}  or  {"event": "term", "data": {...}}
"""
import heapq
import itertools
import json
import os
import selectors
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../os/overlay/usr/lib/nimbus"))
import nimbus_term  # noqa: E402

sel = selectors.DefaultSelector()
timers, order = [], itertools.count()


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def watch(fd, callback):
    sel.register(fd, selectors.EVENT_READ, callback)
    return fd


def unwatch(fd):
    try:
        sel.unregister(fd)
    except (KeyError, ValueError):
        pass


def later(ms, fn):
    heapq.heappush(timers, (time.monotonic() + ms / 1000, next(order), fn))


terms = nimbus_term.Terminals(emit=lambda name, data: out({"event": name, "data": data}),
                              watch=watch, unwatch=unwatch, later=later)
METHODS = {
    "termOpen": lambda a: terms.open(a.get("cols", 80), a.get("rows", 24)),
    "termInput": lambda a: terms.input(a.get("id"), a.get("data", "")),
    "termResize": lambda a: terms.resize(a.get("id"), a.get("cols"), a.get("rows")),
    "termClose": lambda a: terms.close(a.get("id")),
    "log": lambda a: True,
}

buffer = b""


def on_stdin():
    global buffer
    chunk = os.read(0, 65536)
    if not chunk:
        terms.close_all()
        sys.exit(0)
    buffer += chunk
    while b"\n" in buffer:
        line, buffer = buffer.split(b"\n", 1)
        msg = json.loads(line)
        try:
            out({"reply": msg["id"], "ok": True, "data": METHODS[msg["method"]](msg.get("args") or {})})
        except Exception as exc:  # report to the page like nimbus-shell does
            out({"reply": msg["id"], "ok": False, "data": str(exc)})
    return True


sel.register(0, selectors.EVENT_READ, on_stdin)
while True:
    timeout = max(0, timers[0][0] - time.monotonic()) if timers else 1
    for key, _ in sel.select(timeout):
        if key.data() is False:
            unwatch(key.fd)
    while timers and timers[0][0] <= time.monotonic():
        heapq.heappop(timers)[2]()
