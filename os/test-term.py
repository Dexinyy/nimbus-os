#!/usr/bin/env python3
"""Tests for the Nimbus terminal (os/overlay/usr/lib/nimbus/nimbus_term.py).

Unit tests feed escape sequences and check the screen; session tests run real programs
(bash, and less, nano, vim and top when installed) in a pseudo-terminal.
usage: python3 os/test-term.py
"""
import os
import select
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "overlay/usr/lib/nimbus"))
import nimbus_term as nt  # noqa: E402

failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  " + str(detail)))
    if not cond:
        failures.append(name)


def term(cols=20, rows=5):
    replies = []
    t = nt.Terminal(cols, rows, respond=replies.append)
    t.replies = replies
    return t


# ---------- unit tests ----------
t = term()
t.write("hello\r\nworld")
check("text and newline", t.text()[:2] == ["hello", "world"], t.text())
check("cursor after text", (t.x, t.y) == (5, 1), (t.x, t.y))

t = term(10, 3)
t.write("0123456789AB")
check("autowrap", t.text()[:2] == ["0123456789", "AB"], t.text())

t = term(10, 3)
t.write("1\r\n2\r\n3\r\n4")
check("scroll at bottom", t.text() == ["2", "3", "4"], t.text())
check("scrolled row kept for scrollback", t.update()["scrolled"] == [[["1", -1, -1, 0]]], t.scrolled)

t = term(10, 3)
t.write("abcdef\x1b[3D\x1b[K")
check("cursor back + erase to end of line", t.text()[0] == "abc", t.text())
t.write("\x1b[2J\x1b[2;3HX")
check("clear + cursor position", t.text() == ["", "  X", ""], t.text())

t = term(10, 3)
t.write("\x1b[1;31mR\x1b[0mn\x1b[38;5;200mP\x1b[38;2;1;2;3mT\x1b[48;2;9;9;9m ")
runs = nt.row_runs(t.buf[0])
check("colors: 16, 256, truecolor, background", runs == [["R", 1, -1, nt.BOLD], ["n", -1, -1, 0], ["P", 200, -1, 0],
                                                         ["T", "#010203", -1, 0], [" ", "#010203", "#090909", 0]], runs)

t = term(10, 4)
t.write("a\r\nb\r\nc\r\nd\x1b[2;3r\x1b[3;1H\n")
check("scroll region only scrolls inside", t.text() == ["a", "c", "", "d"], t.text())

t = term(10, 4)
t.write("a\r\nb\r\nc\r\nd\x1b[2;1H\x1b[L")
check("insert line", t.text() == ["a", "", "b", "c"], t.text())
t.write("\x1b[M")
check("delete line", t.text() == ["a", "b", "c", ""], t.text())
check("deleted lines are not scrollback", t.update()["scrolled"] == [], t.scrolled)

t = term(10, 3)
t.write("main\x1b[?1049h\x1b[Halt screen")
check("alternate screen is blank", t.text()[0] == "alt screen", t.text())
t.write("\x1b[?1049l")
check("leaving alternate screen restores", t.text()[0] == "main" and (t.x, t.y) == (4, 0), (t.text(), t.x, t.y))

t = term(10, 3)
t.write("\x1b[2;4H\x1b[6n\x1b[c")
check("cursor position and device replies", t.replies == ["\x1b[2;4R", "\x1b[?1;2c"], t.replies)

t = term(10, 3)
t.write("\x1b]0;My title\x07x\x1b]2;Other\x1b\\")
check("window title (BEL and ST)", t.title == "Other" and t.text()[0] == "x", (t.title, t.text()))

t = term(10, 3)
t.write("\x1b(0lqk\x1b(Bx")
check("line drawing characters", t.text()[0] == "┌─┐x", t.text())

t = term(10, 3)
t.write("日本x")
runs = nt.row_runs(t.buf[0])
check("wide characters take two columns", t.x == 5 and runs[0] == ["日", -1, -1, 0, 2] and runs[2] == ["x", -1, -1, 0], (t.x, runs))
t.write("\x1b[1;2HA")
check("overwriting half a wide character blanks the other half", t.text()[0] == " A本x", t.text())

t = term(10, 3)
t.write("é")
check("combining marks join the previous character", t.text()[0] == "é" and t.x == 1, (t.text(), t.x))

t = term(10, 3)
t.write("ab\tc\x1b[4h\x1b[1GZ")
check("tab and insert mode", t.text()[0] == "Zab      c", t.text())

t = term(10, 3)
t.write("\x1b[?1h\x1b[?2004h\x1b[?25l")
u = t.update()
check("modes reach the page", u["appCursor"] and u["paste"] and not u["cursor"][2], u)

t = term(10, 4)
t.write("1\r\n2\r\n3\r\n4")
t.resize(6, 2)
check("shrinking keeps the cursor row", t.text() == ["3", "4"] and t.y == 1, (t.text(), t.y))
t.resize(12, 5)
check("growing adds blank rows", len(t.text()) == 5 and t.cols == 12, t.text())

t = term(10, 3)
t.feed("é".encode()[:1])
t.feed("é".encode()[1:])
check("UTF-8 split across reads", t.text()[0] == "é", t.text())

