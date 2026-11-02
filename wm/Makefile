# nimbus-wm, the Nimbus OS window manager (a wlroots 0.17 compositor)
#   make            build ./nimbus-wm
#   make protocols  generate the Wayland protocol headers wlroots' headers include
PKGS = wlroots wayland-server xkbcommon pixman-1 libinput xcb
CFLAGS ?= -O2 -g
CFLAGS += -std=c11 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers \
	-DWLR_USE_UNSTABLE -D_GNU_SOURCE -I. $(shell pkg-config --cflags $(PKGS))
LIBS = $(shell pkg-config --libs $(PKGS)) -lm

WAYLAND_PROTOCOLS = $(shell pkg-config --variable=pkgdatadir wayland-protocols)
WAYLAND_SCANNER = $(shell pkg-config --variable=wayland_scanner wayland-scanner)
XML = stable/xdg-shell/xdg-shell.xml \
	staging/cursor-shape/cursor-shape-v1.xml \
	unstable/tablet/tablet-unstable-v2.xml \
	unstable/xdg-decoration/xdg-decoration-unstable-v1.xml \
	staging/xdg-activation/xdg-activation-v1.xml \
	unstable/pointer-constraints/pointer-constraints-unstable-v1.xml
PROTOCOLS = $(foreach x,$(XML),$(basename $(notdir $(x)))-protocol.h)

all: nimbus-wm
protocols: $(PROTOCOLS)

%-protocol.h:
	$(WAYLAND_SCANNER) server-header $(WAYLAND_PROTOCOLS)/$(filter %/$*.xml,$(XML)) $@

nimbus-wm: nimbus-wm.c $(PROTOCOLS)
	$(CC) $(CFLAGS) -o $@ nimbus-wm.c $(LIBS)

clean:
	rm -f nimbus-wm *-protocol.h

.PHONY: all protocols clean
