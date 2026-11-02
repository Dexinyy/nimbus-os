"""Real terminals for the Nimbus desktop.

Terminal keeps the screen of a text program the way an xterm-compatible terminal does: it reads
the program's output, follows its escape sequences (cursor movement, colors, scrolling, the
alternate screen used by full-screen programs like nano and less) and records which rows changed.
Session runs a program (bash) in a pseudo-terminal and feeds a Terminal.

Nothing here needs GTK, so it can be tested on its own (see os/test-term.py).
"""
import codecs
import fcntl
import os
import re
import signal
import struct
import subprocess
import termios
import unicodedata

# Cell flags
BOLD, DIM, ITALIC, UNDERLINE, REVERSE, STRIKE, HIDDEN = 1, 2, 4, 8, 16, 32, 64
# A style is (foreground, background, flags). Colors: -1 default, 0-255 palette, or "#rrggbb".
DEFAULT_STYLE = (-1, -1, 0)
BLANK = (" ", DEFAULT_STYLE)
SCROLLBACK_BATCH = 2000  # most rows sent to the page as scrollback in one update

# The DEC "special graphics" character set, used by some programs for line drawing.
DEC_GRAPHICS = dict(zip(
    "`abcdefghijklmnopqrstuvwxyz{|}~",
    "◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·"))

PRINTABLE = re.compile(r"[^\x00-\x1f\x7f-\x9f]+")
ASCII_RUN = re.compile(r"[\x20-\x7e]+$")

_widths = {}


def char_width(ch):
    """Columns a character takes: 0 for combining marks, 2 for wide (CJK, most emoji), else 1."""
    o = ord(ch)
    if o < 0x300:
        return 1
    w = _widths.get(ch)
    if w is None:
        if unicodedata.combining(ch) or unicodedata.category(ch) in ("Mn", "Me", "Cf"):
            w = 0
        elif unicodedata.east_asian_width(ch) in ("W", "F"):
            w = 2
        else:
            w = 1
        _widths[ch] = w
    return w


def fix_wide(row, start, end):
    """Before cells start..end are overwritten, blank the other half of any wide character cut in two."""
    if start > 0 and row[start][0] == "":
        row[start - 1] = BLANK
    if end < len(row) and row[end][0] == "":
        row[end] = BLANK


def row_runs(row):
    """A row as [text, fg, bg, flags] runs of equal style, without trailing blank cells.

    A wide character gets a run of its own with a fifth item, 2, so the page can give it
    exactly two columns whatever font draws it."""
    end = len(row)
    while end and row[end - 1] == BLANK:
        end -= 1
    runs, text, style = [], [], None
    for x in range(end):
        ch, st = row[x]
        if ch == "":
            continue  # second half of a wide character
        if x + 1 < end and row[x + 1][0] == "":
            if text:
                runs.append(["".join(text), style[0], style[1], style[2]])
            runs.append([ch, st[0], st[1], st[2], 2])
            text, style = [], None
            continue
        if st != style:
            if text:
                runs.append(["".join(text), style[0], style[1], style[2]])
            text, style = [], st
        text.append(ch)
    if text:
        runs.append(["".join(text), style[0], style[1], style[2]])
    return runs