t = term(10, 3)
t.write("\x1b[41m\x1b[2J")
check("erase uses the background color", t.buf[1][3] == (" ", (-1, 1, 0)), t.buf[1][3])

t = term(10, 3)
t.write("1\r\n2\r\n3\r\n4\x1b[3J")
u = t.update()
check("erase scrollback tells the page", u["clearBack"] and u["scrolled"] == [] and t.text() == ["2", "3", "4"], (u["clearBack"], t.text()))

t = term(5, 2)
t.write("\x1b[3Zx\x1bcy")
check("reset clears everything", t.text() == ["y", ""], t.text())

t = term(80, 24)
start = time.time()
t.write(("x" * 79 + "\r\n") * 5000)
took = time.time() - start
check("throughput (400 kB in under 2 s)", took < 2, "%.2f s" % took)


# ---------- programs in a pseudo-terminal ----------
def run(argv, keys=(), cols=60, rows=12, wait_for=None, timeout=8):
    """Start argv, send keys (str or (str, seconds_to_wait_after)), return the session."""
    env = dict(os.environ, HOME=tempfile.mkdtemp(), PS1="$ ", LANG="C.UTF-8")
    env.pop("PROMPT_COMMAND", None)
    s = nt.Session(cols, rows, argv=argv, env=env)
    pump(s, 0.6)
    for k in keys:
        text, pause = (k, 0.4) if isinstance(k, str) else k
        s.write(text)
        pump(s, pause)
    if wait_for:
        end = time.time() + timeout
        while time.time() < end and not any(wait_for in line for line in s.term.text()):
            pump(s, 0.2)
    return s


def pump(s, seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([s.master], [], [], max(0.01, end - time.time()))
        if r and not s.read():
            return False
    return True


s = run(["bash", "--norc", "--noprofile", "-i"], ["echo hel''lo $((6*7))\r"], wait_for="hello 42")
check("bash runs commands", any("hello 42" in l for l in s.term.text()), s.term.text())
s.write("printf '\\033[32mgreen\\033[0m\\n'\r")
pump(s, 0.5)
check("bash colors reach the screen", any(r[0] == "green" and r[1] == 2 for row in s.term.buf for r in [nt.row_runs(row)[0]] if nt.row_runs(row)), s.term.text())
s.resize(40, 10)
s.write("stty size\r")
pump(s, 0.5)
check("resize reaches the program", any(l.strip() == "10 40" for l in s.term.text()), s.term.text())
s.write("sleep 30\r")
pump(s, 0.4)
s.write("\x03")
pump(s, 0.4)
s.write("echo after-ctrl-c\r")
pump(s, 0.5)
check("Ctrl+C stops the running command (job control)", any(l.endswith("after-ctrl-c") and not l.startswith("$ echo") for l in s.term.text()), s.term.text())
s.write("exit\r")
pump(s, 0.5)
check("exit ends the session", s.read() is False or s.exit_code() is not None, s.exit_code())
s.close()

if shutil.which("less"):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write("\n".join("line %d" % i for i in range(200)))
    s = run(["bash", "--norc", "--noprofile", "-i"], ["echo before-less\r", "less %s\r" % f.name], wait_for="line 0")
    shown = s.term.text()
    check("less shows the file on the alternate screen", "line 0" in shown[0] and s.term.alt is not None, shown)
    s.write(" ")
    pump(s, 0.5)
    check("less pages down", any("line 1" in l for l in s.term.text()) and "line 0" not in s.term.text()[0], s.term.text())
    s.write("q")
    pump(s, 0.6)
    check("quitting less restores the shell screen", s.term.alt is None and any("before-less" in l for l in s.term.text()), s.term.text())
    s.close()
    os.unlink(f.name)

if shutil.which("nano"):
    d = tempfile.mkdtemp()
    path = os.path.join(d, "note.txt")
    s = run(["nano", "--ignorercfile", path], [("Hello from Nimbus", 0.5), ("\x0f", 0.6), ("\r", 0.8)], cols=70, rows=16,
            wait_for="Wrote")
    text = "\n".join(s.term.text())
    check("nano draws its screen", "GNU nano" in text or "note.txt" in text, s.term.text())
    s.write("\x18")  # Ctrl+X
    pump(s, 0.8)
    saved = open(path).read() if os.path.exists(path) else ""
    check("nano saves a file typed in the terminal", saved.strip() == "Hello from Nimbus", repr(saved))
    s.close()

if shutil.which("vim"):
    d = tempfile.mkdtemp()
    path = os.path.join(d, "v.txt")
    s = run(["vim", "-u", "NONE", "-N", path], [("iVim works", 0.4), ("\x1b", 0.3), (":wq\r", 1.0)], cols=70, rows=16)
    saved = open(path).read() if os.path.exists(path) else ""
    check("vim edits and saves", saved.strip() == "Vim works", repr(saved))
    s.close()

if shutil.which("top"):
    s = run(["top", "-d", "1"], [("", 1.5)], cols=90, rows=20, wait_for="PID")
    text = s.term.text()
    check("top draws its table", any("PID" in l for l in text) and any("load average" in l or "Tasks" in l for l in text), text[:6])
    s.write("q")
    pump(s, 0.5)
    s.close()

print()
print("All terminal tests passed" if not failures else "%d failed: %s" % (len(failures), ", ".join(failures)))
sys.exit(1 if failures else 0)