class Terminal:
    """An xterm-compatible screen. Feed it the program's output with feed()."""

    def __init__(self, cols=80, rows=24, respond=None):
        self.cols, self.rows = max(cols, 2), max(rows, 2)
        self.respond = respond or (lambda data: None)  # replies to the program (cursor position, ...)
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.scrolled = []  # rows (as runs) that scrolled off the top since the last update
        self.clear_scrollback = False
        self.title = ""
        self.bell = False
        self.reset()

    # ---- state ----
    def reset(self):
        self.main = [self.blank_row() for _ in range(self.rows)]
        self.alt = None  # the main screen, kept while the alternate screen is shown
        self.buf = self.main
        self.x = self.y = 0
        self.style = DEFAULT_STYLE
        self.wrap_next = False
        self.top, self.bottom = 0, self.rows - 1
        self.autowrap, self.origin, self.insert, self.cursor_visible = True, False, False, True
        self.app_cursor, self.bracketed_paste, self.newline_mode = False, False, False
        self.tabs = set(range(8, self.cols, 8))
        self.charsets, self.shift = ["B", "B"], 0
        self.saved = None
        self.state, self.params, self.private, self.inter, self.osc = "ground", "", "", "", ""
        self.dirty = set(range(self.rows))

    def blank_row(self, style=None):
        return [self.blank_cell(style)] * self.cols

    def blank_cell(self, style=None):
        # Erased cells keep the current background color, as xterm does ("bce").
        if style is None or style[1] == -1:
            return BLANK
        return (" ", (-1, style[1], 0))

    def touch(self, y=None):
        if y is None:
            self.dirty.update(range(self.rows))
        else:
            self.dirty.add(y)

    # ---- input ----
    def feed(self, data):
        self.write(self.decoder.decode(data))

    def write(self, text):
        i, n = 0, len(text)
        while i < n:
            if self.state == "ground":
                m = PRINTABLE.match(text, i)
                if m:
                    self.put_text(m.group())
                    i = m.end()
                    continue
                self.control(text[i])
            else:
                self.parse(text[i])
            i += 1

    # ---- printing ----
    def put_text(self, text):
        charset = self.charsets[self.shift]
        if charset == "0":
            text = "".join(DEC_GRAPHICS.get(c, c) for c in text)
        if not self.insert and ASCII_RUN.match(text):
            self.put_ascii(text)
            return
        for ch in text:
            self.put_char(ch)

    def put_ascii(self, text):
        """Fast path for plain ASCII without insert mode."""
        cell_style = self.style
        while text:
            if self.wrap_next:
                self.wrap_to_next_line()
            row = self.buf[self.y]
            room = self.cols - self.x
            part, text = text[:room], text[room:]
            fix_wide(row, self.x, self.x + len(part))
            row[self.x:self.x + len(part)] = [(c, cell_style) for c in part]
            self.dirty.add(self.y)
            self.x += len(part)
            if self.x >= self.cols:
                self.x = self.cols - 1
                if self.autowrap:
                    self.wrap_next = True
                elif text:
                    # Without autowrap the rest overwrites the last column
                    row[self.x] = (text[-1], cell_style)
                    text = ""

    def wrap_to_next_line(self):
        self.wrap_next = False
        self.x = 0
        self.index()

    def put_char(self, ch):
        w = char_width(ch)
        if w == 0:
            # Combining mark: join it to the previous character
            x, y = (self.x - 1, self.y) if not self.wrap_next else (self.x, self.y)
            if x >= 0:
                row = self.buf[y]
                if row[x][0] == "" and x > 0:
                    x -= 1
                prev, st = row[x]
                row[x] = (prev + ch, st)
                self.dirty.add(y)
            return
        if self.wrap_next:
            self.wrap_to_next_line()
        if w == 2 and self.x == self.cols - 1:
            # A wide character doesn't fit in the last column: continue on the next line
            if self.autowrap:
                self.buf[self.y][self.x] = self.blank_cell(self.style)
                self.wrap_to_next_line()
            else:
                return
        row = self.buf[self.y]
        if self.insert:
            row[self.x:self.x] = [BLANK] * w
            del row[self.cols:]
        fix_wide(row, self.x, self.x + w)
        row[self.x] = (ch, self.style)
        if w == 2:
            row[self.x + 1] = ("", self.style)
        self.dirty.add(self.y)
        self.x += w
        if self.x >= self.cols:
            self.x = self.cols - 1
            if self.autowrap:
                self.wrap_next = True

    # ---- control characters ----
    def control(self, ch):
        if ch == "\x1b":
            self.state, self.inter = "esc", ""
        elif ch == "\r":
            self.x, self.wrap_next = 0, False
        elif ch in "\n\x0b\x0c":
            self.linefeed()
        elif ch == "\x08":
            self.wrap_next = False
            self.x = max(self.x - 1, 0)
        elif ch == "\t":
            self.tab(1)
        elif ch == "\x07":
            self.bell = True
        elif ch == "\x0e":
            self.shift = 1
        elif ch == "\x0f":
            self.shift = 0

    def linefeed(self):
        self.wrap_next = False
        if self.newline_mode:
            self.x = 0
        self.index()

    def tab(self, n):
        self.wrap_next = False
        for _ in range(n):
            nxt = [t for t in self.tabs if t > self.x]
            self.x = min(nxt) if nxt else self.cols - 1

    def back_tab(self, n):
        for _ in range(n):
            prev = [t for t in self.tabs if t < self.x]
            self.x = max(prev) if prev else 0

    # ---- scrolling ----
    def index(self):
        """Move down a line, scrolling the region up at its bottom edge."""
        if self.y == self.bottom:
            self.scroll_up(1)
        elif self.y < self.rows - 1:
            self.y += 1

    def reverse_index(self):
        if self.y == self.top:
            self.scroll_down(1)
        elif self.y > 0:
            self.y -= 1

    def scroll_up(self, n, keep=True):
        top, bottom = self.top, self.bottom
        n = min(n, bottom - top + 1)
        for _ in range(n):
            gone = self.buf.pop(top)
            if keep and top == 0 and self.alt is None:
                self.scrolled.append(row_runs(gone))
            self.buf.insert(bottom, self.blank_row(self.style))
        if len(self.scrolled) > SCROLLBACK_BATCH * 2:
            del self.scrolled[:-SCROLLBACK_BATCH]
        self.touch()

    def scroll_down(self, n):
        top, bottom = self.top, self.bottom
        n = min(n, bottom - top + 1)
        for _ in range(n):
            del self.buf[bottom]
            self.buf.insert(top, self.blank_row(self.style))
        self.touch()

    # ---- escape sequences ----
    def parse(self, ch):
        st = self.state
        if st == "esc":
            if ch == "[":
                self.state, self.params, self.private, self.inter = "csi", "", "", ""
            elif ch == "]":
                self.state, self.osc = "osc", ""
            elif ch in "P_^X":
                self.state = "string"  # DCS, APC, PM, SOS: ignored up to the string terminator
            elif ch in "()*+":
                self.state, self.inter = "charset", ch
            elif ch in " #%":
                self.state, self.inter = "esc_inter", ch
            elif ch == "\x1b":
                pass
            elif ord(ch) < 0x20:
                self.control(ch)
            else:
                self.state = "ground"
                self.esc_dispatch(ch)
        elif st == "csi":
            if "0" <= ch <= "9" or ch in ";:":
                self.params += ch
            elif ch in "<=>?":
                self.private = ch
            elif " " <= ch <= "/":
                self.inter += ch
            elif "@" <= ch <= "~":
                self.state = "ground"
                self.csi_dispatch(ch)
            elif ch == "\x1b":
                self.state, self.inter = "esc", ""
            elif ch in "\x18\x1a":
                self.state = "ground"
            elif ord(ch) < 0x20:
                self.control(ch)
            else:
                self.state = "ground"
        elif st == "osc":
            if ch == "\x07":
                self.state = "ground"
                self.osc_dispatch()
            elif ch == "\x1b":
                self.state = "osc_esc"
            elif len(self.osc) < 4096:
                self.osc += ch
        elif st == "osc_esc":
            self.state = "ground"
            self.osc_dispatch()
            if ch != "\\":
                self.state, self.inter = "esc", ""
                self.parse(ch)
        elif st == "string":
            if ch == "\x07":
                self.state = "ground"
            elif ch == "\x1b":
                self.state = "string_esc"
        elif st == "string_esc":
            self.state = "ground" if ch == "\\" else "string"
        elif st == "charset":
            self.state = "ground"
            slot = "()*+".index(self.inter)
            if slot < 2:
                self.charsets[slot] = ch
        elif st == "esc_inter":
            self.state = "ground"
            if self.inter == "#" and ch == "8":
                self.buf[:] = [[("E", DEFAULT_STYLE)] * self.cols for _ in range(self.rows)]
                self.touch()

    def esc_dispatch(self, ch):
        if ch == "7":
            self.save_cursor()
        elif ch == "8":
            self.restore_cursor()
        elif ch == "D":
            self.wrap_next = False
            self.index()
        elif ch == "E":
            self.x = 0
            self.linefeed()
        elif ch == "M":
            self.wrap_next = False
            self.reverse_index()
        elif ch == "H":
            self.tabs.add(self.x)
        elif ch == "c":
            self.reset()
            self.title = ""

    def osc_dispatch(self):
        code, _, text = self.osc.partition(";")
        if code in ("0", "2"):
            self.title = text[:200]

    def nums(self):
        out = []
        for part in self.params.split(";") if self.params else []:
            head = part.split(":", 1)[0]
            out.append(int(head) if head.isdigit() else 0)
        return out

    def num(self, i, default=1):
        a = self.nums()
        v = a[i] if i < len(a) else 0
        return v if v else default

    def csi_dispatch(self, f):
        if self.private == "?":
            if f in "hl":
                self.set_private_modes(self.nums(), f == "h")
            elif f in "JK":
                self.private = ""
                self.csi_dispatch(f)
            return
        if self.private == ">":
            if f == "c":
                self.respond("\x1b[>1;10;0c")
            return
        if self.private or self.inter:
            if self.inter == "!" and f == "p":
                self.soft_reset()
            return
        n = self.num(0)
        self.wrap_next = False
        if f == "A":
            top = self.top if self.y >= self.top else 0
            self.y = max(self.y - n, top)
        elif f in "Be":
            bottom = self.bottom if self.y <= self.bottom else self.rows - 1
            self.y = min(self.y + n, bottom)
        elif f in "Ca":
            self.x = min(self.x + n, self.cols - 1)
        elif f == "D":
            self.x = max(self.x - n, 0)
        elif f == "E":
            self.csi_move_lines(n, 0)
        elif f == "F":
            self.csi_move_lines(-n, 0)
        elif f in "G`":
            self.x = min(n, self.cols) - 1
        elif f in "Hf":
            self.cursor_to(self.num(1) - 1, self.num(0) - 1)
        elif f == "d":
            self.cursor_to(self.x, n - 1)
        elif f == "I":
            self.tab(n)
        elif f == "Z":
            self.back_tab(n)
        elif f == "J":
            self.erase_display(self.num(0, 0))
        elif f == "K":
            self.erase_line(self.num(0, 0))
        elif f == "L":
            if self.top <= self.y <= self.bottom:
                saved_top, self.top = self.top, self.y
                self.scroll_down(n)
                self.top = saved_top
                self.x = 0
        elif f == "M":
            if self.top <= self.y <= self.bottom:
                saved_top, self.top = self.top, self.y
                self.scroll_up(n, keep=False)  # deleted lines don't go to scrollback
                self.top = saved_top
                self.x = 0
        elif f == "P":
            row = self.buf[self.y]
            n = min(n, self.cols - self.x)
            del row[self.x:self.x + n]
            row.extend([self.blank_cell(self.style)] * n)
            self.dirty.add(self.y)
        elif f == "@":
            row = self.buf[self.y]
            n = min(n, self.cols - self.x)
            row[self.x:self.x] = [self.blank_cell(self.style)] * n
            del row[self.cols:]
            self.dirty.add(self.y)
        elif f == "X":
            row = self.buf[self.y]
            n = min(n, self.cols - self.x)
            row[self.x:self.x + n] = [self.blank_cell(self.style)] * n
            self.dirty.add(self.y)
        elif f == "S":
            self.scroll_up(n)
        elif f == "T":
            self.scroll_down(n)
        elif f == "b":
            prev = self.buf[self.y][self.x - 1][0] if self.x > 0 else " "
            self.put_text(prev * min(n, 4096))
        elif f == "m":
            self.sgr()
        elif f in "hl":
            for mode in self.nums():
                if mode == 4:
                    self.insert = f == "h"
                elif mode == 20:
                    self.newline_mode = f == "h"
        elif f == "r":
            top, bottom = self.num(0) - 1, self.num(1, self.rows) - 1
            if 0 <= top < bottom < self.rows:
                self.top, self.bottom = top, bottom
                self.cursor_to(0, 0)
        elif f == "s" and not self.params:
            self.save_cursor()
        elif f == "u":
            self.restore_cursor()
        elif f == "g":
            mode = self.num(0, 0)
            if mode == 0:
                self.tabs.discard(self.x)
            elif mode == 3:
                self.tabs.clear()
        elif f == "n":
            mode = self.num(0, 0)
            if mode == 5:
                self.respond("\x1b[0n")
            elif mode == 6:
                y = self.y - self.top if self.origin else self.y
                self.respond("\x1b[%d;%dR" % (y + 1, self.x + 1))
        elif f == "c":
            self.respond("\x1b[?1;2c")

    def csi_move_lines(self, n, x):
        self.x = x
        if n > 0:
            bottom = self.bottom if self.y <= self.bottom else self.rows - 1
            self.y = min(self.y + n, bottom)
        else:
            top = self.top if self.y >= self.top else 0
            self.y = max(self.y + n, top)

    def cursor_to(self, x, y):
        self.wrap_next = False
        if self.origin:
            y = min(max(y + self.top, self.top), self.bottom)
        self.x = min(max(x, 0), self.cols - 1)
        self.y = min(max(y, 0), self.rows - 1)

    def erase_display(self, mode):
        if mode == 0:
            self.erase_line(0)
            for y in range(self.y + 1, self.rows):
                self.buf[y] = self.blank_row(self.style)
            self.touch()
        elif mode == 1:
            self.erase_line(1)
            for y in range(0, self.y):
                self.buf[y] = self.blank_row(self.style)
            self.touch()
        elif mode == 2:
            for y in range(self.rows):
                self.buf[y] = self.blank_row(self.style)
            self.touch()
        elif mode == 3:  # erase the scrollback ("clear" sends this)
            self.scrolled = []
            self.clear_scrollback = True

    def erase_line(self, mode):
        row = self.buf[self.y]
        cell = self.blank_cell(self.style)
        if mode == 0:
            row[self.x:] = [cell] * (self.cols - self.x)
        elif mode == 1:
            row[:self.x + 1] = [cell] * (self.x + 1)
        elif mode == 2:
            row[:] = [cell] * self.cols
        self.dirty.add(self.y)

    def set_private_modes(self, modes, on):
        for mode in modes:
            if mode == 1:
                self.app_cursor = on
            elif mode == 6:
                self.origin = on
                self.cursor_to(0, 0)
            elif mode == 7:
                self.autowrap = on
            elif mode == 25:
                self.cursor_visible = on
            elif mode == 2004:
                self.bracketed_paste = on
            elif mode in (47, 1047, 1049):
                if on:
                    if mode == 1049:
                        self.save_cursor()
                    self.enter_alt()
                else:
                    self.leave_alt()
                    if mode == 1049:
                        self.restore_cursor()
            elif mode == 1048:
                if on:
                    self.save_cursor()
                else:
                    self.restore_cursor()

    def enter_alt(self):
        if self.alt is not None:
            return
        self.alt = self.main
        self.buf = [self.blank_row() for _ in range(self.rows)]
        self.touch()

    def leave_alt(self):
        if self.alt is None:
            return
        self.buf = self.main = self.alt
        self.alt = None
        self.touch()

    def save_cursor(self):
        self.saved = (self.x, self.y, self.style, self.origin, self.autowrap, list(self.charsets), self.shift)

    def restore_cursor(self):
        if self.saved is None:
            self.cursor_to(0, 0)
            return
        x, y, self.style, self.origin, self.autowrap, charsets, self.shift = self.saved
        self.charsets = list(charsets)
        self.x, self.y = min(x, self.cols - 1), min(y, self.rows - 1)
        self.wrap_next = False

    def soft_reset(self):
        self.style, self.insert, self.origin, self.autowrap = DEFAULT_STYLE, False, False, True
        self.cursor_visible, self.app_cursor = True, False
        self.top, self.bottom = 0, self.rows - 1
        self.charsets, self.shift, self.saved = ["B", "B"], 0, None

    def sgr(self):
        fg, bg, flags = self.style
        parts = self.params.split(";") if self.params else ["0"]
        i = 0
        while i < len(parts):
            sub = parts[i].split(":")
            code = int(sub[0]) if sub[0].isdigit() else 0
            if code in (38, 48, 58):
                color, used = self.sgr_color(sub, parts, i)
                i += used
                if code == 38:
                    fg = color
                elif code == 48:
                    bg = color
                i += 1
                continue
            if code == 0:
                fg, bg, flags = DEFAULT_STYLE
            elif code == 1:
                flags |= BOLD
            elif code == 2:
                flags |= DIM
            elif code == 3:
                flags |= ITALIC
            elif code in (4, 21):
                flags = (flags & ~UNDERLINE) if len(sub) > 1 and sub[1] == "0" else (flags | UNDERLINE)
            elif code == 7:
                flags |= REVERSE
            elif code == 8:
                flags |= HIDDEN
            elif code == 9:
                flags |= STRIKE
            elif code == 22:
                flags &= ~(BOLD | DIM)
            elif code == 23:
                flags &= ~ITALIC
            elif code == 24:
                flags &= ~UNDERLINE
            elif code == 27:
                flags &= ~REVERSE
            elif code == 28:
                flags &= ~HIDDEN
            elif code == 29:
                flags &= ~STRIKE
            elif 30 <= code <= 37:
                fg = code - 30
            elif code == 39:
                fg = -1
            elif 40 <= code <= 47:
                bg = code - 40
            elif code == 49:
                bg = -1
            elif 90 <= code <= 97:
                fg = code - 82
            elif 100 <= code <= 107:
                bg = code - 92
            i += 1
        self.style = (fg, bg, flags)

    @staticmethod
    def sgr_color(sub, parts, i):
        """Read a 38/48 color: 5;n (palette) or 2;r;g;b, with ";" or ":" separators."""
        if len(sub) > 1:  # colon form: 38:5:n or 38:2::r:g:b / 38:2:r:g:b
            vals = [int(v) if v.isdigit() else 0 for v in sub[1:]]
            if vals and vals[0] == 5 and len(vals) > 1:
                return min(vals[1], 255), 0
            if vals and vals[0] == 2:
                rgb = vals[-3:] if len(vals) >= 4 else (vals[1:] + [0, 0, 0])[:3]
                return "#%02x%02x%02x" % tuple(min(v, 255) for v in rgb), 0
            return -1, 0
        nxt = [int(v) if v.isdigit() else 0 for v in parts[i + 1:i + 5]]
        if nxt and nxt[0] == 5 and len(nxt) > 1:
            return min(nxt[1], 255), 2
        if nxt and nxt[0] == 2 and len(nxt) > 3:
            return "#%02x%02x%02x" % tuple(min(v, 255) for v in nxt[1:4]), 4
        return -1, len(nxt)

    # ---- size ----
    def resize(self, cols, rows):
        cols, rows = max(cols, 2), max(rows, 2)
        if (cols, rows) == (self.cols, self.rows):
            return
        for buf in filter(None, (self.main, self.alt if isinstance(self.alt, list) else None, self.buf)):
            for i, row in enumerate(buf):
                if len(row) > cols:
                    del row[cols:]
                elif len(row) < cols:
                    row.extend([BLANK] * (cols - len(row)))
        if rows < self.rows:
            # Keep the cursor's row on screen: rows above it go to scrollback first
            extra = self.rows - rows
            above = min(extra, self.y)
            for _ in range(above):
                gone = self.buf.pop(0)
                if self.alt is None:
                    self.scrolled.append(row_runs(gone))
            del self.buf[rows:]
            self.y -= above
            if isinstance(self.alt, list):
                del self.alt[rows:]
        else:
            self.buf.extend([[BLANK] * cols for _ in range(rows - self.rows)])
            if isinstance(self.alt, list):
                self.alt.extend([[BLANK] * cols for _ in range(rows - self.rows)])
        if self.alt is None:
            self.main = self.buf
        self.cols, self.rows = cols, rows
        self.top, self.bottom = 0, rows - 1
        self.tabs = set(t for t in self.tabs if t < cols) | set(range(max(self.tabs, default=0) + 8, cols, 8))
        self.x, self.y = min(self.x, cols - 1), min(self.y, rows - 1)
        self.wrap_next = False
        self.touch()

    # ---- output to the page ----
    def text(self):
        """The screen as plain text, one string per row (for tests)."""
        return ["".join(c for c, _ in row).rstrip() for row in self.buf]

    def update(self, full=False):
        rows = range(self.rows) if full else sorted(y for y in self.dirty if y < self.rows)
        data = {
            "cols": self.cols, "rows": self.rows,
            "lines": {str(y): row_runs(self.buf[y]) for y in rows},
            "scrolled": self.scrolled[-SCROLLBACK_BATCH:],
            "cursor": [self.x, self.y, self.cursor_visible],
            "title": self.title,
            "appCursor": self.app_cursor,
            "paste": self.bracketed_paste,
            "alt": self.alt is not None,
            "bell": self.bell,
            "clearBack": self.clear_scrollback,
        }
        self.dirty.clear()
        self.scrolled = []
        self.bell = self.clear_scrollback = False
        return data


class Session:
    """A program (bash by default) in a pseudo-terminal, with its screen."""

    def __init__(self, cols, rows, argv=None, cwd=None, env=None):
        self.term = Terminal(cols, rows, respond=self.write)
        self.master, slave = os.openpty()
        set_size(slave, cols, rows)
        env = dict(os.environ if env is None else env)
        env.update(TERM="xterm-256color", COLORTERM="truecolor")
        # NIMBUS_WM_FD and WAYLAND_SOCKET are the desktop's own connections to the window manager:
        # programs started here connect through WAYLAND_DISPLAY like any other.
        for key in ("WAYLAND_DEBUG", "PYTHONUNBUFFERED", "NIMBUS_DEBUG", "NIMBUS_WM_FD", "WAYLAND_SOCKET", "NIMBUS_TEST"):
            env.pop(key, None)
        argv = argv or ["bash", "--login"]
        cwd = cwd or env.get("HOME") or "/"
        # setsid --ctty makes the terminal the program's controlling terminal, so job control
        # and Ctrl+C work, without forking from this (threaded) process ourselves.
        self.proc = subprocess.Popen(["setsid", "--ctty"] + argv, stdin=slave, stdout=slave, stderr=slave,
                                     cwd=cwd, env=env, close_fds=True)
        os.close(slave)
        flags = fcntl.fcntl(self.master, fcntl.F_GETFL)
        fcntl.fcntl(self.master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        self.pending = b""
        self.closed = False

    def fileno(self):
        return self.master

    def read(self, limit=1 << 20):
        """Read and process what the program wrote. Returns False once it has gone."""
        total = 0
        while total < limit:
            try:
                data = os.read(self.master, 65536)
            except BlockingIOError:
                return True
            except OSError:  # EIO: the program side has closed
                return False
            if not data:
                return False
            self.term.feed(data)
            total += len(data)
        return True

    def write(self, text):
        """Send keys or pasted text to the program."""
        if self.closed:
            return
        self.pending += text.encode("utf-8") if isinstance(text, str) else text
        self.flush()

    def flush(self):
        """Write what's waiting; returns True when everything went out."""
        while self.pending and not self.closed:
            try:
                n = os.write(self.master, self.pending[:4096])
            except BlockingIOError:
                return False
            except OSError:
                self.pending = b""
                return True
            self.pending = self.pending[n:]
        return True

    def resize(self, cols, rows):
        set_size(self.master, cols, rows)
        self.term.resize(cols, rows)

    def exit_code(self):
        return self.proc.poll()

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.proc.poll() is None:
            for sig in (signal.SIGHUP, signal.SIGCONT):
                try:
                    os.killpg(self.proc.pid, sig)
                except OSError:
                    pass
        try:
            os.close(self.master)
        except OSError:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except OSError:
                pass


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


class Terminals:
    """The desktop's terminals: what the page's termOpen/termInput/termResize/termClose calls do.

    The event loop is supplied by the caller:
      emit(name, data)       send an event to the page
      watch(fd, callback)    call callback() whenever fd is readable until it returns False; returns a handle
      unwatch(handle)        stop watching
      later(ms, fn)          run fn() once, ms milliseconds from now, on the same thread
    """

    def __init__(self, emit, watch, unwatch, later):
        self.emit, self.watch, self.unwatch, self.later = emit, watch, unwatch, later
        self.sessions = {}
        self.seq = 0

    def get(self, tid):
        s = self.sessions.get(int(tid))
        if s is None:
            raise ValueError("That terminal has closed")
        return s

    def open(self, cols, rows, cwd=None, argv=None):
        cols, rows = clamp(cols, 10, 500, 80), clamp(rows, 3, 300, 24)
        s = Session(cols, rows, argv=argv, cwd=cwd)
        self.seq += 1
        tid = self.seq
        s.flush_due, s.full = False, True
        self.sessions[tid] = s
        s.handle = self.watch(s.fileno(), lambda: self._readable(tid))
        self._schedule(tid)
        return {"id": tid}

    def input(self, tid, data):
        s = self.get(tid)
        s.write(str(data))
        if s.pending:
            self.later(20, lambda: self._retry_write(tid))
        return True

    def resize(self, tid, cols, rows):
        s = self.get(tid)
        s.resize(clamp(cols, 10, 500, s.term.cols), clamp(rows, 3, 300, s.term.rows))
        self._schedule(tid)
        return True

    def close(self, tid):
        s = self.sessions.pop(int(tid), None)
        if s is not None:
            if s.handle is not None:
                self.unwatch(s.handle)
            s.close()
        return True

    def close_all(self):
        for tid in list(self.sessions):
            self.close(tid)

    def _readable(self, tid):
        s = self.sessions.get(tid)
        if s is None:
            return False
        alive = s.read()
        self._schedule(tid)
        if not alive:
            s.handle = None
            self.later(30, lambda: self._finish(tid))
            return False
        return True

    def _schedule(self, tid):
        s = self.sessions.get(tid)
        if s is not None and not s.flush_due:
            s.flush_due = True
            self.later(16, lambda: self._flush(tid))  # about one screen refresh

    def _flush(self, tid):
        s = self.sessions.get(tid)
        if s is None:
            return
        s.flush_due = False
        data = s.term.update(full=s.full)
        s.full = False
        data["id"] = tid
        self.emit("term", data)

    def _finish(self, tid):
        s = self.sessions.get(tid)
        if s is None:
            return
        self._flush(tid)
        self.sessions.pop(tid, None)
        s.close()
        self.emit("term-exit", {"id": tid, "code": s.exit_code()})

    def _retry_write(self, tid):
        s = self.sessions.get(tid)
        if s is not None and not s.flush():
            self.later(20, lambda: self._retry_write(tid))


def clamp(value, low, high, default):
    try:
        return min(max(int(value), low), high)
    except (TypeError, ValueError):
        return default
