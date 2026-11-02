/*
 * nimbus-wm: the Nimbus OS window manager, a small Wayland compositor built on wlroots 0.17.
 *
 * The Nimbus desktop (nimbus-shell, a full-screen web page) is drawn at the bottom and programs'
 * windows above it. The desktop has windows and menus of its own that can sit above or below a
 * program's window, so it tells the compositor, for each program window, which parts of the screen
 * belong to the desktop above that window; the compositor draws those parts of the desktop's picture
 * again right above the window. Pointer input goes to whatever is drawn on top.
 *
 * The desktop is started by the compositor and talks to it over a socket pair (NIMBUS_WM_FD):
 *   compositor -> desktop  one JSON object per line: windows appearing, changing and closing,
 *                          focus changes, requests from programs, and global keys
 *   desktop -> compositor  one command per line, numbers separated by spaces:
 *     layout T [x y w h r]*T  N [id M [x y w h r]*M]*N   desktop parts above everything (T rectangles)
 *                                                       and program windows bottom to top, each with
 *                                                       the desktop parts above it (r: corner radius)
 *     focus ID          give the keyboard to a window (0: the desktop)
 *     close ID          ask a window to close
 *     show ID 0|1       hide (minimize) or show a window
 *     geom ID X Y W H STATE RW RH   place a window; STATE 0 normal 1 maximized 2 snapped 3 full screen;
 *                                   RW RH: its size when dragged out of a maximized or snapped state
 *     area X Y W H      the part of the screen windows may use (the screen minus the taskbar)
 *     overlay DIM NIGHT brightness and night light tints over everything, 0-1000
 *     output NAME W H MHZ SCALE TRANSFORM   a display's mode, scale (x1000) and rotation; "output-reset"
 *                       puts the first display back to its preferred mode at 100%
 *     input SPEED ACCEL LEFT LINES NATURAL TAP TAP2 TWOFINGER TNATURAL DWT TSPEED TOUCHPAD
 *                       mice and touchpads (speeds -1000..1000, LINES per wheel notch, the rest 0/1)
 *     keymap LAYOUT VARIANT DELAY RATE   keyboard layout ("-": no variant) and key repeat
 *     cursor THEME SIZE the pointer's look
 *     idle SCREEN SLEEP seconds without input before the screen turns off and before sleeping (0: never)
 *     paste             press Ctrl+V in the window that has the keyboard (clipboard history)
 *     grab ID EDGES     move (EDGES 0) or resize a window with the pointer, its button being held down
 *                       (the title bar the desktop draws for an X11 window was dragged; EDGES: 1 top,
 *                       2 bottom, 4 left, 8 right)
 * The compositor also sends "outputs" (the displays and their modes), "inputs" (keyboards and pointers)
 * and "idle" (what: off, on, sleep) events.
 * X11 programs (through Xwayland, DISPLAY) get windows like Wayland programs; a window's "deco" is the
 * height of the title bar the desktop should draw above it (X11 programs that don't draw their own).
 * If the desktop exits with status 0 the compositor exits; otherwise it is started again, and it is
 * told about the windows that are already open.
 *
 * usage: nimbus-wm [-d] [--test] -- DESKTOP-COMMAND [ARGS...]
 *   -d      debug logging
 *   --test  allow virtual keyboards and pointers (for automated tests)
 */
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <libinput.h>
#include <wayland-server-core.h>
#include <wlr/backend.h>
#include <wlr/backend/libinput.h>
#include <wlr/backend/session.h>
#include <wlr/render/allocator.h>
#include <wlr/render/wlr_renderer.h>
#include <wlr/types/wlr_compositor.h>
#include <wlr/types/wlr_cursor.h>
#include <wlr/types/wlr_cursor_shape_v1.h>
#include <wlr/types/wlr_data_control_v1.h>
#include <wlr/types/wlr_data_device.h>
#include <wlr/types/wlr_fractional_scale_v1.h>
#include <wlr/types/wlr_idle_inhibit_v1.h>
#include <wlr/types/wlr_input_device.h>
#include <wlr/types/wlr_keyboard.h>
#include <wlr/types/wlr_output.h>
#include <wlr/types/wlr_output_layout.h>
#include <wlr/types/wlr_pointer.h>
#include <wlr/types/wlr_presentation_time.h>
#include <wlr/types/wlr_primary_selection.h>
#include <wlr/types/wlr_primary_selection_v1.h>
#include <wlr/types/wlr_scene.h>
#include <wlr/types/wlr_screencopy_v1.h>
#include <wlr/types/wlr_seat.h>
#include <wlr/types/wlr_single_pixel_buffer_v1.h>
#include <wlr/types/wlr_subcompositor.h>
#include <wlr/types/wlr_viewporter.h>
#include <wlr/types/wlr_virtual_keyboard_v1.h>
#include <wlr/types/wlr_virtual_pointer_v1.h>
#include <wlr/types/wlr_xcursor_manager.h>
#include <wlr/types/wlr_xdg_activation_v1.h>
#include <wlr/types/wlr_xdg_decoration_v1.h>
#include <wlr/types/wlr_xdg_output_v1.h>
#include <wlr/types/wlr_xdg_shell.h>
#include <wlr/util/box.h>
#include <wlr/util/edges.h>
#include <wlr/util/log.h>
#include <wlr/xcursor.h>
#include <wlr/xwayland.h>
#include <xcb/xcb.h>
#include <xkbcommon/xkbcommon.h>

#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX_LAYOUT_WINDOWS 128
#define TASKBAR_GUESS 48
#define DECO_TOP 32                        /* the title bar the desktop draws for X11 programs that want one */

enum view_kind { VIEW_APP, VIEW_SHELL, VIEW_SHELL_DIALOG };
enum view_state { STATE_NORMAL, STATE_MAX, STATE_SNAP, STATE_FULL };
static const char *const state_names[] = { "normal", "max", "snap", "full" };
enum cursor_mode { CURSOR_PASSTHROUGH, CURSOR_MOVE, CURSOR_RESIZE };

/* X11 window types (_NET_WM_WINDOW_TYPE_...) that change how a window is treated */
enum x11_atom {
	TYPE_MENU, TYPE_DROPDOWN_MENU, TYPE_POPUP_MENU, TYPE_TOOLTIP, TYPE_NOTIFICATION, TYPE_COMBO, TYPE_DND,
	TYPE_DOCK, TYPE_DESKTOP, TYPE_SPLASH, X11_ATOMS
};
static const char *const x11_atom_names[X11_ATOMS] = {
	"_NET_WM_WINDOW_TYPE_MENU", "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU", "_NET_WM_WINDOW_TYPE_POPUP_MENU",
	"_NET_WM_WINDOW_TYPE_TOOLTIP", "_NET_WM_WINDOW_TYPE_NOTIFICATION", "_NET_WM_WINDOW_TYPE_COMBO",
	"_NET_WM_WINDOW_TYPE_DND", "_NET_WM_WINDOW_TYPE_DOCK", "_NET_WM_WINDOW_TYPE_DESKTOP", "_NET_WM_WINDOW_TYPE_SPLASH",
};

struct server;

struct view {
	struct wl_list link;               /* server.views (program windows only) */
	struct server *server;
	enum view_kind kind;
	struct wlr_xdg_toplevel *toplevel; /* Wayland programs */
	struct wlr_xwayland_surface *xs;   /* X11 programs (through Xwayland); toplevel is NULL then */
	struct wlr_scene_tree *root;       /* program windows: holds tree, then above */
	struct wlr_scene_tree *tree;       /* the window with its popups, placed at its window geometry */
	struct wlr_scene_tree *above;      /* copies of the desktop's picture drawn over this window */
	struct wlr_scene_tree *content;    /* X11: the window's surface, while it is on screen */
	uint32_t id;
	int x, y;                          /* top left of the window geometry, layout coordinates */
	int deco_top;                      /* X11: height of the title bar the desktop draws above the window */
	bool mapped, hidden, announced, placed, listed;
	bool x11_popup;                    /* X11 menus, tooltips and splash screens: placed by the program */
	bool kbd_popup;                    /* X11 popup that took the keyboard */
	enum view_state state;
	struct wlr_box normal;             /* where to go back to from maximized, snapped or full screen */
	int restore_w, restore_h;          /* size when dragged out of maximized or snapped */
	struct wlr_box reported;           /* the geometry the desktop was last told */
	enum view_state reported_state;
	pixman_region32_t above_region;    /* desktop parts above this window, as the desktop said */
	pixman_region32_t copied;          /* the region its copies show now */
	struct wl_listener map, unmap, commit, destroy;
	struct wl_listener request_move, request_resize, request_maximize, request_fullscreen;
	struct wl_listener request_minimize, request_show_window_menu, set_title, set_app_id, set_parent;
	struct wl_listener associate, dissociate, request_configure, request_activate, set_decorations;
	struct wl_listener set_geometry, content_destroy;
};

struct popup {                         /* a menu of the desktop's, drawn above everything */
	struct wlr_scene_tree *holder;
	struct wl_listener destroy;
};

struct decoration {
	struct wlr_xdg_toplevel_decoration_v1 *deco;
	struct wl_listener request_mode, destroy;
};

struct keyboard {
	struct wl_list link;
	struct server *server;
	struct wlr_keyboard *wlr_keyboard;
	bool virtual_kb;                   /* brings its own keymap (tests) */
	struct wl_listener modifiers, key, destroy;
};

struct pointer {                       /* a mouse or touchpad, for its settings */
	struct wl_list link;
	struct server *server;
	struct wlr_input_device *device;
	struct wl_listener destroy;
};

struct inhibitor {                     /* a program keeping the screen on (a video playing) */
	struct server *server;
	struct wl_listener destroy;
};

struct output {
	struct wl_list link;
	struct server *server;
	struct wlr_output *wlr_output;
	struct wlr_scene_output *scene_output;
	struct wl_listener frame, request_state, destroy;
};

struct layout_req {                    /* a layout from the desktop, applied with its next picture */
	bool pending;
	pixman_region32_t top;
	size_t n;
	uint32_t ids[MAX_LAYOUT_WINDOWS];
	pixman_region32_t regions[MAX_LAYOUT_WINDOWS];
};

struct server {
	struct wl_display *display;
	struct wl_event_loop *loop;
	struct wlr_backend *backend;
	struct wlr_session *session;
	struct wlr_renderer *renderer;
	struct wlr_allocator *allocator;
	struct wlr_scene *scene;
	struct wlr_scene_output_layout *scene_layout;
	struct wlr_scene_tree *content;    /* everything the pointer can reach */
	struct wlr_scene_tree *shell_layer, *app_layer, *top_copies, *top_layer, *drag_layer, *overlay;
	struct wlr_scene_rect *dim_rect, *night_rect;
	struct wlr_output_layout *output_layout;
	struct wl_list outputs;
	struct wlr_box screen;             /* the first output */
	struct wlr_box work;               /* the screen minus the taskbar, from the desktop */
	bool work_set;

	struct wlr_compositor *compositor;
	struct wlr_xdg_shell *xdg_shell;
	struct wlr_xwayland *xwayland;     /* X11 programs (Steam, Discord, Wine...) */
	bool xwayland_ready;
	xcb_atom_t x11_atoms[X11_ATOMS];
	struct wlr_scene_tree *x11_layer;  /* X11 menus and splash screens with no window of theirs on screen */
	struct wl_list views;
	uint32_t next_id;
	int cascade;
	struct view *active;               /* program window with the keyboard; NULL: the desktop */

	struct wlr_seat *seat;
	struct wlr_cursor *cursor;
	struct wlr_xcursor_manager *cursor_mgr;
	struct wl_list keyboards;
	enum cursor_mode cursor_mode;
	struct view *grab_view;
	double grab_x, grab_y;
	struct wlr_box grab_box;
	uint32_t grab_edges;
	bool grab_moved;
	uint32_t last_moving_msec;
	double press_ox, press_oy;         /* surface origin under the pointer when a button went down */

	bool super_down, super_alone;
	uint32_t swallowed[16];
	int n_swallowed;

	char **shell_argv;
	pid_t shell_pid;
	struct wl_client *shell_client;
	struct wl_listener shell_client_destroy;
	struct view *shell;
	struct wl_listener shell_commit;
	struct wlr_box shell_buffer;       /* where the desktop's picture is, layout coordinates */
	int ipc_fd;
	struct wl_event_source *ipc_source;
	char ipc_in[1 << 16];
	size_t ipc_in_len;
	char *ipc_out;
	size_t ipc_out_len, ipc_out_cap;
	struct layout_req layout;
	struct wl_event_source *layout_timer;
	pixman_region32_t top_region, top_copied;
	int quick_exits;
	struct timespec last_spawn;
	bool quitting, test_mode;

	/* settings the desktop sends (Settings app) */
	struct {
		bool set, accel, left, natural, tap, tap2, twofinger, tnatural, dwt, touchpad;
		double speed, tspeed, lines;
	} in;
	struct wl_list pointers;
	char kb_layout[16], kb_variant[40];
	int kb_delay, kb_rate;
	int idle_screen, idle_sleep;       /* seconds; 0: never */
	uint32_t last_input;               /* msec */
	bool screen_off, sleep_sent;
	int inhibitors;
	struct wl_event_source *idle_timer;
	struct wl_listener new_inhibitor;

	struct wl_listener new_output, new_input, new_xdg_surface, new_decoration, request_activate;
	struct wl_listener xwayland_ready_listener, new_xwayland_surface;
	struct wl_listener cursor_motion, cursor_motion_absolute, cursor_button, cursor_axis, cursor_frame;
	struct wl_listener request_cursor, request_set_shape, request_set_selection, request_set_primary_selection;
	struct wl_listener request_start_drag, start_drag, new_virtual_keyboard, new_virtual_pointer;
	struct wl_event_source *sigchld, *sigterm, *sigint;
};

static char shell_copy_marker;

static void process_motion(struct server *s, uint32_t time);
static void note_input(struct server *s);
static void update_copies(struct server *s, struct view *v, bool force);
static void update_top_copies(struct server *s, bool force);
static void view_report(struct view *v);

static uint32_t now_msec(void) {
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return (uint32_t)(t.tv_sec * 1000 + t.tv_nsec / 1000000);
}

static void hook(struct wl_signal *signal, struct wl_listener *l, wl_notify_func_t fn) {
	l->notify = fn;
	wl_signal_add(signal, l);
}

static void unlisten(struct wl_listener *l) {
	if (l->link.next) {
		wl_list_remove(&l->link);
		wl_list_init(&l->link);
	}
}

/* ---------- talking to the desktop ---------- */

static void ipc_close(struct server *s);

static void ipc_flush(struct server *s) {
	while (s->ipc_fd >= 0 && s->ipc_out_len) {
		ssize_t n = send(s->ipc_fd, s->ipc_out, s->ipc_out_len, MSG_NOSIGNAL | MSG_DONTWAIT);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			if (errno == EAGAIN || errno == EWOULDBLOCK)
				break;
			wlr_log_errno(WLR_ERROR, "writing to the desktop");
			ipc_close(s);
			return;
		}
		memmove(s->ipc_out, s->ipc_out + n, s->ipc_out_len - (size_t)n);
		s->ipc_out_len -= (size_t)n;
	}
	if (s->ipc_source)
		wl_event_source_fd_update(s->ipc_source, WL_EVENT_READABLE | (s->ipc_out_len ? WL_EVENT_WRITABLE : 0));
}

static void ipc_write(struct server *s, const char *data, size_t len) {
	if (s->ipc_fd < 0)
		return;
	if (s->ipc_out_len + len > s->ipc_out_cap) {
		size_t cap = MAX(s->ipc_out_cap * 2, s->ipc_out_len + len + 4096);
		if (cap > (8u << 20)) {
			wlr_log(WLR_ERROR, "the desktop is not reading its messages; dropping one");
			return;
		}
		char *p = realloc(s->ipc_out, cap);
		if (!p)
			return;
		s->ipc_out = p;
		s->ipc_out_cap = cap;
	}
	memcpy(s->ipc_out + s->ipc_out_len, data, len);
	s->ipc_out_len += len;
	ipc_flush(s);
}

struct jbuf {
	char b[4096];
	size_t n;
	bool first;
};

static void jb_raw(struct jbuf *j, const char *str) {
	size_t l = strlen(str);
	if (j->n + l < sizeof j->b - 4) {
		memcpy(j->b + j->n, str, l);
		j->n += l;
	}
}

static void jb_key(struct jbuf *j, const char *k) {
	if (!j->first)
		jb_raw(j, ",");
	j->first = false;
	jb_raw(j, "\"");
	jb_raw(j, k);
	jb_raw(j, "\":");
}

static void jb_int(struct jbuf *j, const char *k, long v) {
	char t[32];
	snprintf(t, sizeof t, "%ld", v);
	jb_key(j, k);
	jb_raw(j, t);
}

static void jb_str(struct jbuf *j, const char *k, const char *v) {
	jb_key(j, k);
	jb_raw(j, "\"");
	size_t used = 0;
	for (const unsigned char *p = (const unsigned char *)(v ? v : ""); *p; p++, used++) {
		/* keep titles short, without cutting a character in half */
		if (used > 1000 && (*p & 0xc0) != 0x80)
			break;
		if (j->n + 8 >= sizeof j->b - 8)
			break;
		if (*p == '"' || *p == '\\') {
			j->b[j->n++] = '\\';
			j->b[j->n++] = (char)*p;
		} else if (*p < 0x20) {
			j->n += (size_t)snprintf(j->b + j->n, 8, "\\u%04x", *p);
		} else {
			j->b[j->n++] = (char)*p;
		}
	}
	jb_raw(j, "\"");
}

static void jb_begin(struct jbuf *j, const char *ev) {
	j->n = 0;
	j->first = true;
	j->b[j->n++] = '{';
	jb_str(j, "ev", ev);
}

static void jb_send(struct server *s, struct jbuf *j) {
	j->b[j->n++] = '}';
	j->b[j->n++] = '\n';
	ipc_write(s, j->b, j->n);
}

/* The window's size and where its content starts in its surface (Wayland windows can have shadows around them). */
static struct wlr_box view_geometry(struct view *v) {
	struct wlr_box g = { 0 };
	if (v->xs) {
		struct wlr_surface *surf = v->xs->surface;
		if (surf && surf->mapped) {
			g.width = surf->current.width;
			g.height = surf->current.height;
		} else {
			g.width = v->xs->width;
			g.height = v->xs->height;
		}
		return g;
	}
	wlr_xdg_surface_get_geometry(v->toplevel->base, &g);
	return g;
}

static struct wlr_surface *view_surface(struct view *v) {
	return v->xs ? v->xs->surface : v->toplevel->base->surface;
}

static const char *view_app_id(struct view *v) {
	if (v->xs)
		return v->xs->class && *v->xs->class ? v->xs->class : v->xs->instance;
	return v->toplevel->app_id;
}

static const char *view_title(struct view *v) {
	return v->xs ? v->xs->title : v->toplevel->title;
}

static pid_t view_pid(struct view *v) {
	if (v->xs)
		return v->xs->pid; /* the X11 program itself, not Xwayland */
	pid_t pid = 0;
	wl_client_get_credentials(wl_resource_get_client(v->toplevel->resource), &pid, NULL, NULL);
	return pid;
}

static struct view *view_parent(struct view *v) {
	if (v->xs) {
		struct wlr_xwayland_surface *p = v->xs->parent;
		while (p) { /* a dialog of a menu belongs to the menu's window */
			struct view *pv = p->data;
			if (pv && !pv->x11_popup && pv->id)
				return pv;
			p = p->parent;
		}
		return NULL;
	}
	struct wlr_xdg_toplevel *p = v->toplevel->parent;
	if (!p || !p->base->data)
		return NULL;
	struct wlr_scene_tree *t = p->base->data;
	struct view *pv = t->node.data;
	return pv && pv->kind == VIEW_APP ? pv : NULL;
}

static void send_window(struct server *s, const char *ev, struct view *v) {
	struct jbuf j;
	jb_begin(&j, ev);
	jb_int(&j, "id", v->id);
	struct wlr_box g = view_geometry(v);
	jb_str(&j, "app", view_app_id(v));
	jb_str(&j, "title", view_title(v));
	jb_int(&j, "x", v->x);
	jb_int(&j, "y", v->y);
	jb_int(&j, "w", g.width);
	jb_int(&j, "h", g.height);
	jb_str(&j, "state", state_names[v->state]);
	struct view *p = view_parent(v);
	jb_int(&j, "parent", p ? p->id : 0);
	jb_int(&j, "min", v->hidden);
	jb_int(&j, "pid", view_pid(v));
	jb_int(&j, "x11", v->xs != NULL);
	jb_int(&j, "deco", v->deco_top);
	jb_send(s, &j);
	v->reported = (struct wlr_box){ v->x, v->y, g.width, g.height };
	v->reported_state = v->state;
}

static void send_simple(struct server *s, const char *ev, uint32_t id) {
	struct jbuf j;
	jb_begin(&j, ev);
	jb_int(&j, "id", id);
	jb_send(s, &j);
}

static void send_request(struct view *v, const char *what, int x, int y) {
	if (!v->announced)
		return;
	struct jbuf j;
	jb_begin(&j, "req");
	jb_int(&j, "id", v->id);
	jb_str(&j, "what", what);
	jb_int(&j, "x", x);
	jb_int(&j, "y", y);
	jb_send(v->server, &j);
}

static void send_key(struct server *s, const char *key) {
	struct jbuf j;
	jb_begin(&j, "key");
	jb_str(&j, "key", key);
	jb_int(&j, "id", s->active ? s->active->id : 0);
	jb_send(s, &j);
	wlr_log(WLR_INFO, "key %s for the desktop", key);
}

static void send_screen(struct server *s, const char *ev) {
	struct jbuf j;
	jb_begin(&j, ev);
	jb_int(&j, "x", s->screen.x);
	jb_int(&j, "y", s->screen.y);
	jb_int(&j, "w", s->screen.width);
	jb_int(&j, "h", s->screen.height);
	jb_int(&j, "version", 1);
	jb_send(s, &j);
}

/* JSON lists of objects: each item's fields go between jb_item_begin and jb_item_end */
static void jb_list_begin(struct jbuf *j, const char *k) {
	jb_key(j, k);
	jb_raw(j, "[");
}

static void jb_list_end(struct jbuf *j) {
	jb_raw(j, "]");
	j->first = false;
}

static void jb_item_begin(struct jbuf *j, bool *any) {
	if (*any)
		jb_raw(j, ",");
	*any = true;
	jb_raw(j, "{");
	j->first = true;
}

static void jb_num(struct jbuf *j, const char *k, double v) {
	char t[40];
	snprintf(t, sizeof t, "%.3f", v);
	jb_key(j, k);
	jb_raw(j, t);
}

static bool device_is_touchpad(struct wlr_input_device *d) {
	if (!wlr_input_device_is_libinput(d))
		return false;
	struct libinput_device *li = wlr_libinput_get_device_handle(d);
	return li && libinput_device_config_tap_get_finger_count(li) > 0;
}

/* The displays, their modes, scale and rotation (Settings > System > Display). */
static void send_outputs(struct server *s) {
	if (s->ipc_fd < 0)
		return;
	struct jbuf j;
	char t[96];
	jb_begin(&j, "outputs");
	jb_list_begin(&j, "list");
	bool any = false;
	struct output *o;
	wl_list_for_each(o, &s->outputs, link) {
		struct wlr_output *wo = o->wlr_output;
		struct wlr_box box;
		wlr_output_layout_get_box(s->output_layout, wo, &box);
		jb_item_begin(&j, &any);
		jb_str(&j, "name", wo->name);
		jb_str(&j, "desc", wo->description);
		jb_str(&j, "make", wo->make);
		jb_str(&j, "model", wo->model);
		jb_int(&j, "width", wo->width);
		jb_int(&j, "height", wo->height);
		jb_int(&j, "refresh", wo->refresh);
		jb_num(&j, "scale", wo->scale);
		jb_int(&j, "transform", wo->transform);
		jb_int(&j, "x", box.x);
		jb_int(&j, "y", box.y);
		snprintf(t, sizeof t, "[%d,%d]", wo->phys_width, wo->phys_height);
		jb_key(&j, "phys");
		jb_raw(&j, t);
		jb_key(&j, "modes");
		jb_raw(&j, "[");
		bool first = true;
		int count = 0;
		struct wlr_output_mode *m;
		wl_list_for_each(m, &wo->modes, link) {
			if (count++ >= 60)
				break;
			snprintf(t, sizeof t, "%s[%d,%d,%d,%d]", first ? "" : ",", m->width, m->height, m->refresh, m->preferred ? 1 : 0);
			jb_raw(&j, t);
			first = false;
		}
		if (first) { /* virtual displays have no list of modes */
			snprintf(t, sizeof t, "[%d,%d,%d,1]", wo->width, wo->height, wo->refresh);
			jb_raw(&j, t);
		}
		jb_raw(&j, "]");
		jb_raw(&j, "}");
	}
	jb_list_end(&j);
	jb_send(s, &j);
}

/* Keyboards and pointers (Settings > Bluetooth & devices). */
static void send_inputs(struct server *s) {
	if (s->ipc_fd < 0)
		return;
	struct jbuf j;
	jb_begin(&j, "inputs");
	jb_list_begin(&j, "keyboards");
	bool any = false;
	struct keyboard *k;
	wl_list_for_each(k, &s->keyboards, link) {
		if (k->virtual_kb)
			continue;
		jb_item_begin(&j, &any);
		jb_str(&j, "name", k->wlr_keyboard->base.name);
		jb_raw(&j, "}");
	}
	jb_list_end(&j);
	jb_list_begin(&j, "pointers");
	any = false;
	struct pointer *p;
	wl_list_for_each(p, &s->pointers, link) {
		jb_item_begin(&j, &any);
		jb_str(&j, "name", p->device->name);
		jb_int(&j, "touchpad", device_is_touchpad(p->device));
		jb_raw(&j, "}");
	}
	jb_list_end(&j);
	jb_send(s, &j);
}

static void send_idle(struct server *s, const char *what) {
	struct jbuf j;
	jb_begin(&j, "idle");
	jb_str(&j, "what", what);
	jb_send(s, &j);
}

/* Tell the desktop where a window is now, if that changed. */
static void view_report(struct view *v) {
	if (!v->announced)
		return;
	struct wlr_box g = view_geometry(v);
	if (v->reported.x == v->x && v->reported.y == v->y && v->reported.width == g.width &&
			v->reported.height == g.height && v->reported_state == v->state)
		return;
	struct jbuf j;
	jb_begin(&j, "geom");
	jb_int(&j, "id", v->id);
	jb_int(&j, "x", v->x);
	jb_int(&j, "y", v->y);
	jb_int(&j, "w", g.width);
	jb_int(&j, "h", g.height);
	jb_str(&j, "state", state_names[v->state]);
	jb_send(v->server, &j);
	v->reported = (struct wlr_box){ v->x, v->y, g.width, g.height };
	v->reported_state = v->state;
}

/* ---------- the desktop's picture, drawn again above windows ---------- */

static struct wlr_surface *shell_surface(struct server *s) {
	if (!s->shell || !s->shell->mapped)
		return NULL;
	return s->shell->toplevel->base->surface;
}

static struct wlr_buffer *shell_picture(struct server *s) {
	struct wlr_surface *surf = shell_surface(s);
	if (!surf || !surf->buffer)
		return NULL;
	return &surf->buffer->base;
}

/* Where the desktop's picture lies on the screen, in layout coordinates. */
static void update_shell_buffer_box(struct server *s) {
	struct wlr_surface *surf = shell_surface(s);
	if (!surf) {
		s->shell_buffer = (struct wlr_box){ 0 };
		return;
	}
	struct wlr_box g = view_geometry(s->shell);
	s->shell_buffer = (struct wlr_box){
		.x = s->shell->x - g.x,
		.y = s->shell->y - g.y,
		.width = surf->current.width,
		.height = surf->current.height,
	};
}

static void add_copy(struct server *s, struct wlr_scene_tree *parent, struct wlr_buffer *buf, const pixman_box32_t *b) {
	struct wlr_surface *surf = shell_surface(s);
	int scale = surf && surf->current.scale > 0 ? surf->current.scale : 1;
	struct wlr_scene_buffer *sb = wlr_scene_buffer_create(parent, buf);
	if (!sb)
		return;
	sb->node.data = &shell_copy_marker;
	struct wlr_fbox src = {
		.x = (double)(b->x1 - s->shell_buffer.x) * scale,
		.y = (double)(b->y1 - s->shell_buffer.y) * scale,
		.width = (double)(b->x2 - b->x1) * scale,
		.height = (double)(b->y2 - b->y1) * scale,
	};
	wlr_scene_buffer_set_source_box(sb, &src);
	wlr_scene_buffer_set_dest_size(sb, b->x2 - b->x1, b->y2 - b->y1);
	wlr_scene_node_set_position(&sb->node, b->x1, b->y1);
}

static void clear_tree(struct wlr_scene_tree *tree) {
	struct wlr_scene_node *node, *tmp;
	wl_list_for_each_safe(node, tmp, &tree->children, link)
		wlr_scene_node_destroy(node);
}

/* Rebuild the copies in tree so they show region (clipped to the desktop's picture). */
static void fill_copies(struct server *s, struct wlr_scene_tree *tree, pixman_region32_t *region,
		pixman_region32_t *copied, bool force) {
	struct wlr_buffer *buf = shell_picture(s);
	pixman_region32_t want;
	pixman_region32_init(&want);
	if (buf) {
		pixman_region32_intersect_rect(&want, region, s->shell_buffer.x, s->shell_buffer.y,
			s->shell_buffer.width, s->shell_buffer.height);
	}
	if (!force && pixman_region32_equal(&want, copied)) {
		pixman_region32_fini(&want);
		return;
	}
	clear_tree(tree);
	pixman_region32_copy(copied, &want);
	int n = 0;
	const pixman_box32_t *rects = pixman_region32_rectangles(&want, &n);
	for (int i = 0; i < n; i++)
		add_copy(s, tree, buf, &rects[i]);
	pixman_region32_fini(&want);
}

static void update_copies(struct server *s, struct view *v, bool force) {
	if (v->kind != VIEW_APP)
		return;
	fill_copies(s, v->above, &v->above_region, &v->copied, force);
}

static void update_top_copies(struct server *s, bool force) {
	fill_copies(s, s->top_copies, &s->top_region, &s->top_copied, force);
}

static void refresh_all_copies(struct server *s, bool force) {
	update_top_copies(s, force);
	struct view *v;
	wl_list_for_each(v, &s->views, link)
		update_copies(s, v, force);
}

/* New picture from the desktop: the copies show it too. */
static void damage_copies(struct wlr_scene_tree *tree, struct wlr_buffer *buf, pixman_region32_t *damage) {
	struct wlr_scene_node *node;
	wl_list_for_each(node, &tree->children, link) {
		if (node->type == WLR_SCENE_NODE_BUFFER)
			wlr_scene_buffer_set_buffer_with_damage(wlr_scene_buffer_from_node(node), buf, damage);
	}
}

static void apply_layout(struct server *s);

static void shell_handle_commit(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, shell_commit);
	struct wlr_surface *surf = shell_surface(s);
	if (!surf)
		return;
	struct wlr_box before = s->shell_buffer;
	update_shell_buffer_box(s);
	if (memcmp(&before, &s->shell_buffer, sizeof before) != 0) {
		refresh_all_copies(s, true);
	} else if (surf->buffer) {
		struct wlr_buffer *buf = &surf->buffer->base;
		damage_copies(s->top_copies, buf, &surf->buffer_damage);
		struct view *v;
		wl_list_for_each(v, &s->views, link)
			damage_copies(v->above, buf, &surf->buffer_damage);
	}
	/* a layout sent just before this picture was drawn for it */
	if (s->layout.pending)
		apply_layout(s);
	/* Keep the desktop drawing even when windows cover it completely: it is also seen through the copies. */
	if (!wl_list_empty(&surf->current.frame_callback_list)) {
		struct output *o;
		wl_list_for_each(o, &s->outputs, link)
			wlr_output_schedule_frame(o->wlr_output);
	}
}

/* ---------- focus and stacking ---------- */

static void kbd_enter(struct server *s, struct wlr_surface *surf) {
	struct wlr_keyboard *kb = wlr_seat_get_keyboard(s->seat);
	if (kb)
		wlr_seat_keyboard_notify_enter(s->seat, surf, kb->keycodes, kb->num_keycodes, &kb->modifiers);
	else
		wlr_seat_keyboard_notify_enter(s->seat, surf, NULL, 0, NULL);
}

/* Tell a program its window is the active one, or no longer is. */
static void view_activate(struct view *v, bool on) {
	if (v->xs) {
		wlr_xwayland_surface_activate(v->xs, on);
		if (on) /* X11 programs keep their own idea of which window is on top */
			wlr_xwayland_surface_restack(v->xs, NULL, XCB_STACK_MODE_ABOVE);
		return;
	}
	wlr_xdg_toplevel_set_activated(v->toplevel, on);
}

/* Give the keyboard to a program window, or to the desktop (v == NULL). */
static void set_focus(struct server *s, struct view *v) {
	if (v && (!v->mapped || v->hidden))
		v = NULL;
	struct view *old = s->active;
	struct wlr_surface *target = v ? view_surface(v) : shell_surface(s);
	/* an open menu keeps the keyboard; moving the focus elsewhere closes it */
	if (target != s->seat->keyboard_state.focused_surface &&
			s->seat->keyboard_state.grab != s->seat->keyboard_state.default_grab)
		wlr_seat_keyboard_end_grab(s->seat);
	if (old && old != v)
		view_activate(old, false);
	s->active = v;
	if (v) {
		view_activate(v, true);
		kbd_enter(s, view_surface(v));
	} else if (shell_surface(s)) {
		kbd_enter(s, shell_surface(s));
	} else {
		wlr_seat_keyboard_clear_focus(s->seat);
	}
	if (s->shell && s->shell->mapped)
		wlr_xdg_toplevel_set_activated(s->shell->toplevel, v == NULL);
}

/* Put a window above the others right away; the desktop's next layout confirms it. */
static void raise_view(struct server *s, struct view *v) {
	wlr_scene_node_raise_to_top(&v->root->node);
	if (pixman_region32_not_empty(&v->above_region)) {
		pixman_region32_clear(&v->above_region);
		update_copies(s, v, false);
	}
}

static bool view_is_top(struct server *s, struct view *v) {
	struct wlr_scene_node *last = wl_container_of(s->app_layer->children.prev, last, link);
	return &v->root->node == last;
}

static struct view *view_by_id(struct server *s, uint32_t id) {
	struct view *v;
	wl_list_for_each(v, &s->views, link)
		if (v->id == id)
			return v;
	return NULL;
}

/* ---------- window geometry ---------- */

static struct wlr_box work_area(struct server *s) {
	if (s->work_set && s->work.width > 0 && s->work.height > 0)
		return s->work;
	struct wlr_box w = s->screen;
	w.height = MAX(w.height - TASKBAR_GUESS, 1);
	return w;
}

/* The scene tree of an xdg surface starts at its window geometry, so it goes where the window is. */
static void view_update_position(struct view *v) {
	wlr_scene_node_set_position(&v->tree->node, v->x, v->y);
	/* X11 programs place their menus from where they think their window is */
	if (v->xs && v->xs->surface && (v->xs->x != v->x || v->xs->y != v->y))
		wlr_xwayland_surface_configure(v->xs, (int16_t)v->x, (int16_t)v->y, MAX(v->xs->width, 1), MAX(v->xs->height, 1));
}

/* A box for the window and the title bar the desktop draws above it: the window's part of it */
static struct wlr_box below_title(struct view *v, struct wlr_box b) {
	b.y += v->deco_top;
	b.height = MAX(b.height - v->deco_top, 1);
	return b;
}

static void set_tiled(struct wlr_xdg_toplevel *t, bool tiled) {
	if (wl_resource_get_version(t->resource) >= XDG_TOPLEVEL_STATE_TILED_LEFT_SINCE_VERSION)
		wlr_xdg_toplevel_set_tiled(t, tiled ? WLR_EDGE_TOP | WLR_EDGE_BOTTOM | WLR_EDGE_LEFT | WLR_EDGE_RIGHT : WLR_EDGE_NONE);
}

/* Put a window in a state at a place; the program draws itself at that size when it can. */
static void view_configure(struct view *v, enum view_state st, struct wlr_box b) {
	struct wlr_xdg_toplevel *t = v->toplevel;
	if (v->state == STATE_NORMAL && st != STATE_NORMAL && v->placed) {
		struct wlr_box g = view_geometry(v);
		v->normal = (struct wlr_box){ v->x, v->y, g.width, g.height };
	}
	v->state = st;
	if (v->xs) {
		wlr_xwayland_surface_set_maximized(v->xs, st == STATE_MAX);
		wlr_xwayland_surface_set_fullscreen(v->xs, st == STATE_FULL);
		struct wlr_box g = view_geometry(v);
		int w = b.width > 0 ? b.width : g.width, h = b.height > 0 ? b.height : g.height;
		wlr_xwayland_surface_configure(v->xs, (int16_t)b.x, (int16_t)b.y, (uint16_t)MAX(w, 1), (uint16_t)MAX(h, 1));
	} else {
		wlr_xdg_toplevel_set_maximized(t, st == STATE_MAX);
		wlr_xdg_toplevel_set_fullscreen(t, st == STATE_FULL);
		set_tiled(t, st == STATE_MAX || st == STATE_SNAP);
		wlr_xdg_toplevel_set_size(t, MAX(b.width, 0), MAX(b.height, 0));
	}
	v->x = b.x;
	v->y = b.y;
	v->placed = true;
	if (v->mapped)
		view_update_position(v);
}

static void view_restore(struct view *v) {
	struct wlr_box b = v->normal;
	if (b.width <= 0 || b.height <= 0) {
		struct wlr_box w = work_area(v->server);
		b = (struct wlr_box){ w.x + w.width / 8, w.y + w.height / 8, w.width * 3 / 4, w.height * 3 / 4 };
	}
	view_configure(v, STATE_NORMAL, b);
}

/* X11 programs that say where their window goes (Wine does, for Windows programs) */
static bool x11_wants_position(struct view *v) {
	struct server *s = v->server;
	xcb_size_hints_t *h = v->xs ? v->xs->size_hints : NULL;
	if (!h)
		return false;
	if (v->xs->width >= s->screen.width && v->xs->height >= s->screen.height)
		return true; /* covers the screen: a game */
	return (h->flags & (XCB_ICCCM_SIZE_HINT_US_POSITION | XCB_ICCCM_SIZE_HINT_P_POSITION)) && (v->xs->x || v->xs->y);
}

static void view_place_initial(struct view *v) {
	struct server *s = v->server;
	struct wlr_box w = work_area(s);
	struct wlr_box g = view_geometry(v);
	int top = v->deco_top; /* the desktop's title bar goes above the window */
	struct view *parent = view_parent(v);
	if (x11_wants_position(v)) {
		v->x = v->xs->x;
		v->y = v->xs->y;
		if (g.width >= s->screen.width && g.height >= s->screen.height) {
			v->placed = true;
			return;
		}
	} else if (parent) {
		struct wlr_box pg = view_geometry(parent);
		v->x = parent->x + (pg.width - g.width) / 2;
		v->y = parent->y + (pg.height - g.height + top) / 2;
	} else {
		int off = (s->cascade++ % 6) * 26 - 52;
		v->x = w.x + (w.width - g.width) / 2 + off;
		v->y = w.y + top + (w.height - top - g.height) / 2 + off * 7 / 10;
	}
	v->x = MAX(w.x, MIN(v->x, w.x + w.width - MIN(g.width, w.width)));
	v->y = MAX(w.y + top, MIN(v->y, w.y + w.height - g.height));
	v->placed = true;
}

/* ---------- windows ---------- */

static struct view *view_from_surface_tree(struct wlr_xdg_surface *xs) {
	if (!xs || !xs->data)
		return NULL;
	struct wlr_scene_tree *t = xs->data;
	return t->node.data;
}

static bool x11_map(struct view *v);

static void view_handle_map(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, map);
	struct server *s = v->server;
	if (v->xs && !x11_map(v))
		return; /* an X11 menu or tooltip */
	v->mapped = true;
	if (v->kind == VIEW_SHELL) {
		v->x = s->screen.x;
		v->y = s->screen.y;
		view_update_position(v);
		update_shell_buffer_box(s);
		if (!s->active)
			set_focus(s, NULL);
		refresh_all_copies(s, true);
		wlr_log(WLR_INFO, "the desktop is on screen");
		return;
	}
	if (v->kind == VIEW_SHELL_DIALOG) {
		struct wlr_box g = view_geometry(v);
		v->x = s->screen.x + (s->screen.width - g.width) / 2;
		v->y = s->screen.y + (s->screen.height - g.height) / 2;
		view_update_position(v);
		kbd_enter(s, v->toplevel->base->surface);
		return;
	}
	if (!v->placed)
		view_place_initial(v);
	view_update_position(v);
	wlr_scene_node_set_enabled(&v->root->node, !v->hidden);
	wlr_scene_node_raise_to_top(&v->root->node);
	if (s->ipc_fd >= 0) {
		send_window(s, "new", v);
		v->announced = true;
	}
	wlr_log(WLR_INFO, "window %u (%s%s) opened", v->id, view_app_id(v) ? view_app_id(v) : "?", v->xs ? ", X11" : "");
	set_focus(s, v);
	update_copies(s, v, true);
}

static void x11_unmap(struct view *v);

static void view_handle_unmap(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, unmap);
	struct server *s = v->server;
	if (v->xs) {
		x11_unmap(v);
		if (v->x11_popup)
			return;
	}
	v->mapped = false;
	if (s->grab_view == v) {
		s->cursor_mode = CURSOR_PASSTHROUGH;
		s->grab_view = NULL;
	}
	if (v->kind == VIEW_SHELL) {
		refresh_all_copies(s, true);
		return;
	}
	if (v->kind == VIEW_SHELL_DIALOG) {
		set_focus(s, s->active);
		return;
	}
	wlr_scene_node_set_enabled(&v->root->node, false);
	if (v->announced) {
		send_simple(s, "gone", v->id);
		v->announced = false;
	}
	if (s->active == v)
		set_focus(s, NULL); /* the desktop picks the next window */
}

static void view_handle_commit(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, commit);
	struct server *s = v->server;
	if (!v->mapped || v->x11_popup)
		return;
	if (v->kind == VIEW_SHELL)
		return;
	if (s->cursor_mode == CURSOR_RESIZE && s->grab_view == v) {
		/* keep the edge opposite the one being dragged in place */
		struct wlr_box g = view_geometry(v);
		if (s->grab_edges & WLR_EDGE_LEFT)
			v->x = s->grab_box.x + s->grab_box.width - g.width;
		if (s->grab_edges & WLR_EDGE_TOP)
			v->y = s->grab_box.y + s->grab_box.height - g.height;
		view_update_position(v);
		return;
	}
	view_update_position(v);
	if (!(s->cursor_mode == CURSOR_MOVE && s->grab_view == v))
		view_report(v);
}

static void view_handle_destroy(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, destroy);
	struct server *s = v->server;
	unlisten(&v->map);
	unlisten(&v->unmap);
	unlisten(&v->commit);
	unlisten(&v->destroy);
	unlisten(&v->request_move);
	unlisten(&v->request_resize);
	unlisten(&v->request_maximize);
	unlisten(&v->request_fullscreen);
	unlisten(&v->request_minimize);
	unlisten(&v->request_show_window_menu);
	unlisten(&v->set_title);
	unlisten(&v->set_app_id);
	unlisten(&v->set_parent);
	if (s->grab_view == v) {
		s->cursor_mode = CURSOR_PASSTHROUGH;
		s->grab_view = NULL;
	}
	if (s->active == v)
		s->active = NULL;
	if (v->kind == VIEW_SHELL) {
		unlisten(&s->shell_commit);
		s->shell = NULL;
		s->shell_buffer = (struct wlr_box){ 0 };
		refresh_all_copies(s, true);
	}
	if (v->kind == VIEW_APP) {
		if (v->announced)
			send_simple(s, "gone", v->id);
		wl_list_remove(&v->link);
		wlr_scene_node_destroy(&v->root->node);
	}
	pixman_region32_fini(&v->above_region);
	pixman_region32_fini(&v->copied);
	free(v);
}

static void view_handle_request_move(struct wl_listener *l, void *data);
static void view_handle_request_resize(struct wl_listener *l, void *data);

static void view_handle_request_maximize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_maximize);
	if (v->kind != VIEW_APP) {
		wlr_xdg_surface_schedule_configure(v->toplevel->base);
		return;
	}
	if (v->toplevel->requested.maximized && v->state != STATE_MAX)
		view_configure(v, STATE_MAX, work_area(v->server));
	else if (!v->toplevel->requested.maximized && v->state == STATE_MAX)
		view_restore(v);
	else
		wlr_xdg_surface_schedule_configure(v->toplevel->base);
	view_report(v);
}

static void view_handle_request_fullscreen(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_fullscreen);
	struct server *s = v->server;
	if (v->kind == VIEW_SHELL) {
		/* the desktop covers the screen either way */
		wlr_xdg_toplevel_set_fullscreen(v->toplevel, v->toplevel->requested.fullscreen);
		wlr_xdg_toplevel_set_size(v->toplevel, s->screen.width, s->screen.height);
		return;
	}
	if (v->kind != VIEW_APP) {
		wlr_xdg_surface_schedule_configure(v->toplevel->base);
		return;
	}
	if (v->toplevel->requested.fullscreen && v->state != STATE_FULL) {
		view_configure(v, STATE_FULL, s->screen);
		if (v->mapped)
			raise_view(s, v);
	} else if (!v->toplevel->requested.fullscreen && v->state == STATE_FULL) {
		view_restore(v);
	} else {
		wlr_xdg_surface_schedule_configure(v->toplevel->base);
	}
	view_report(v);
}

static void view_handle_request_minimize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_minimize);
	if (v->kind != VIEW_APP || !v->mapped)
		return;
	if (v->announced) {
		send_request(v, "min", 0, 0);
	} else {
		v->hidden = true;
		wlr_scene_node_set_enabled(&v->root->node, false);
		if (v->server->active == v)
			set_focus(v->server, NULL);
	}
}

static void view_handle_request_show_window_menu(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_show_window_menu);
	struct wlr_xdg_toplevel_show_window_menu_event *e = data;
	struct wlr_box g = view_geometry(v);
	send_request(v, "menu", v->x - g.x + e->x, v->y - g.y + e->y);
}

static void view_handle_set_title(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_title);
	if (!v->announced)
		return;
	struct jbuf j;
	jb_begin(&j, "title");
	jb_int(&j, "id", v->id);
	jb_str(&j, "title", view_title(v));
	jb_send(v->server, &j);
}

static void view_handle_set_app_id(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_app_id);
	if (!v->announced)
		return;
	struct jbuf j;
	jb_begin(&j, "app");
	jb_int(&j, "id", v->id);
	jb_str(&j, "app", view_app_id(v));
	jb_send(v->server, &j);
}

static void view_handle_set_parent(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_parent);
	if (!v->announced)
		return;
	struct view *p = view_parent(v);
	struct jbuf j;
	jb_begin(&j, "parent");
	jb_int(&j, "id", v->id);
	jb_int(&j, "parent", p ? p->id : 0);
	jb_send(v->server, &j);
}

static void popup_handle_destroy(struct wl_listener *l, void *data) {
	struct popup *p = wl_container_of(l, p, destroy);
	unlisten(&p->destroy);
	wlr_scene_node_destroy(&p->holder->node);
	free(p);
}

/* Keep a popup (menu, list, tooltip) on screen and out of the taskbar. */
static void popup_unconstrain(struct server *s, struct wlr_xdg_popup *popup) {
	struct wlr_xdg_surface *top = wlr_xdg_surface_try_from_wlr_surface(popup->parent);
	while (top && top->role == WLR_XDG_SURFACE_ROLE_POPUP && top->popup)
		top = wlr_xdg_surface_try_from_wlr_surface(top->popup->parent);
	if (!top || top->role != WLR_XDG_SURFACE_ROLE_TOPLEVEL)
		return;
	struct view *v = view_from_surface_tree(top);
	if (!v)
		return;
	struct wlr_box area = v->kind == VIEW_APP ? work_area(s) : s->screen;
	struct wlr_box g = view_geometry(v);
	struct wlr_box box = {
		.x = area.x - (v->x - g.x),
		.y = area.y - (v->y - g.y),
		.width = area.width,
		.height = area.height,
	};
	wlr_xdg_popup_unconstrain_from_box(popup, &box);
}

static void handle_new_xdg_surface(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_xdg_surface);
	struct wlr_xdg_surface *xs = data;

	if (xs->role == WLR_XDG_SURFACE_ROLE_POPUP) {
		struct wlr_xdg_surface *parent = wlr_xdg_surface_try_from_wlr_surface(xs->popup->parent);
		if (!parent || !parent->data)
			return;
		struct wlr_scene_tree *parent_tree = parent->data;
		/* The desktop's menus go above everything; it is at the screen's top left corner. */
		struct view *pv = parent->role == WLR_XDG_SURFACE_ROLE_TOPLEVEL ? view_from_surface_tree(parent) : NULL;
		if (pv && pv->kind == VIEW_SHELL) {
			struct popup *p = calloc(1, sizeof *p);
			if (!p)
				return;
			p->holder = wlr_scene_tree_create(s->top_layer);
			wlr_scene_node_set_position(&p->holder->node, pv->x, pv->y);
			xs->data = wlr_scene_xdg_surface_create(p->holder, xs);
			hook(&xs->events.destroy, &p->destroy, popup_handle_destroy);
			popup_unconstrain(s, xs->popup);
			return;
		}
		xs->data = wlr_scene_xdg_surface_create(parent_tree, xs);
		popup_unconstrain(s, xs->popup);
		return;
	}
	if (xs->role != WLR_XDG_SURFACE_ROLE_TOPLEVEL)
		return;

	struct view *v = calloc(1, sizeof *v);
	if (!v)
		return;
	v->server = s;
	v->toplevel = xs->toplevel;
	pixman_region32_init(&v->above_region);
	pixman_region32_init(&v->copied);
	struct wl_client *client = wl_resource_get_client(xs->resource);
	if (s->shell_client && client == s->shell_client) {
		v->kind = s->shell ? VIEW_SHELL_DIALOG : VIEW_SHELL;
	} else {
		v->kind = VIEW_APP;
	}

	if (v->kind == VIEW_SHELL) {
		s->shell = v;
		v->tree = wlr_scene_xdg_surface_create(s->shell_layer, xs);
		v->tree->node.data = v;
		xs->data = v->tree;
		wlr_xdg_toplevel_set_size(xs->toplevel, s->screen.width, s->screen.height);
		wlr_xdg_toplevel_set_maximized(xs->toplevel, true);
		set_tiled(xs->toplevel, true);
		hook(&xs->surface->events.commit, &s->shell_commit, shell_handle_commit);
	} else if (v->kind == VIEW_SHELL_DIALOG) {
		v->tree = wlr_scene_xdg_surface_create(s->top_layer, xs);
		v->tree->node.data = v;
		xs->data = v->tree;
	} else {
		v->id = ++s->next_id;
		v->root = wlr_scene_tree_create(s->app_layer);
		v->tree = wlr_scene_xdg_surface_create(v->root, xs);
		v->above = wlr_scene_tree_create(v->root);
		v->tree->node.data = v;
		xs->data = v->tree;
		wlr_scene_node_set_enabled(&v->root->node, false);
		wl_list_insert(s->views.prev, &v->link);
		struct wlr_box w = work_area(s);
		if (wl_resource_get_version(xs->toplevel->resource) >= XDG_TOPLEVEL_CONFIGURE_BOUNDS_SINCE_VERSION)
			wlr_xdg_toplevel_set_bounds(xs->toplevel, w.width, w.height);
		if (wl_resource_get_version(xs->toplevel->resource) >= XDG_TOPLEVEL_WM_CAPABILITIES_SINCE_VERSION)
			wlr_xdg_toplevel_set_wm_capabilities(xs->toplevel, WLR_XDG_TOPLEVEL_WM_CAPABILITIES_WINDOW_MENU |
				WLR_XDG_TOPLEVEL_WM_CAPABILITIES_MAXIMIZE | WLR_XDG_TOPLEVEL_WM_CAPABILITIES_FULLSCREEN |
				WLR_XDG_TOPLEVEL_WM_CAPABILITIES_MINIMIZE);
		/* wlroots announces a window at its first commit; it may have asked for a state before that */
		if (xs->toplevel->requested.fullscreen)
			view_configure(v, STATE_FULL, s->screen);
		else if (xs->toplevel->requested.maximized)
			view_configure(v, STATE_MAX, w);
	}

	hook(&xs->surface->events.map, &v->map, view_handle_map);
	hook(&xs->surface->events.unmap, &v->unmap, view_handle_unmap);
	hook(&xs->surface->events.commit, &v->commit, view_handle_commit);
	hook(&xs->events.destroy, &v->destroy, view_handle_destroy);
	struct wlr_xdg_toplevel *t = xs->toplevel;
	hook(&t->events.request_move, &v->request_move, view_handle_request_move);
	hook(&t->events.request_resize, &v->request_resize, view_handle_request_resize);
	hook(&t->events.request_maximize, &v->request_maximize, view_handle_request_maximize);
	hook(&t->events.request_fullscreen, &v->request_fullscreen, view_handle_request_fullscreen);
	hook(&t->events.request_minimize, &v->request_minimize, view_handle_request_minimize);
	hook(&t->events.request_show_window_menu, &v->request_show_window_menu, view_handle_request_show_window_menu);
	hook(&t->events.set_title, &v->set_title, view_handle_set_title);
	hook(&t->events.set_app_id, &v->set_app_id, view_handle_set_app_id);
	hook(&t->events.set_parent, &v->set_parent, view_handle_set_parent);
}

static void decoration_handle_request_mode(struct wl_listener *l, void *data) {
	struct decoration *d = wl_container_of(l, d, request_mode);
	wlr_xdg_toplevel_decoration_v1_set_mode(d->deco, WLR_XDG_TOPLEVEL_DECORATION_V1_MODE_CLIENT_SIDE);
}

static void decoration_handle_destroy(struct wl_listener *l, void *data) {
	struct decoration *d = wl_container_of(l, d, destroy);
	unlisten(&d->request_mode);
	unlisten(&d->destroy);
	free(d);
}

/* Programs draw their own title bars, like Chrome's tab strip. */
static void handle_new_decoration(struct wl_listener *l, void *data) {
	struct wlr_xdg_toplevel_decoration_v1 *deco = data;
	struct decoration *d = calloc(1, sizeof *d);
	if (!d)
		return;
	d->deco = deco;
	hook(&deco->events.request_mode, &d->request_mode, decoration_handle_request_mode);
	hook(&deco->events.destroy, &d->destroy, decoration_handle_destroy);
	wlr_xdg_toplevel_decoration_v1_set_mode(deco, WLR_XDG_TOPLEVEL_DECORATION_V1_MODE_CLIENT_SIDE);
}

/* A program asks to be brought forward (for example a browser opening a link): the desktop decides. */
static void handle_request_activate(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_activate);
	struct wlr_xdg_activation_v1_request_activate_event *e = data;
	struct wlr_xdg_surface *xs = wlr_xdg_surface_try_from_wlr_surface(e->surface);
	if (!xs || xs->role != WLR_XDG_SURFACE_ROLE_TOPLEVEL)
		return;
	struct view *v = view_from_surface_tree(xs);
	if (!v || v->kind != VIEW_APP || !v->mapped)
		return;
	if (v->announced) {
		send_request(v, "activate", 0, 0);
	} else {
		raise_view(s, v);
		set_focus(s, v);
	}
}

/* ---------- pointer ---------- */

static struct wlr_surface *surface_at(struct server *s, double lx, double ly, double *sx, double *sy, struct view **out) {
	*out = NULL;
	struct wlr_scene_node *node = wlr_scene_node_at(&s->content->node, lx, ly, sx, sy);
	if (!node || node->type != WLR_SCENE_NODE_BUFFER)
		return NULL;
	if (node->data == &shell_copy_marker) {
		struct wlr_surface *surf = shell_surface(s);
		if (!surf)
			return NULL;
		*sx = lx - s->shell_buffer.x;
		*sy = ly - s->shell_buffer.y;
		*out = s->shell;
		return surf;
	}
	struct wlr_scene_surface *ss = wlr_scene_surface_try_from_buffer(wlr_scene_buffer_from_node(node));
	if (!ss)
		return NULL;
	for (struct wlr_scene_tree *t = node->parent; t; t = t->node.parent) {
		if (t->node.data) {
			*out = t->node.data;
			break;
		}
	}
	return ss->surface;
}

/* The title bar and edges the desktop draws around an X11 window that wants a frame: a click there (where
   nothing of the desktop's sits above that window) is a click on that window. */
static struct view *frame_at(struct server *s, double lx, double ly) {
	int px = (int)floor(lx), py = (int)floor(ly);
	if (pixman_region32_contains_point(&s->top_region, px, py, NULL))
		return NULL;
	struct wlr_scene_node *node;
	wl_list_for_each_reverse(node, &s->app_layer->children, link) {
		struct view *v, *found = NULL;
		wl_list_for_each(v, &s->views, link) {
			if (&v->root->node == node) {
				found = v;
				break;
			}
		}
		if (!found || !found->mapped || found->hidden || !found->deco_top || found->state == STATE_FULL)
			continue;
		struct wlr_box g = view_geometry(found);
		struct wlr_box f = { found->x - 6, found->y - found->deco_top, g.width + 12, g.height + found->deco_top + 6 };
		if (!wlr_box_contains_point(&f, lx, ly))
			continue;
		return pixman_region32_contains_point(&found->above_region, px, py, NULL) ? NULL : found;
	}
	return NULL;
}

static bool swallowed_take(struct server *s, uint32_t keycode);

/* Move or resize a window with the pointer: asked by the program (its title bar or edges were dragged), or
   by the desktop (the title bar it draws for X11 programs was dragged). */
static void begin_grab(struct view *v, enum cursor_mode mode, uint32_t edges, bool by_desktop) {
	struct server *s = v->server;
	struct wlr_surface *focused = s->seat->pointer_state.focused_surface;
	if (v->kind != VIEW_APP || v->x11_popup || !v->mapped || !focused || s->cursor_mode != CURSOR_PASSTHROUGH)
		return;
	if (by_desktop ? s->seat->pointer_state.button_count == 0 :
			wlr_surface_get_root_surface(focused) != view_surface(v))
		return;
	if (mode == CURSOR_RESIZE && (v->state == STATE_MAX || v->state == STATE_FULL))
		return;
	if (mode == CURSOR_MOVE && v->state == STATE_FULL)
		return;
	struct wlr_box g = view_geometry(v);
	if (mode == CURSOR_RESIZE && v->state == STATE_SNAP) {
		/* resizing a snapped window lets go of the snap and keeps its size */
		v->state = STATE_NORMAL;
		if (v->toplevel) {
			set_tiled(v->toplevel, false);
			wlr_xdg_surface_schedule_configure(v->toplevel->base);
		}
		view_report(v);
	}
	s->grab_view = v;
	s->cursor_mode = mode;
	s->grab_edges = edges;
	s->grab_moved = false;
	s->grab_x = s->cursor->x;
	s->grab_y = s->cursor->y;
	s->grab_box = (struct wlr_box){ v->x, v->y, g.width, g.height };
	if (mode == CURSOR_RESIZE)
		wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, wlr_xcursor_get_resize_name(edges));
}

static void view_handle_request_move(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_move);
	begin_grab(v, CURSOR_MOVE, 0, false);
}

static void view_handle_request_resize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_resize);
	struct wlr_xdg_toplevel_resize_event *e = data;
	begin_grab(v, CURSOR_RESIZE, e->edges, false);
}

static void send_moving(struct server *s, const char *ev) {
	struct view *v = s->grab_view;
	struct jbuf j;
	jb_begin(&j, ev);
	jb_int(&j, "id", v->id);
	jb_int(&j, "x", v->x);
	jb_int(&j, "y", v->y);
	jb_int(&j, "px", (long)s->cursor->x);
	jb_int(&j, "py", (long)s->cursor->y);
	jb_send(s, &j);
}

static void do_move(struct server *s, uint32_t time) {
	struct view *v = s->grab_view;
	double dx = s->cursor->x - s->grab_x, dy = s->cursor->y - s->grab_y;
	if (!s->grab_moved) {
		if (fabs(dx) + fabs(dy) < 4)
			return;
		s->grab_moved = true;
		wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, "grabbing");
		if (v->state != STATE_NORMAL) {
			/* dragged out of maximized or snapped: back to its own size, under the pointer */
			int w = v->restore_w > 0 ? v->restore_w : v->normal.width;
			int h = v->restore_h > 0 ? v->restore_h : v->normal.height;
			if (w <= 0 || h <= 0) {
				w = s->grab_box.width * 3 / 4;
				h = s->grab_box.height * 3 / 4;
			}
			double frac = s->grab_box.width > 0 ? (s->grab_x - s->grab_box.x) / s->grab_box.width : 0.5;
			int ox = (int)(frac * w);
			if (w > 120)
				ox = MAX(60, MIN(ox, w - 60));
			int oy = (int)MIN(s->grab_y - s->grab_box.y, 20);
			struct wlr_box b = { (int)s->grab_x - ox, (int)s->grab_y - oy, w, h };
			view_configure(v, STATE_NORMAL, b);
			s->grab_box = b;
			view_report(v);
		}
	}
	struct wlr_box w = work_area(s);
	int nx = s->grab_box.x + (int)dx, ny = s->grab_box.y + (int)dy;
	nx = MAX(w.x - s->grab_box.width + 100, MIN(nx, w.x + w.width - 100));
	ny = MAX(w.y + v->deco_top, MIN(ny, w.y + w.height - 40));
	v->x = nx;
	v->y = ny;
	view_update_position(v);
	if (time - s->last_moving_msec >= 30) {
		s->last_moving_msec = time;
		send_moving(s, "moving");
	}
}

/* The smallest and largest sizes a program allows for its window (0: no limit) */
static void view_size_limits(struct view *v, int *minw, int *minh, int *maxw, int *maxh) {
	*minw = *minh = *maxw = *maxh = 0;
	if (v->toplevel) {
		struct wlr_xdg_toplevel_state *cur = &v->toplevel->current;
		*minw = cur->min_width;
		*minh = cur->min_height;
		*maxw = cur->max_width;
		*maxh = cur->max_height;
		return;
	}
	xcb_size_hints_t *h = v->xs->size_hints;
	if (!h)
		return;
	if (h->flags & XCB_ICCCM_SIZE_HINT_P_MIN_SIZE) {
		*minw = h->min_width;
		*minh = h->min_height;
	}
	if (h->flags & XCB_ICCCM_SIZE_HINT_P_MAX_SIZE) {
		*maxw = h->max_width;
		*maxh = h->max_height;
	}
}

static void do_resize(struct server *s) {
	struct view *v = s->grab_view;
	double dx = s->cursor->x - s->grab_x, dy = s->cursor->y - s->grab_y;
	struct wlr_box b = s->grab_box;
	int min_w, min_h, max_w, max_h;
	view_size_limits(v, &min_w, &min_h, &max_w, &max_h);
	if (s->grab_edges & WLR_EDGE_RIGHT)
		b.width = s->grab_box.width + (int)dx;
	if (s->grab_edges & WLR_EDGE_LEFT)
		b.width = s->grab_box.width - (int)dx;
	if (s->grab_edges & WLR_EDGE_BOTTOM)
		b.height = s->grab_box.height + (int)dy;
	if (s->grab_edges & WLR_EDGE_TOP) {
		struct wlr_box w = work_area(s);
		b.height = s->grab_box.height - (int)dy;
		b.height = MIN(b.height, s->grab_box.y + s->grab_box.height - w.y - v->deco_top);
	}
	b.width = MAX(b.width, MAX(min_w, 120));
	b.height = MAX(b.height, MAX(min_h, 60));
	if (max_w > 0)
		b.width = MIN(b.width, max_w);
	if (max_h > 0)
		b.height = MIN(b.height, max_h);
	if (v->xs) {
		/* X11 windows are given their place with their size; the edge opposite the pointer stays put */
		int x = s->grab_edges & WLR_EDGE_LEFT ? s->grab_box.x + s->grab_box.width - b.width : v->x;
		int y = s->grab_edges & WLR_EDGE_TOP ? s->grab_box.y + s->grab_box.height - b.height : v->y;
		if (b.width != v->xs->width || b.height != v->xs->height)
			wlr_xwayland_surface_configure(v->xs, (int16_t)x, (int16_t)y, (uint16_t)b.width, (uint16_t)b.height);
		return;
	}
	wlr_xdg_toplevel_set_size(v->toplevel, b.width, b.height);
}

static void end_grab(struct server *s) {
	struct view *v = s->grab_view;
	enum cursor_mode mode = s->cursor_mode;
	s->cursor_mode = CURSOR_PASSTHROUGH;
	if (v) {
		if (mode == CURSOR_MOVE && s->grab_moved)
			send_moving(s, "moved");
		s->grab_view = NULL;
		view_report(v);
	}
	wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, "default");
	process_motion(s, now_msec());
}

static void process_motion(struct server *s, uint32_t time) {
	if (s->cursor_mode == CURSOR_MOVE && s->grab_view) {
		do_move(s, time);
		return;
	}
	if (s->cursor_mode == CURSOR_RESIZE && s->grab_view) {
		do_resize(s);
		return;
	}
	if (s->seat->drag)
		wlr_scene_node_set_position(&s->drag_layer->node, (int)s->cursor->x, (int)s->cursor->y);
	/* while a button is held, the window it went down on keeps getting the pointer */
	if (!s->seat->drag && s->seat->pointer_state.button_count > 0 && s->seat->pointer_state.focused_surface) {
		wlr_seat_pointer_notify_motion(s->seat, time, s->cursor->x - s->press_ox, s->cursor->y - s->press_oy);
		return;
	}
	double sx, sy;
	struct view *v;
	struct wlr_surface *surf = surface_at(s, s->cursor->x, s->cursor->y, &sx, &sy, &v);
	if (!surf) {
		wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, "default");
		wlr_seat_pointer_clear_focus(s->seat);
		return;
	}
	wlr_seat_pointer_notify_enter(s->seat, surf, sx, sy);
	wlr_seat_pointer_notify_motion(s->seat, time, sx, sy);
}

static void handle_cursor_motion(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_motion);
	struct wlr_pointer_motion_event *e = data;
	note_input(s);
	wlr_cursor_move(s->cursor, &e->pointer->base, e->delta_x, e->delta_y);
	process_motion(s, e->time_msec);
}

static void handle_cursor_motion_absolute(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_motion_absolute);
	struct wlr_pointer_motion_absolute_event *e = data;
	note_input(s);
	wlr_cursor_warp_absolute(s->cursor, &e->pointer->base, e->x, e->y);
	process_motion(s, e->time_msec);
}

static void handle_cursor_button(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_button);
	struct wlr_pointer_button_event *e = data;
	note_input(s);
	if (e->state == WLR_BUTTON_RELEASED) {
		wlr_seat_pointer_notify_button(s->seat, e->time_msec, e->button, e->state);
		if (s->cursor_mode != CURSOR_PASSTHROUGH && s->seat->pointer_state.button_count == 0)
			end_grab(s);
		else if (s->seat->pointer_state.button_count == 0)
			process_motion(s, e->time_msec);
		return;
	}
	double sx, sy;
	struct view *v;
	struct wlr_surface *surf = surface_at(s, s->cursor->x, s->cursor->y, &sx, &sy, &v);
	if (surf && s->seat->pointer_state.button_count == 0) {
		s->press_ox = s->cursor->x - sx;
		s->press_oy = s->cursor->y - sy;
	}
	if (v && v->kind == VIEW_APP) {
		bool covered = pixman_region32_not_empty(&v->above_region);
		bool changed = s->active != v;
		if (!view_is_top(s, v) || covered)
			raise_view(s, v);
		set_focus(s, v);
		if ((changed || covered) && v->announced)
			send_simple(s, "focus", v->id);
	} else if (v && v->kind == VIEW_SHELL) {
		struct view *fv = frame_at(s, s->cursor->x, s->cursor->y);
		if (fv) { /* the title bar the desktop draws for an X11 window: the window comes forward */
			bool changed = s->active != fv;
			if (!view_is_top(s, fv))
				raise_view(s, fv);
			set_focus(s, fv);
			if (changed && fv->announced)
				send_simple(s, "focus", fv->id);
		} else if (s->active) {
			set_focus(s, NULL);
			send_simple(s, "focus", 0);
		}
	} else if (v && v->kind == VIEW_SHELL_DIALOG) {
		kbd_enter(s, v->toplevel->base->surface);
	}
	wlr_seat_pointer_notify_button(s->seat, e->time_msec, e->button, e->state);
}

static void handle_cursor_axis(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_axis);
	struct wlr_pointer_axis_event *e = data;
	note_input(s);
	double delta = e->delta;
	int32_t discrete = e->delta_discrete;
	if (e->source == WLR_AXIS_SOURCE_WHEEL && s->in.set && s->in.lines > 0 && s->in.lines != 3) {
		double f = s->in.lines / 3.0; /* "lines to scroll at a time", 3 being the usual */
		delta *= f;
		discrete = (int32_t)lround(discrete * f);
	}
	wlr_seat_pointer_notify_axis(s->seat, e->time_msec, e->orientation, delta, discrete, e->source);
}

static void handle_cursor_frame(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_frame);
	wlr_seat_pointer_notify_frame(s->seat);
}

static void handle_request_cursor(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_cursor);
	struct wlr_seat_pointer_request_set_cursor_event *e = data;
	if (s->cursor_mode != CURSOR_PASSTHROUGH)
		return;
	if (s->seat->pointer_state.focused_client == e->seat_client)
		wlr_cursor_set_surface(s->cursor, e->surface, e->hotspot_x, e->hotspot_y);
}

static void handle_request_set_shape(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_set_shape);
	struct wlr_cursor_shape_manager_v1_request_set_shape_event *e = data;
	if (s->cursor_mode != CURSOR_PASSTHROUGH)
		return;
	if (s->seat->pointer_state.focused_client == e->seat_client)
		wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, wlr_cursor_shape_v1_name(e->shape));
}

static void handle_request_set_selection(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_set_selection);
	struct wlr_seat_request_set_selection_event *e = data;
	wlr_seat_set_selection(s->seat, e->source, e->serial);
}

static void handle_request_set_primary_selection(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_set_primary_selection);
	struct wlr_seat_request_set_primary_selection_event *e = data;
	wlr_seat_set_primary_selection(s->seat, e->source, e->serial);
}

static void handle_request_start_drag(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, request_start_drag);
	struct wlr_seat_request_start_drag_event *e = data;
	if (wlr_seat_validate_pointer_grab_serial(s->seat, e->origin, e->serial)) {
		wlr_seat_start_pointer_drag(s->seat, e->drag, e->serial);
		return;
	}
	if (e->drag->source)
		wlr_data_source_destroy(e->drag->source);
}

static void handle_start_drag(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, start_drag);
	struct wlr_drag *drag = data;
	if (drag->icon)
		wlr_scene_drag_icon_create(s->drag_layer, drag->icon);
	wlr_scene_node_set_position(&s->drag_layer->node, (int)s->cursor->x, (int)s->cursor->y);
}

/* ---------- keyboard ---------- */

static void swallowed_add(struct server *s, uint32_t keycode) {
	for (int i = 0; i < s->n_swallowed; i++)
		if (s->swallowed[i] == keycode)
			return;
	if (s->n_swallowed < (int)(sizeof s->swallowed / sizeof s->swallowed[0]))
		s->swallowed[s->n_swallowed++] = keycode;
}

static bool swallowed_take(struct server *s, uint32_t keycode) {
	for (int i = 0; i < s->n_swallowed; i++) {
		if (s->swallowed[i] == keycode) {
			s->swallowed[i] = s->swallowed[--s->n_swallowed];
			return true;
		}
	}
	return false;
}

static bool is_super(xkb_keysym_t sym) {
	return sym == XKB_KEY_Super_L || sym == XKB_KEY_Super_R;
}

/*
 * Nimbus's own shortcuts while a program has the keyboard (while the desktop has it, its page sees
 * every key itself): the Windows key alone opens Start; Windows key combinations, Alt+Tab, Alt+F4 and
 * Ctrl+Shift+Esc go to the desktop instead of the program.
 */
static bool handle_global_key(struct server *s, uint32_t keycode, xkb_keysym_t sym, uint32_t mods, bool pressed) {
	if (!pressed) {
		if (!swallowed_take(s, keycode))
			return false;
		if (is_super(sym)) {
			s->super_down = false;
			if (s->super_alone) {
				s->super_alone = false;
				set_focus(s, NULL);
				send_key(s, "super");
			}
		}
		return true;
	}
	/* volume, brightness and Print screen belong to the desktop wherever the keyboard is */
	if (s->ipc_fd >= 0) {
		const char *media = NULL;
		switch (sym) {
		case XKB_KEY_XF86AudioRaiseVolume: media = "volume-up"; break;
		case XKB_KEY_XF86AudioLowerVolume: media = "volume-down"; break;
		case XKB_KEY_XF86AudioMute: media = "volume-mute"; break;
		case XKB_KEY_XF86AudioMicMute: media = "mic-mute"; break;
		case XKB_KEY_XF86MonBrightnessUp: media = "brightness-up"; break;
		case XKB_KEY_XF86MonBrightnessDown: media = "brightness-down"; break;
		case XKB_KEY_Print: media = "print"; break;
		default: break;
		}
		if (media) {
			swallowed_add(s, keycode);
			send_key(s, media);
			return true;
		}
	}
	if (!s->active || s->ipc_fd < 0)
		return false;
	if (is_super(sym)) {
		s->super_down = true;
		s->super_alone = true;
		swallowed_add(s, keycode);
		return true;
	}
	bool logo = mods & WLR_MODIFIER_LOGO, alt = mods & WLR_MODIFIER_ALT;
	bool ctrl = mods & WLR_MODIFIER_CTRL, shift = mods & WLR_MODIFIER_SHIFT;
	if (s->super_down || logo) {
		char name[64], key[80];
		s->super_alone = false;
		if (xkb_keysym_get_name(xkb_keysym_to_lower(sym), name, sizeof name) <= 0)
			return false;
		snprintf(key, sizeof key, shift ? "super+shift+%s" : "super+%s", name);
		swallowed_add(s, keycode);
		send_key(s, key);
		return true;
	}
	if (alt && !ctrl && (sym == XKB_KEY_Tab || sym == XKB_KEY_ISO_Left_Tab)) {
		swallowed_add(s, keycode);
		set_focus(s, NULL); /* the switcher on the desktop takes the next Tab presses and Alt's release */
		send_key(s, shift || sym == XKB_KEY_ISO_Left_Tab ? "alt+shift+tab" : "alt+tab");
		return true;
	}
	if (alt && !ctrl && sym == XKB_KEY_F4) {
		swallowed_add(s, keycode);
		send_key(s, "alt+f4");
		return true;
	}
	if (ctrl && shift && sym == XKB_KEY_Escape) {
		swallowed_add(s, keycode);
		send_key(s, "ctrl+shift+escape");
		return true;
	}
	if (ctrl && alt && (sym == XKB_KEY_Delete || sym == XKB_KEY_t || sym == XKB_KEY_l || sym == XKB_KEY_d)) {
		char name[64], key[80];
		xkb_keysym_get_name(xkb_keysym_to_lower(sym), name, sizeof name);
		snprintf(key, sizeof key, "ctrl+alt+%s", name);
		swallowed_add(s, keycode);
		send_key(s, key);
		return true;
	}
	return false;
}

static void keyboard_handle_modifiers(struct wl_listener *l, void *data) {
	struct keyboard *k = wl_container_of(l, k, modifiers);
	wlr_seat_set_keyboard(k->server->seat, k->wlr_keyboard);
	wlr_seat_keyboard_notify_modifiers(k->server->seat, &k->wlr_keyboard->modifiers);
}

static void keyboard_handle_key(struct wl_listener *l, void *data) {
	struct keyboard *k = wl_container_of(l, k, key);
	struct server *s = k->server;
	struct wlr_keyboard_key_event *e = data;
	note_input(s);
	uint32_t keycode = e->keycode + 8;
	const xkb_keysym_t *syms = NULL;
	int n = k->wlr_keyboard->xkb_state ? xkb_state_key_get_syms(k->wlr_keyboard->xkb_state, keycode, &syms) : 0;
	xkb_keysym_t sym = n > 0 ? syms[0] : XKB_KEY_NoSymbol;
	bool pressed = e->state == WL_KEYBOARD_KEY_STATE_PRESSED;
	if (pressed && sym >= XKB_KEY_XF86Switch_VT_1 && sym <= XKB_KEY_XF86Switch_VT_12) {
		if (s->session)
			wlr_session_change_vt(s->session, sym - XKB_KEY_XF86Switch_VT_1 + 1);
		return;
	}
	if (s->super_down && pressed && !is_super(sym))
		s->super_alone = false;
	if (handle_global_key(s, e->keycode, sym, wlr_keyboard_get_modifiers(k->wlr_keyboard), pressed))
		return;
	wlr_seat_set_keyboard(s->seat, k->wlr_keyboard);
	wlr_seat_keyboard_notify_key(s->seat, e->time_msec, e->keycode, e->state);
}

static void keyboard_handle_destroy(struct wl_listener *l, void *data) {
	struct keyboard *k = wl_container_of(l, k, destroy);
	struct server *s = k->server;
	unlisten(&k->modifiers);
	unlisten(&k->key);
	unlisten(&k->destroy);
	wl_list_remove(&k->link);
	free(k);
	send_inputs(s);
}

/* The keyboard layout and key repeat from Settings > Time & language > Typing */
static bool keyboard_apply(struct server *s, struct wlr_keyboard *kb) {
	struct xkb_rule_names names = { 0 };
	names.layout = s->kb_layout[0] ? s->kb_layout : NULL;
	names.variant = s->kb_variant[0] ? s->kb_variant : NULL;
	struct xkb_context *ctx = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
	if (!ctx)
		return false;
	struct xkb_keymap *keymap = xkb_keymap_new_from_names(ctx, &names, XKB_KEYMAP_COMPILE_NO_FLAGS);
	bool ok = keymap != NULL;
	if (!keymap) /* a layout this system doesn't have: the default one */
		keymap = xkb_keymap_new_from_names(ctx, NULL, XKB_KEYMAP_COMPILE_NO_FLAGS);
	if (keymap) {
		wlr_keyboard_set_keymap(kb, keymap);
		xkb_keymap_unref(keymap);
	}
	xkb_context_unref(ctx);
	wlr_keyboard_set_repeat_info(kb, s->kb_rate > 0 ? s->kb_rate : 25, s->kb_delay > 0 ? s->kb_delay : 600);
	return ok;
}

static void add_keyboard(struct server *s, struct wlr_keyboard *kb, bool set_keymap) {
	struct keyboard *k = calloc(1, sizeof *k);
	if (!k)
		return;
	k->server = s;
	k->wlr_keyboard = kb;
	k->virtual_kb = !set_keymap;
	if (set_keymap)
		keyboard_apply(s, kb);
	hook(&kb->events.modifiers, &k->modifiers, keyboard_handle_modifiers);
	hook(&kb->events.key, &k->key, keyboard_handle_key);
	hook(&kb->base.events.destroy, &k->destroy, keyboard_handle_destroy);
	wlr_seat_set_keyboard(s->seat, kb);
	wl_list_insert(&s->keyboards, &k->link);
	send_inputs(s);
}

static void update_capabilities(struct server *s) {
	uint32_t caps = WL_SEAT_CAPABILITY_POINTER;
	if (!wl_list_empty(&s->keyboards))
		caps |= WL_SEAT_CAPABILITY_KEYBOARD;
	wlr_seat_set_capabilities(s->seat, caps);
}

/* Mice and touchpads, as Settings > Bluetooth & devices sets them. Before the desktop says anything,
   touchpads tap to click and scroll naturally, as on Windows. */
static void configure_pointer(struct server *s, struct wlr_input_device *device) {
	if (!wlr_input_device_is_libinput(device))
		return;
	struct libinput_device *li = wlr_libinput_get_device_handle(device);
	if (!li)
		return;
	bool touchpad = libinput_device_config_tap_get_finger_count(li) > 0;
	if (!s->in.set) {
		if (touchpad) {
			libinput_device_config_tap_set_enabled(li, LIBINPUT_CONFIG_TAP_ENABLED);
			libinput_device_config_tap_set_drag_enabled(li, LIBINPUT_CONFIG_DRAG_ENABLED);
			if (libinput_device_config_scroll_has_natural_scroll(li))
				libinput_device_config_scroll_set_natural_scroll_enabled(li, 1);
		}
		return;
	}
	if (libinput_device_config_accel_is_available(li)) {
		libinput_device_config_accel_set_speed(li, touchpad ? s->in.tspeed : s->in.speed);
		if (!touchpad)
			libinput_device_config_accel_set_profile(li, s->in.accel ? LIBINPUT_CONFIG_ACCEL_PROFILE_ADAPTIVE : LIBINPUT_CONFIG_ACCEL_PROFILE_FLAT);
	}
	if (libinput_device_config_left_handed_is_available(li))
		libinput_device_config_left_handed_set(li, s->in.left);
	if (libinput_device_config_scroll_has_natural_scroll(li))
		libinput_device_config_scroll_set_natural_scroll_enabled(li, touchpad ? s->in.tnatural : s->in.natural);
	if (!touchpad)
		return;
	libinput_device_config_tap_set_enabled(li, s->in.tap ? LIBINPUT_CONFIG_TAP_ENABLED : LIBINPUT_CONFIG_TAP_DISABLED);
	libinput_device_config_tap_set_drag_enabled(li, LIBINPUT_CONFIG_DRAG_ENABLED);
	libinput_device_config_tap_set_button_map(li, LIBINPUT_CONFIG_TAP_MAP_LRM);
	if (libinput_device_config_dwt_is_available(li))
		libinput_device_config_dwt_set_enabled(li, s->in.dwt ? LIBINPUT_CONFIG_DWT_ENABLED : LIBINPUT_CONFIG_DWT_DISABLED);
	uint32_t methods = libinput_device_config_scroll_get_methods(li);
	if (s->in.twofinger && (methods & LIBINPUT_CONFIG_SCROLL_2FG))
		libinput_device_config_scroll_set_method(li, LIBINPUT_CONFIG_SCROLL_2FG);
	else if (!s->in.twofinger && (methods & LIBINPUT_CONFIG_SCROLL_EDGE))
		libinput_device_config_scroll_set_method(li, LIBINPUT_CONFIG_SCROLL_EDGE);
	libinput_device_config_send_events_set_mode(li, s->in.touchpad ? LIBINPUT_CONFIG_SEND_EVENTS_ENABLED : LIBINPUT_CONFIG_SEND_EVENTS_DISABLED);
}

static void pointer_handle_destroy(struct wl_listener *l, void *data) {
	struct pointer *p = wl_container_of(l, p, destroy);
	struct server *s = p->server;
	unlisten(&p->destroy);
	wl_list_remove(&p->link);
	free(p);
	send_inputs(s);
}

static void handle_new_input(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_input);
	struct wlr_input_device *device = data;
	switch (device->type) {
	case WLR_INPUT_DEVICE_KEYBOARD:
		add_keyboard(s, wlr_keyboard_from_input_device(device), true);
		break;
	case WLR_INPUT_DEVICE_POINTER: {
		configure_pointer(s, device);
		wlr_cursor_attach_input_device(s->cursor, device);
		struct pointer *p = calloc(1, sizeof *p);
		if (p) {
			p->server = s;
			p->device = device;
			hook(&device->events.destroy, &p->destroy, pointer_handle_destroy);
			wl_list_insert(s->pointers.prev, &p->link);
			send_inputs(s);
		}
		break;
	}
	default:
		break;
	}
	update_capabilities(s);
}

static void handle_new_virtual_keyboard(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_virtual_keyboard);
	struct wlr_virtual_keyboard_v1 *vk = data;
	add_keyboard(s, &vk->keyboard, false);
	update_capabilities(s);
}

static void handle_new_virtual_pointer(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_virtual_pointer);
	struct wlr_virtual_pointer_v1_new_pointer_event *e = data;
	wlr_cursor_attach_input_device(s->cursor, &e->new_pointer->pointer.base);
}

/* ---------- outputs ---------- */

static void update_overlay(struct server *s) {
	wlr_scene_rect_set_size(s->dim_rect, s->screen.width, s->screen.height);
	wlr_scene_rect_set_size(s->night_rect, s->screen.width, s->screen.height);
	wlr_scene_node_set_position(&s->overlay->node, s->screen.x, s->screen.y);
}

static void update_screen(struct server *s) {
	struct wlr_box box = { 0 };
	if (!wl_list_empty(&s->outputs)) {
		struct output *o = wl_container_of(s->outputs.next, o, link);
		wlr_output_layout_get_box(s->output_layout, o->wlr_output, &box);
	}
	if (wlr_box_empty(&box) || memcmp(&box, &s->screen, sizeof box) == 0)
		return;
	s->screen = box;
	wlr_log(WLR_INFO, "screen %dx%d at %d,%d", box.width, box.height, box.x, box.y);
	if (s->shell) {
		s->shell->x = box.x;
		s->shell->y = box.y;
		wlr_xdg_toplevel_set_size(s->shell->toplevel, box.width, box.height);
		if (s->shell->mapped)
			view_update_position(s->shell);
	}
	update_overlay(s);
	struct view *v;
	wl_list_for_each(v, &s->views, link)
		if (v->state == STATE_FULL)
			view_configure(v, STATE_FULL, box);
	if (s->ipc_fd >= 0)
		send_screen(s, "output");
}

static void output_handle_frame(struct wl_listener *l, void *data) {
	struct output *o = wl_container_of(l, o, frame);
	struct server *s = o->server;
	wlr_scene_output_commit(o->scene_output, NULL);
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	wlr_scene_output_send_frame_done(o->scene_output, &now);
	struct wlr_surface *surf = shell_surface(s);
	if (surf)
		wlr_surface_send_frame_done(surf, &now);
}

static void output_handle_request_state(struct wl_listener *l, void *data) {
	struct output *o = wl_container_of(l, o, request_state);
	const struct wlr_output_event_request_state *e = data;
	wlr_output_commit_state(o->wlr_output, e->state);
	update_screen(o->server);
	send_outputs(o->server);
}

static void output_handle_destroy(struct wl_listener *l, void *data) {
	struct output *o = wl_container_of(l, o, destroy);
	struct server *s = o->server;
	unlisten(&o->frame);
	unlisten(&o->request_state);
	unlisten(&o->destroy);
	wl_list_remove(&o->link);
	free(o);
	update_screen(s);
	send_outputs(s);
}

static void handle_new_output(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_output);
	struct wlr_output *wo = data;
	wlr_output_init_render(wo, s->allocator, s->renderer);
	struct wlr_output_state st;
	wlr_output_state_init(&st);
	wlr_output_state_set_enabled(&st, true);
	struct wlr_output_mode *mode = wlr_output_preferred_mode(wo);
	if (mode)
		wlr_output_state_set_mode(&st, mode);
	wlr_output_commit_state(wo, &st);
	wlr_output_state_finish(&st);

	struct output *o = calloc(1, sizeof *o);
	if (!o)
		return;
	o->server = s;
	o->wlr_output = wo;
	hook(&wo->events.frame, &o->frame, output_handle_frame);
	hook(&wo->events.request_state, &o->request_state, output_handle_request_state);
	hook(&wo->events.destroy, &o->destroy, output_handle_destroy);
	wl_list_insert(s->outputs.prev, &o->link);
	struct wlr_output_layout_output *lo = wlr_output_layout_add_auto(s->output_layout, wo);
	o->scene_output = wlr_scene_output_create(s->scene, wo);
	wlr_scene_output_layout_add_output(s->scene_layout, lo, o->scene_output);
	update_screen(s);
	send_outputs(s);
}

/* A display's mode, scale and rotation (Settings > System > Display). */
static void output_configure(struct server *s, struct wlr_output *wo, int w, int h, int mhz, double scale, int transform) {
	struct wlr_output_state st;
	wlr_output_state_init(&st);
	wlr_output_state_set_enabled(&st, true);
	struct wlr_output_mode *m, *best = NULL;
	wl_list_for_each(m, &wo->modes, link) {
		if (m->width != w || m->height != h)
			continue;
		if (!best || abs(m->refresh - mhz) < abs(best->refresh - mhz))
			best = m;
	}
	if (best)
		wlr_output_state_set_mode(&st, best);
	else if (wl_list_empty(&wo->modes))
		wlr_output_state_set_custom_mode(&st, w, h, mhz);
	if (scale >= 0.5 && scale <= 4)
		wlr_output_state_set_scale(&st, (float)scale);
	if (transform >= 0 && transform <= 7)
		wlr_output_state_set_transform(&st, (enum wl_output_transform)transform);
	if (!wlr_output_test_state(wo, &st))
		wlr_log(WLR_ERROR, "%s can't do %dx%d@%d scale %.2f", wo->name, w, h, mhz, scale);
	else if (!wlr_output_commit_state(wo, &st))
		wlr_log(WLR_ERROR, "%s didn't take %dx%d@%d", wo->name, w, h, mhz);
	else
		wlr_log(WLR_INFO, "%s now %dx%d@%d scale %.2f transform %d", wo->name, wo->width, wo->height, wo->refresh, wo->scale, wo->transform);
	wlr_output_state_finish(&st);
	update_screen(s);
	send_outputs(s);
}

/* ---------- screen timeout and sleep ---------- */

static void screen_power(struct server *s, bool on) {
	s->screen_off = !on;
	struct output *o;
	wl_list_for_each(o, &s->outputs, link) {
		struct wlr_output_state st;
		wlr_output_state_init(&st);
		wlr_output_state_set_enabled(&st, on);
		if (on && o->wlr_output->current_mode)
			wlr_output_state_set_mode(&st, o->wlr_output->current_mode);
		if (!wlr_output_commit_state(o->wlr_output, &st))
			wlr_log(WLR_ERROR, "could not turn %s %s", o->wlr_output->name, on ? "on" : "off");
		wlr_output_state_finish(&st);
	}
	wlr_log(WLR_INFO, "screen %s", on ? "on" : "off");
	if (s->ipc_fd >= 0)
		send_idle(s, on ? "on" : "off");
}

static void note_input(struct server *s) {
	s->last_input = now_msec();
	s->sleep_sent = false;
	if (s->screen_off)
		screen_power(s, true);
}

static int handle_idle_timer(void *data) {
	struct server *s = data;
	uint32_t now = now_msec();
	if (s->inhibitors > 0) /* a video playing, say */
		s->last_input = now;
	uint32_t idle = now - s->last_input;
	if (s->idle_screen > 0 && !s->screen_off && idle >= (uint32_t)s->idle_screen * 1000)
		screen_power(s, false);
	if (s->idle_sleep > 0 && !s->sleep_sent && idle >= (uint32_t)s->idle_sleep * 1000 && s->ipc_fd >= 0) {
		s->sleep_sent = true;
		send_idle(s, "sleep");
	}
	wl_event_source_timer_update(s->idle_timer, 5000);
	return 0;
}

static void inhibitor_handle_destroy(struct wl_listener *l, void *data) {
	struct inhibitor *in = wl_container_of(l, in, destroy);
	in->server->inhibitors--;
	in->server->last_input = now_msec();
	unlisten(&in->destroy);
	free(in);
}

static void handle_new_inhibitor(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_inhibitor);
	struct wlr_idle_inhibitor_v1 *inh = data;
	struct inhibitor *in = calloc(1, sizeof *in);
	if (!in)
		return;
	in->server = s;
	s->inhibitors++;
	hook(&inh->events.destroy, &in->destroy, inhibitor_handle_destroy);
}

/* Clipboard history: Ctrl+V in the window that has the keyboard */
static void press_paste(struct server *s) {
	struct wlr_keyboard *kb = wlr_seat_get_keyboard(s->seat);
	if (!kb || !kb->keymap || !s->seat->keyboard_state.focused_surface)
		return;
	uint32_t code = 47; /* KEY_V */
	xkb_keycode_t min = xkb_keymap_min_keycode(kb->keymap), max = xkb_keymap_max_keycode(kb->keymap);
	for (xkb_keycode_t kc = min; kc <= max; kc++) {
		const xkb_keysym_t *syms;
		int n = xkb_keymap_key_get_syms_by_level(kb->keymap, kc, 0, 0, &syms);
		if (n > 0 && syms[0] == XKB_KEY_v) {
			code = kc - 8;
			break;
		}
	}
	xkb_mod_index_t ctrl = xkb_keymap_mod_get_index(kb->keymap, XKB_MOD_NAME_CTRL);
	if (ctrl == XKB_MOD_INVALID)
		return;
	struct wlr_keyboard_modifiers mods = kb->modifiers;
	mods.depressed |= 1u << ctrl;
	uint32_t t = now_msec();
	wlr_seat_keyboard_notify_modifiers(s->seat, &mods);
	wlr_seat_keyboard_notify_key(s->seat, t, code, WL_KEYBOARD_KEY_STATE_PRESSED);
	wlr_seat_keyboard_notify_key(s->seat, t + 1, code, WL_KEYBOARD_KEY_STATE_RELEASED);
	wlr_seat_keyboard_notify_modifiers(s->seat, &kb->modifiers);
}

/* ---------- X11 programs (Xwayland) ---------- */
/* Programs that only speak X11 (Steam, Discord, Battle.net and other Windows programs through Wine, most games)
   draw through Xwayland. Their windows are views like Wayland programs' windows; menus, tooltips and splash
   screens ("popups" here) are drawn where the program puts them, with the window they belong to. Windows that
   ask the window manager for a frame get a title bar drawn by the desktop ("deco" in the window's events). */

static bool x11_has_type(struct server *s, struct wlr_xwayland_surface *xs, enum x11_atom a) {
	if (!s->x11_atoms[a])
		return false;
	for (size_t i = 0; i < xs->window_type_len; i++)
		if (xs->window_type[i] == s->x11_atoms[a])
			return true;
	return false;
}

static bool x11_is_popup(struct view *v) {
	if (v->xs->override_redirect)
		return true;
	for (int a = 0; a < X11_ATOMS; a++)
		if (x11_has_type(v->server, v->xs, (enum x11_atom)a))
			return true;
	return false;
}

static bool x11_wants_deco(struct view *v) {
	return !v->x11_popup && v->xs->decorations == WLR_XWAYLAND_SURFACE_DECORATIONS_ALL;
}

static void x11_send_deco(struct view *v) {
	if (!v->announced)
		return;
	struct jbuf j;
	jb_begin(&j, "deco");
	jb_int(&j, "id", v->id);
	jb_int(&j, "deco", v->deco_top);
	jb_send(v->server, &j);
}

/* The window a popup belongs to: the one it names, else the active window or the top window of its program */
static struct view *x11_owner(struct view *v) {
	struct server *s = v->server;
	for (struct wlr_xwayland_surface *p = v->xs->parent; p; p = p->parent) {
		struct view *pv = p->data;
		if (pv && pv->id && !pv->x11_popup && pv->mapped)
			return pv;
	}
	pid_t pid = v->xs->pid;
	struct view *a = s->active;
	if (a && a->xs && a->mapped && (!pid || a->xs->pid == pid))
		return a;
	struct wlr_scene_node *node;
	wl_list_for_each_reverse(node, &s->app_layer->children, link) {
		struct view *o;
		wl_list_for_each(o, &s->views, link)
			if (&o->root->node == node && o->xs && o->mapped && !o->hidden && pid && o->xs->pid == pid)
				return o;
	}
	return NULL;
}

static void x11_content_destroyed(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, content_destroy);
	unlisten(&v->content_destroy);
	v->content = NULL;
}

static void x11_add_content(struct view *v, struct wlr_scene_tree *parent) {
	v->content = wlr_scene_subsurface_tree_create(parent, v->xs->surface);
	if (v->content)
		hook(&v->content->node.events.destroy, &v->content_destroy, x11_content_destroyed);
}

static void x11_drop_content(struct view *v) {
	if (!v->content)
		return;
	unlisten(&v->content_destroy);
	wlr_scene_node_destroy(&v->content->node);
	v->content = NULL;
}

static void x11_popup_map(struct view *v) {
	struct server *s = v->server;
	struct wlr_xwayland_surface *xs = v->xs;
	struct view *owner = x11_owner(v);
	x11_add_content(v, owner ? owner->root : s->x11_layer);
	if (!v->content)
		return;
	if (owner) /* above its window, below the desktop's parts over that window */
		wlr_scene_node_place_above(&v->content->node, &owner->tree->node);
	if (x11_has_type(s, xs, TYPE_SPLASH) && !xs->x && !xs->y) {
		struct wlr_box w = work_area(s);
		wlr_xwayland_surface_configure(xs, (int16_t)(w.x + (w.width - xs->width) / 2),
			(int16_t)(w.y + (w.height - xs->height) / 2), MAX(xs->width, 1), MAX(xs->height, 1));
	}
	wlr_scene_node_set_position(&v->content->node, xs->x, xs->y);
	v->mapped = true;
	/* menus don't take the keyboard (their window keeps it); other windows the program places itself may */
	if (wlr_xwayland_or_surface_wants_focus(xs) && wlr_xwayland_icccm_input_model(xs) != WLR_ICCCM_INPUT_MODEL_NONE &&
			!xs->override_redirect) {
		kbd_enter(s, xs->surface);
		v->kbd_popup = true;
	}
}

/* Returns false for popups, which are on screen once this returns. */
static bool x11_map(struct view *v) {
	struct server *s = v->server;
	struct wlr_xwayland_surface *xs = v->xs;
	v->x11_popup = x11_is_popup(v) && !(v->id && !xs->override_redirect);
	if (v->x11_popup) {
		x11_popup_map(v);
		return false;
	}
	if (!v->id) {
		v->id = ++s->next_id;
		v->root = wlr_scene_tree_create(s->app_layer);
		v->tree = wlr_scene_tree_create(v->root);
		v->above = wlr_scene_tree_create(v->root);
		v->tree->node.data = v;
		wlr_scene_node_set_enabled(&v->root->node, false);
		wl_list_insert(s->views.prev, &v->link);
	}
	x11_add_content(v, v->tree);
	v->deco_top = x11_wants_deco(v) ? DECO_TOP : 0;
	if (!v->placed)
		view_place_initial(v);
	if (xs->fullscreen)
		view_configure(v, STATE_FULL, s->screen);
	else if (xs->maximized_horz && xs->maximized_vert)
		view_configure(v, STATE_MAX, below_title(v, work_area(s)));
	return true;
}

static void x11_unmap(struct view *v) {
	struct server *s = v->server;
	x11_drop_content(v);
	if (!v->x11_popup)
		return;
	v->mapped = false;
	if (v->kbd_popup) {
		v->kbd_popup = false;
		set_focus(s, s->active);
	}
}

static void x11_handle_associate(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, associate);
	struct wlr_surface *surf = v->xs->surface;
	hook(&surf->events.map, &v->map, view_handle_map);
	hook(&surf->events.unmap, &v->unmap, view_handle_unmap);
	hook(&surf->events.commit, &v->commit, view_handle_commit);
}

static void x11_handle_dissociate(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, dissociate);
	unlisten(&v->map);
	unlisten(&v->unmap);
	unlisten(&v->commit);
}

static void x11_handle_destroy(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, destroy);
	struct server *s = v->server;
	struct wl_listener *all[] = { &v->map, &v->unmap, &v->commit, &v->destroy, &v->associate, &v->dissociate,
		&v->request_configure, &v->request_move, &v->request_resize, &v->request_maximize, &v->request_fullscreen,
		&v->request_minimize, &v->request_activate, &v->set_title, &v->set_app_id, &v->set_parent,
		&v->set_decorations, &v->set_geometry };
	for (size_t i = 0; i < sizeof all / sizeof all[0]; i++)
		unlisten(all[i]);
	x11_drop_content(v);
	if (s->grab_view == v) {
		s->cursor_mode = CURSOR_PASSTHROUGH;
		s->grab_view = NULL;
	}
	if (s->active == v)
		s->active = NULL;
	if (v->id) {
		if (v->announced)
			send_simple(s, "gone", v->id);
		wl_list_remove(&v->link);
		wlr_scene_node_destroy(&v->root->node);
	}
	v->xs->data = NULL;
	pixman_region32_fini(&v->above_region);
	pixman_region32_fini(&v->copied);
	free(v);
}

/* A program moves or resizes its own window */
static void x11_handle_request_configure(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_configure);
	struct wlr_xwayland_surface_configure_event *e = data;
	struct server *s = v->server;
	if (!v->mapped || v->x11_popup) {
		wlr_xwayland_surface_configure(v->xs, e->x, e->y, MAX(e->width, 1), MAX(e->height, 1));
		if (v->x11_popup && v->content)
			wlr_scene_node_set_position(&v->content->node, e->x, e->y);
		if (!v->mapped && v->placed && (e->mask & (XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y))) {
			v->x = e->x;
			v->y = e->y;
		}
		return;
	}
	if (v->state != STATE_NORMAL || s->grab_view == v) {
		/* maximized, snapped and full-screen windows stay as they are; the program is told so */
		wlr_xwayland_surface_configure(v->xs, (int16_t)v->x, (int16_t)v->y, MAX(v->xs->width, 1), MAX(v->xs->height, 1));
		return;
	}
	struct wlr_box w = work_area(s);
	int x = e->mask & XCB_CONFIG_WINDOW_X ? e->x : v->x;
	int y = e->mask & XCB_CONFIG_WINDOW_Y ? e->y : v->y;
	x = MAX(w.x - e->width + 100, MIN(x, w.x + w.width - 100));
	y = MAX(w.y + v->deco_top, MIN(y, w.y + w.height - 40));
	v->x = x;
	v->y = y;
	wlr_xwayland_surface_configure(v->xs, (int16_t)x, (int16_t)y, MAX(e->width, 1), MAX(e->height, 1));
	view_update_position(v);
}

static void x11_handle_request_resize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_resize);
	struct wlr_xwayland_resize_event *e = data;
	begin_grab(v, CURSOR_RESIZE, e->edges, false);
}

static void x11_handle_request_maximize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_maximize);
	if (!v->mapped || v->x11_popup)
		return; /* asked before the window shows: it opens maximized */
	bool want = v->xs->maximized_horz && v->xs->maximized_vert;
	if (want && v->state != STATE_MAX)
		view_configure(v, STATE_MAX, below_title(v, work_area(v->server)));
	else if (!want && v->state == STATE_MAX)
		view_restore(v);
	else
		wlr_xwayland_surface_set_maximized(v->xs, v->state == STATE_MAX);
	view_report(v);
}

static void x11_handle_request_fullscreen(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_fullscreen);
	struct server *s = v->server;
	if (!v->mapped || v->x11_popup)
		return;
	if (v->xs->fullscreen && v->state != STATE_FULL) {
		view_configure(v, STATE_FULL, s->screen);
		raise_view(s, v);
	} else if (!v->xs->fullscreen && v->state == STATE_FULL) {
		view_restore(v);
	} else {
		wlr_xwayland_surface_set_fullscreen(v->xs, v->state == STATE_FULL);
	}
	view_report(v);
}

static void x11_handle_request_minimize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_minimize);
	struct wlr_xwayland_minimize_event *e = data;
	if (!v->mapped || v->x11_popup)
		return;
	if (!v->announced) {
		wlr_xwayland_surface_set_minimized(v->xs, false);
		return;
	}
	send_request(v, e->minimize ? "min" : "activate", 0, 0);
}

static void x11_handle_request_activate(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_activate);
	struct server *s = v->server;
	if (!v->mapped || v->x11_popup)
		return;
	if (v->announced) {
		send_request(v, "activate", 0, 0);
	} else {
		raise_view(s, v);
		set_focus(s, v);
	}
}

static void x11_handle_set_decorations(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_decorations);
	struct server *s = v->server;
	if (!v->mapped || v->x11_popup)
		return;
	int top = x11_wants_deco(v) ? DECO_TOP : 0;
	if (top == v->deco_top)
		return;
	v->deco_top = top;
	if (v->state == STATE_MAX) {
		view_configure(v, STATE_MAX, below_title(v, work_area(s)));
	} else if (v->state == STATE_NORMAL && v->y - top < work_area(s).y) {
		v->y = work_area(s).y + top;
		view_update_position(v);
	}
	x11_send_deco(v);
	view_report(v);
}

static void x11_handle_set_geometry(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_geometry);
	if (v->x11_popup && v->content)
		wlr_scene_node_set_position(&v->content->node, v->xs->x, v->xs->y);
}

static void handle_new_xwayland_surface(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_xwayland_surface);
	struct wlr_xwayland_surface *xs = data;
	struct view *v = calloc(1, sizeof *v);
	if (!v)
		return;
	v->server = s;
	v->kind = VIEW_APP;
	v->xs = xs;
	xs->data = v;
	wl_list_init(&v->link);
	pixman_region32_init(&v->above_region);
	pixman_region32_init(&v->copied);
	hook(&xs->events.destroy, &v->destroy, x11_handle_destroy);
	hook(&xs->events.associate, &v->associate, x11_handle_associate);
	hook(&xs->events.dissociate, &v->dissociate, x11_handle_dissociate);
	hook(&xs->events.request_configure, &v->request_configure, x11_handle_request_configure);
	hook(&xs->events.request_move, &v->request_move, view_handle_request_move);
	hook(&xs->events.request_resize, &v->request_resize, x11_handle_request_resize);
	hook(&xs->events.request_maximize, &v->request_maximize, x11_handle_request_maximize);
	hook(&xs->events.request_fullscreen, &v->request_fullscreen, x11_handle_request_fullscreen);
	hook(&xs->events.request_minimize, &v->request_minimize, x11_handle_request_minimize);
	hook(&xs->events.request_activate, &v->request_activate, x11_handle_request_activate);
	hook(&xs->events.set_title, &v->set_title, view_handle_set_title);
	hook(&xs->events.set_class, &v->set_app_id, view_handle_set_app_id);
	hook(&xs->events.set_parent, &v->set_parent, view_handle_set_parent);
	hook(&xs->events.set_decorations, &v->set_decorations, x11_handle_set_decorations);
	hook(&xs->events.set_geometry, &v->set_geometry, x11_handle_set_geometry);
}

/* X11 programs' own pointer image, for where they don't set one */
static void x11_set_cursor(struct server *s) {
	if (!s->xwayland || !s->xwayland->xwm || !wlr_xcursor_manager_load(s->cursor_mgr, 1))
		return;
	struct wlr_xcursor *xc = wlr_xcursor_manager_get_xcursor(s->cursor_mgr, "default", 1);
	if (!xc)
		xc = wlr_xcursor_manager_get_xcursor(s->cursor_mgr, "left_ptr", 1);
	if (!xc || !xc->image_count)
		return;
	struct wlr_xcursor_image *img = xc->images[0];
	wlr_xwayland_set_cursor(s->xwayland, img->buffer, img->width * 4, img->width, img->height,
		(int32_t)img->hotspot_x, (int32_t)img->hotspot_y);
}

/* X11 programs keep their menus out of the taskbar with this */
static void x11_set_workarea(struct server *s) {
	if (!s->xwayland || !s->xwayland->xwm)
		return;
	struct wlr_box w = work_area(s);
	wlr_xwayland_set_workareas(s->xwayland, &w, 1);
}

/* Xwayland started (it starts when the first X11 program does, and stops a while after the last one ends) */
static void handle_xwayland_ready(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, xwayland_ready_listener);
	wlr_xwayland_set_seat(s->xwayland, s->seat);
	x11_set_cursor(s);
	x11_set_workarea(s);
	xcb_connection_t *c = xcb_connect(s->xwayland->display_name, NULL);
	if (xcb_connection_has_error(c)) {
		wlr_log(WLR_ERROR, "cannot talk to Xwayland on %s", s->xwayland->display_name);
		xcb_disconnect(c);
		return;
	}
	xcb_intern_atom_cookie_t cookies[X11_ATOMS];
	for (int i = 0; i < X11_ATOMS; i++)
		cookies[i] = xcb_intern_atom(c, 0, (uint16_t)strlen(x11_atom_names[i]), x11_atom_names[i]);
	for (int i = 0; i < X11_ATOMS; i++) {
		xcb_intern_atom_reply_t *r = xcb_intern_atom_reply(c, cookies[i], NULL);
		s->x11_atoms[i] = r ? r->atom : XCB_ATOM_NONE;
		free(r);
	}
	xcb_disconnect(c);
	wlr_log(WLR_INFO, "Xwayland is ready on DISPLAY=%s", s->xwayland->display_name);
}

static void view_close(struct view *v) {
	if (v->xs)
		wlr_xwayland_surface_close(v->xs);
	else
		wlr_xdg_toplevel_send_close(v->toplevel);
}

/* ---------- commands from the desktop ---------- */

struct tok {
	char *p;
	bool ok;
};

static long tok_int(struct tok *t) {
	if (!t->ok)
		return 0;
	char *end;
	long v = strtol(t->p, &end, 10);
	if (end == t->p) {
		t->ok = false;
		return 0;
	}
	t->p = end;
	return v;
}

static bool tok_word(struct tok *t, char *out, size_t n) {
	if (!t->ok)
		return false;
	while (*t->p == ' ')
		t->p++;
	size_t i = 0;
	while (*t->p && *t->p != ' ') {
		if (i + 1 < n)
			out[i++] = *t->p;
		t->p++;
	}
	out[i] = 0;
	if (!i)
		t->ok = false;
	return t->ok;
}

/* A rectangle with rounded corners, made of thin bands that stay inside the curve. */
static void region_add_rounded(pixman_region32_t *reg, int x, int y, int w, int h, int r) {
	if (w <= 0 || h <= 0)
		return;
	r = MIN(r, MIN(w / 2, h / 2));
	if (r <= 1) {
		pixman_region32_union_rect(reg, reg, x, y, (unsigned)w, (unsigned)h);
		return;
	}
	pixman_region32_union_rect(reg, reg, x, y + r, (unsigned)w, (unsigned)(h - 2 * r));
	for (int i = 0; i < r; i += 2) {
		int rows = MIN(2, r - i);
		double dy = r - i - 0.5;
		int in = (int)ceil(r - sqrt(MAX(0.0, (double)r * r - dy * dy)));
		if (w - 2 * in <= 0)
			continue;
		pixman_region32_union_rect(reg, reg, x + in, y + i, (unsigned)(w - 2 * in), (unsigned)rows);
		pixman_region32_union_rect(reg, reg, x + in, y + h - i - rows, (unsigned)(w - 2 * in), (unsigned)rows);
	}
}

static bool tok_rects(struct tok *t, pixman_region32_t *reg) {
	long n = tok_int(t);
	if (!t->ok || n < 0 || n > 4096)
		return false;
	for (long i = 0; i < n; i++) {
		long x = tok_int(t), y = tok_int(t), w = tok_int(t), h = tok_int(t), r = tok_int(t);
		if (!t->ok)
			return false;
		region_add_rounded(reg, (int)x, (int)y, (int)w, (int)h, (int)MAX(r, 0));
	}
	return true;
}

static void apply_layout(struct server *s) {
	struct layout_req *L = &s->layout;
	if (!L->pending)
		return;
	L->pending = false;
	wl_event_source_timer_update(s->layout_timer, 0);
	pixman_region32_copy(&s->top_region, &L->top);
	struct view *v;
	wl_list_for_each(v, &s->views, link) {
		v->listed = false;
	}
	for (size_t i = 0; i < L->n; i++) {
		v = view_by_id(s, L->ids[i]);
		if (!v)
			continue;
		v->listed = true;
		wlr_scene_node_raise_to_top(&v->root->node);
		pixman_region32_copy(&v->above_region, &L->regions[i]);
	}
	/* windows the desktop has not heard about yet stay on top, in their order */
	struct view *later[MAX_LAYOUT_WINDOWS];
	size_t n = 0;
	struct wlr_scene_node *node;
	wl_list_for_each(node, &s->app_layer->children, link) {
		wl_list_for_each(v, &s->views, link) {
			if (&v->root->node == node && !v->listed && n < MAX_LAYOUT_WINDOWS)
				later[n++] = v;
		}
	}
	for (size_t i = 0; i < n; i++) {
		wlr_scene_node_raise_to_top(&later[i]->root->node);
		pixman_region32_clear(&later[i]->above_region);
	}
	refresh_all_copies(s, false);
}

static int handle_layout_timeout(void *data) {
	apply_layout(data);
	return 0;
}

static void cmd_layout(struct server *s, struct tok *t) {
	struct layout_req *L = &s->layout;
	pixman_region32_clear(&L->top);
	for (size_t i = 0; i < L->n; i++)
		pixman_region32_fini(&L->regions[i]);
	L->n = 0;
	if (!tok_rects(t, &L->top)) {
		wlr_log(WLR_ERROR, "bad layout from the desktop");
		return;
	}
	long n = tok_int(t);
	for (long i = 0; t->ok && i < n && L->n < MAX_LAYOUT_WINDOWS; i++) {
		long id = tok_int(t);
		pixman_region32_init(&L->regions[L->n]);
		L->ids[L->n] = (uint32_t)id;
		L->n++;
		if (!tok_rects(t, &L->regions[L->n - 1]))
			break;
	}
	if (!t->ok) {
		wlr_log(WLR_ERROR, "bad layout from the desktop");
		return;
	}
	L->pending = true;
	/* applied together with the desktop's next picture, or soon if no picture comes */
	if (shell_picture(s))
		wl_event_source_timer_update(s->layout_timer, 40);
	else
		apply_layout(s);
}

static void cmd_geom(struct server *s, struct tok *t) {
	long id = tok_int(t), x = tok_int(t), y = tok_int(t), w = tok_int(t), h = tok_int(t);
	long st = tok_int(t), rw = tok_int(t), rh = tok_int(t);
	struct view *v = view_by_id(s, (uint32_t)id);
	if (!t->ok || !v || st < STATE_NORMAL || st > STATE_FULL)
		return;
	v->restore_w = (int)rw;
	v->restore_h = (int)rh;
	struct wlr_box b = { (int)x, (int)y, (int)w, (int)h };
	if (st == STATE_FULL)
		b = s->screen;
	if (w <= 0 || h <= 0) {
		struct wlr_box g = view_geometry(v);
		b.width = g.width;
		b.height = g.height;
	}
	view_configure(v, (enum view_state)st, b);
	view_report(v);
}

static void ipc_command(struct server *s, char *line) {
	char *sp = strchr(line, ' ');
	if (sp)
		*sp = 0;
	struct tok t = { sp ? sp + 1 : line + strlen(line), true };
	wlr_log(WLR_DEBUG, "desktop: %s", line);
	if (!strcmp(line, "layout")) {
		cmd_layout(s, &t);
	} else if (!strcmp(line, "focus")) {
		long id = tok_int(&t);
		if (!t.ok)
			return;
		struct view *v = id ? view_by_id(s, (uint32_t)id) : NULL;
		if (v && v->mapped && !v->hidden && !view_is_top(s, v))
			raise_view(s, v);
		set_focus(s, v);
	} else if (!strcmp(line, "close")) {
		struct view *v = view_by_id(s, (uint32_t)tok_int(&t));
		if (t.ok && v)
			view_close(v);
	} else if (!strcmp(line, "show")) {
		struct view *v = view_by_id(s, (uint32_t)tok_int(&t));
		long on = tok_int(&t);
		if (!t.ok || !v)
			return;
		v->hidden = !on;
		wlr_scene_node_set_enabled(&v->root->node, v->mapped && !v->hidden);
		if (v->xs) /* games pause when minimized */
			wlr_xwayland_surface_set_minimized(v->xs, v->hidden);
		if (v->hidden && s->active == v)
			set_focus(s, NULL);
	} else if (!strcmp(line, "grab")) {
		struct view *v = view_by_id(s, (uint32_t)tok_int(&t));
		long edges = tok_int(&t);
		if (t.ok && v)
			begin_grab(v, edges ? CURSOR_RESIZE : CURSOR_MOVE, (uint32_t)edges & 15, true);
	} else if (!strcmp(line, "geom")) {
		cmd_geom(s, &t);
	} else if (!strcmp(line, "area")) {
		long x = tok_int(&t), y = tok_int(&t), w = tok_int(&t), h = tok_int(&t);
		if (!t.ok || w <= 0 || h <= 0)
			return;
		s->work = (struct wlr_box){ (int)x, (int)y, (int)w, (int)h };
		s->work_set = true;
		x11_set_workarea(s);
	} else if (!strcmp(line, "overlay")) {
		long dim = tok_int(&t), night = tok_int(&t);
		if (!t.ok)
			return;
		float a = (float)MAX(0, MIN(dim, 1000)) / 1000.0f;
		float dimc[4] = { 0, 0, 0, a };
		wlr_scene_rect_set_color(s->dim_rect, dimc);
		wlr_scene_node_set_enabled(&s->dim_rect->node, a > 0);
		float b = (float)MAX(0, MIN(night, 1000)) / 1000.0f;
		float nightc[4] = { 1.0f * b, 138.0f / 255.0f * b, 40.0f / 255.0f * b, b }; /* premultiplied */
		wlr_scene_rect_set_color(s->night_rect, nightc);
		wlr_scene_node_set_enabled(&s->night_rect->node, b > 0);
	} else if (!strcmp(line, "output")) {
		char name[64];
		tok_word(&t, name, sizeof name);
		long w = tok_int(&t), h = tok_int(&t), mhz = tok_int(&t), scale = tok_int(&t), transform = tok_int(&t);
		if (!t.ok || w <= 0 || h <= 0)
			return;
		struct output *o;
		wl_list_for_each(o, &s->outputs, link)
			if (!strcmp(o->wlr_output->name, name))
				output_configure(s, o->wlr_output, (int)w, (int)h, (int)mhz, scale / 1000.0, (int)transform);
	} else if (!strcmp(line, "output-reset")) {
		if (wl_list_empty(&s->outputs))
			return;
		struct output *o = wl_container_of(s->outputs.next, o, link);
		struct wlr_output_mode *m = wlr_output_preferred_mode(o->wlr_output);
		output_configure(s, o->wlr_output, m ? m->width : o->wlr_output->width, m ? m->height : o->wlr_output->height,
			m ? m->refresh : o->wlr_output->refresh, 1.0, WL_OUTPUT_TRANSFORM_NORMAL);
	} else if (!strcmp(line, "input")) {
		long v[12];
		for (int i = 0; i < 12; i++)
			v[i] = tok_int(&t);
		if (!t.ok)
			return;
		s->in.speed = MAX(-1000, MIN(v[0], 1000)) / 1000.0;
		s->in.accel = v[1];
		s->in.left = v[2];
		s->in.lines = MAX(1, MIN(v[3], 20));
		s->in.natural = v[4];
		s->in.tap = v[5];
		s->in.tap2 = v[6];
		s->in.twofinger = v[7];
		s->in.tnatural = v[8];
		s->in.dwt = v[9];
		s->in.tspeed = MAX(-1000, MIN(v[10], 1000)) / 1000.0;
		s->in.touchpad = v[11];
		s->in.set = true;
		struct pointer *p;
		wl_list_for_each(p, &s->pointers, link)
			configure_pointer(s, p->device);
	} else if (!strcmp(line, "keymap")) {
		char layout[16], variant[40];
		tok_word(&t, layout, sizeof layout);
		tok_word(&t, variant, sizeof variant);
		long delay = tok_int(&t), rate = tok_int(&t);
		if (!t.ok)
			return;
		snprintf(s->kb_layout, sizeof s->kb_layout, "%s", layout);
		snprintf(s->kb_variant, sizeof s->kb_variant, "%s", strcmp(variant, "-") ? variant : "");
		s->kb_delay = (int)MAX(100, MIN(delay, 2000));
		s->kb_rate = (int)MAX(1, MIN(rate, 100));
		struct keyboard *k;
		wl_list_for_each(k, &s->keyboards, link)
			if (!k->virtual_kb && !keyboard_apply(s, k->wlr_keyboard))
				wlr_log(WLR_ERROR, "no keyboard layout %s(%s)", s->kb_layout, s->kb_variant);
	} else if (!strcmp(line, "cursor")) {
		char theme[64];
		tok_word(&t, theme, sizeof theme);
		long size = tok_int(&t);
		if (!t.ok)
			return;
		struct wlr_xcursor_manager *mgr = wlr_xcursor_manager_create(strcmp(theme, "default") ? theme : NULL, (uint32_t)MAX(16, MIN(size, 256)));
		if (!mgr)
			return;
		wlr_xcursor_manager_destroy(s->cursor_mgr);
		s->cursor_mgr = mgr;
		wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, "default");
		x11_set_cursor(s);
	} else if (!strcmp(line, "idle")) {
		long screen = tok_int(&t), sleep = tok_int(&t);
		if (!t.ok)
			return;
		s->idle_screen = (int)MAX(0, screen);
		s->idle_sleep = (int)MAX(0, sleep);
		s->last_input = now_msec();
	} else if (!strcmp(line, "paste")) {
		press_paste(s);
	} else {
		wlr_log(WLR_ERROR, "unknown command from the desktop: %s", line);
	}
}

static int handle_ipc(int fd, uint32_t mask, void *data) {
	struct server *s = data;
	if (mask & WL_EVENT_WRITABLE)
		ipc_flush(s);
	if (s->ipc_fd < 0)
		return 0;
	if (mask & WL_EVENT_READABLE) {
		for (;;) {
			ssize_t n = recv(fd, s->ipc_in + s->ipc_in_len, sizeof s->ipc_in - 1 - s->ipc_in_len, MSG_DONTWAIT);
			if (n == 0) {
				ipc_close(s);
				return 0;
			}
			if (n < 0) {
				if (errno == EINTR)
					continue;
				if (errno == EAGAIN || errno == EWOULDBLOCK)
					break;
				ipc_close(s);
				return 0;
			}
			s->ipc_in_len += (size_t)n;
			char *start = s->ipc_in, *end = s->ipc_in + s->ipc_in_len, *nl;
			while ((nl = memchr(start, '\n', (size_t)(end - start)))) {
				*nl = 0;
				ipc_command(s, start);
				if (s->ipc_fd < 0)
					return 0;
				start = nl + 1;
			}
			s->ipc_in_len = (size_t)(end - start);
			memmove(s->ipc_in, start, s->ipc_in_len);
			if (s->ipc_in_len >= sizeof s->ipc_in - 1) {
				wlr_log(WLR_ERROR, "line from the desktop is too long");
				s->ipc_in_len = 0;
			}
		}
	}
	if (mask & (WL_EVENT_HANGUP | WL_EVENT_ERROR))
		ipc_close(s);
	return 0;
}

static void ipc_close(struct server *s) {
	if (s->ipc_source) {
		wl_event_source_remove(s->ipc_source);
		s->ipc_source = NULL;
	}
	if (s->ipc_fd >= 0)
		close(s->ipc_fd);
	s->ipc_fd = -1;
	s->ipc_in_len = 0;
	s->ipc_out_len = 0;
	struct view *v;
	wl_list_for_each(v, &s->views, link) {
		v->announced = false;
	}
}

static void ipc_open(struct server *s, int fd) {
	fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
	s->ipc_fd = fd;
	s->ipc_source = wl_event_loop_add_fd(s->loop, fd, WL_EVENT_READABLE, handle_ipc, s);
	send_screen(s, "hello");
	send_outputs(s);
	send_inputs(s);
	/* a desktop started again hears about the windows that are already open, bottom to top */
	struct wlr_scene_node *node;
	wl_list_for_each(node, &s->app_layer->children, link) {
		struct view *v;
		wl_list_for_each(v, &s->views, link) {
			if (&v->root->node == node && v->mapped) {
				send_window(s, "new", v);
				v->announced = true;
			}
		}
	}
	if (s->active && s->active->announced)
		send_simple(s, "focus", s->active->id);
}

/* ---------- the desktop's process ---------- */

static void handle_shell_client_destroy(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, shell_client_destroy);
	unlisten(&s->shell_client_destroy);
	s->shell_client = NULL;
}

static void spawn_shell(struct server *s) {
	int wl[2], ipc[2];
	if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, wl) < 0) {
		wlr_log_errno(WLR_ERROR, "socketpair");
		return;
	}
	if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, ipc) < 0) {
		wlr_log_errno(WLR_ERROR, "socketpair");
		close(wl[0]);
		close(wl[1]);
		return;
	}
	clock_gettime(CLOCK_MONOTONIC, &s->last_spawn);
	pid_t pid = fork();
	if (pid < 0) {
		wlr_log_errno(WLR_ERROR, "fork");
		close(wl[0]);
		close(wl[1]);
		close(ipc[0]);
		close(ipc[1]);
		return;
	}
	if (pid == 0) {
		sigset_t set;
		sigemptyset(&set);
		sigprocmask(SIG_SETMASK, &set, NULL);
		int wfd = dup(wl[1]), ifd = dup(ipc[1]); /* dup leaves out close-on-exec */
		char buf[16];
		snprintf(buf, sizeof buf, "%d", wfd);
		setenv("WAYLAND_SOCKET", buf, 1);
		snprintf(buf, sizeof buf, "%d", ifd);
		setenv("NIMBUS_WM_FD", buf, 1);
		execvp(s->shell_argv[0], s->shell_argv);
		fprintf(stderr, "nimbus-wm: cannot start %s: %s\n", s->shell_argv[0], strerror(errno));
		_exit(127);
	}
	close(wl[1]);
	close(ipc[1]);
	s->shell_pid = pid;
	s->shell_client = wl_client_create(s->display, wl[0]);
	if (s->shell_client) {
		s->shell_client_destroy.notify = handle_shell_client_destroy;
		wl_client_add_destroy_listener(s->shell_client, &s->shell_client_destroy);
	}
	ipc_open(s, ipc[0]);
	wlr_log(WLR_INFO, "started the desktop (pid %d)", pid);
}

static int handle_sigchld(int sig, void *data) {
	struct server *s = data;
	int status;
	pid_t pid;
	/* only the desktop: wlroots waits for the process that starts Xwayland itself */
	while (s->shell_pid > 0 && (pid = waitpid(s->shell_pid, &status, WNOHANG)) > 0) {
		s->shell_pid = 0;
		if (s->quitting)
			continue;
		if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
			wlr_log(WLR_INFO, "the desktop finished");
			wl_display_terminate(s->display);
			continue;
		}
		struct timespec now;
		clock_gettime(CLOCK_MONOTONIC, &now);
		s->quick_exits = now.tv_sec - s->last_spawn.tv_sec < 15 ? s->quick_exits + 1 : 0;
		if (s->quick_exits >= 4) {
			wlr_log(WLR_ERROR, "the desktop keeps stopping; giving up");
			wl_display_terminate(s->display);
			continue;
		}
		wlr_log(WLR_INFO, "the desktop stopped (status %d); starting it again", status);
		if (s->shell_client) {
			struct wl_client *old = s->shell_client;
			unlisten(&s->shell_client_destroy);
			s->shell_client = NULL;
			wl_client_destroy(old);
		}
		ipc_close(s);
		spawn_shell(s);
	}
	return 0;
}

static int handle_quit_signal(int sig, void *data) {
	struct server *s = data;
	wl_display_terminate(s->display);
	return 0;
}

/* ---------- start ---------- */

int main(int argc, char *argv[]) {
	enum wlr_log_importance level = WLR_INFO;
	struct server *s = calloc(1, sizeof *s);
	if (!s)
		return 1;
	int i = 1;
	for (; i < argc; i++) {
		if (!strcmp(argv[i], "-d")) {
			level = WLR_DEBUG;
		} else if (!strcmp(argv[i], "--test")) {
			s->test_mode = true;
		} else if (!strcmp(argv[i], "--")) {
			i++;
			break;
		} else {
			break;
		}
	}
	if (i >= argc) {
		fprintf(stderr, "usage: %s [-d] [--test] -- DESKTOP-COMMAND [ARGS...]\n", argv[0]);
		return 2;
	}
	s->shell_argv = &argv[i];
	wlr_log_init(level, NULL);
	s->ipc_fd = -1;
	wl_list_init(&s->views);
	wl_list_init(&s->outputs);
	wl_list_init(&s->keyboards);
	wl_list_init(&s->pointers);
	s->kb_delay = 600;
	s->kb_rate = 25;
	s->in.lines = 3;
	wl_list_init(&s->shell_client_destroy.link);
	wl_list_init(&s->shell_commit.link);
	pixman_region32_init(&s->top_region);
	pixman_region32_init(&s->top_copied);
	pixman_region32_init(&s->layout.top);
	if (!getenv("XCURSOR_THEME")) /* white pointers like Windows', when the theme is there */
		setenv("XCURSOR_THEME", access("/usr/share/icons/DMZ-White/cursors", F_OK) == 0 ? "DMZ-White" : "Adwaita", 1);
	if (!getenv("XCURSOR_SIZE"))
		setenv("XCURSOR_SIZE", "24", 1);

	s->display = wl_display_create();
	s->loop = wl_display_get_event_loop(s->display);
	s->backend = wlr_backend_autocreate(s->display, &s->session);
	if (!s->backend) {
		wlr_log(WLR_ERROR, "no backend");
		return 1;
	}
	s->renderer = wlr_renderer_autocreate(s->backend);
	if (!s->renderer) {
		wlr_log(WLR_ERROR, "no renderer");
		return 1;
	}
	wlr_renderer_init_wl_display(s->renderer, s->display);
	s->allocator = wlr_allocator_autocreate(s->backend, s->renderer);
	if (!s->allocator) {
		wlr_log(WLR_ERROR, "no allocator");
		return 1;
	}
	s->compositor = wlr_compositor_create(s->display, 5, s->renderer);
	wlr_subcompositor_create(s->display);
	wlr_data_device_manager_create(s->display);
	wlr_primary_selection_v1_device_manager_create(s->display);
	wlr_data_control_manager_v1_create(s->display);
	wlr_viewporter_create(s->display);
	wlr_single_pixel_buffer_manager_v1_create(s->display);
	wlr_screencopy_manager_v1_create(s->display);
	wlr_fractional_scale_manager_v1_create(s->display, 1);
	struct wlr_idle_inhibit_manager_v1 *inhibit = wlr_idle_inhibit_v1_create(s->display);
	hook(&inhibit->events.new_inhibitor, &s->new_inhibitor, handle_new_inhibitor);

	s->output_layout = wlr_output_layout_create();
	wlr_xdg_output_manager_v1_create(s->display, s->output_layout);
	hook(&s->backend->events.new_output, &s->new_output, handle_new_output);

	s->scene = wlr_scene_create();
	s->scene_layout = wlr_scene_attach_output_layout(s->scene, s->output_layout);
	struct wlr_presentation *presentation = wlr_presentation_create(s->display, s->backend);
	wlr_scene_set_presentation(s->scene, presentation);
	s->content = wlr_scene_tree_create(&s->scene->tree);
	s->shell_layer = wlr_scene_tree_create(s->content);
	s->app_layer = wlr_scene_tree_create(s->content);
	s->x11_layer = wlr_scene_tree_create(s->content);
	s->top_copies = wlr_scene_tree_create(s->content);
	s->top_layer = wlr_scene_tree_create(s->content);
	s->drag_layer = wlr_scene_tree_create(&s->scene->tree);
	s->overlay = wlr_scene_tree_create(&s->scene->tree);
	const float clear[4] = { 0, 0, 0, 0 };
	s->dim_rect = wlr_scene_rect_create(s->overlay, 0, 0, clear);
	s->night_rect = wlr_scene_rect_create(s->overlay, 0, 0, clear);
	wlr_scene_node_set_enabled(&s->dim_rect->node, false);
	wlr_scene_node_set_enabled(&s->night_rect->node, false);

	s->xdg_shell = wlr_xdg_shell_create(s->display, 5);
	hook(&s->xdg_shell->events.new_surface, &s->new_xdg_surface, handle_new_xdg_surface);
	struct wlr_xdg_decoration_manager_v1 *deco = wlr_xdg_decoration_manager_v1_create(s->display);
	hook(&deco->events.new_toplevel_decoration, &s->new_decoration, handle_new_decoration);
	struct wlr_xdg_activation_v1 *activation = wlr_xdg_activation_v1_create(s->display);
	hook(&activation->events.request_activate, &s->request_activate, handle_request_activate);

	s->cursor = wlr_cursor_create();
	wlr_cursor_attach_output_layout(s->cursor, s->output_layout);
	s->cursor_mgr = wlr_xcursor_manager_create(getenv("XCURSOR_THEME"), 24);
	hook(&s->cursor->events.motion, &s->cursor_motion, handle_cursor_motion);
	hook(&s->cursor->events.motion_absolute, &s->cursor_motion_absolute, handle_cursor_motion_absolute);
	hook(&s->cursor->events.button, &s->cursor_button, handle_cursor_button);
	hook(&s->cursor->events.axis, &s->cursor_axis, handle_cursor_axis);
	hook(&s->cursor->events.frame, &s->cursor_frame, handle_cursor_frame);
	struct wlr_cursor_shape_manager_v1 *shapes = wlr_cursor_shape_manager_v1_create(s->display, 1);
	hook(&shapes->events.request_set_shape, &s->request_set_shape, handle_request_set_shape);

	hook(&s->backend->events.new_input, &s->new_input, handle_new_input);
	s->seat = wlr_seat_create(s->display, "seat0");
	hook(&s->seat->events.request_set_cursor, &s->request_cursor, handle_request_cursor);
	hook(&s->seat->events.request_set_selection, &s->request_set_selection, handle_request_set_selection);
	hook(&s->seat->events.request_set_primary_selection, &s->request_set_primary_selection,
		handle_request_set_primary_selection);
	hook(&s->seat->events.request_start_drag, &s->request_start_drag, handle_request_start_drag);
	hook(&s->seat->events.start_drag, &s->start_drag, handle_start_drag);
	if (s->test_mode) {
		struct wlr_virtual_keyboard_manager_v1 *vk = wlr_virtual_keyboard_manager_v1_create(s->display);
		hook(&vk->events.new_virtual_keyboard, &s->new_virtual_keyboard, handle_new_virtual_keyboard);
		struct wlr_virtual_pointer_manager_v1 *vp = wlr_virtual_pointer_manager_v1_create(s->display);
		hook(&vp->events.new_virtual_pointer, &s->new_virtual_pointer, handle_new_virtual_pointer);
	}
	update_capabilities(s);

	/* X11 programs: Xwayland starts when the first one does */
	s->xwayland = wlr_xwayland_create(s->display, s->compositor, true);
	if (s->xwayland) {
		hook(&s->xwayland->events.ready, &s->xwayland_ready_listener, handle_xwayland_ready);
		hook(&s->xwayland->events.new_surface, &s->new_xwayland_surface, handle_new_xwayland_surface);
		setenv("DISPLAY", s->xwayland->display_name, 1);
		wlr_log(WLR_INFO, "X11 programs use DISPLAY=%s", s->xwayland->display_name);
	} else {
		wlr_log(WLR_ERROR, "no Xwayland: X11 programs won't start");
		unsetenv("DISPLAY");
	}

	s->layout_timer = wl_event_loop_add_timer(s->loop, handle_layout_timeout, s);
	s->idle_timer = wl_event_loop_add_timer(s->loop, handle_idle_timer, s);
	s->last_input = now_msec();
	wl_event_source_timer_update(s->idle_timer, 5000);
	s->sigchld = wl_event_loop_add_signal(s->loop, SIGCHLD, handle_sigchld, s);
	s->sigterm = wl_event_loop_add_signal(s->loop, SIGTERM, handle_quit_signal, s);
	s->sigint = wl_event_loop_add_signal(s->loop, SIGINT, handle_quit_signal, s);

	const char *socket = wl_display_add_socket_auto(s->display);
	if (!socket) {
		wlr_log(WLR_ERROR, "no Wayland socket");
		return 1;
	}
	if (!wlr_backend_start(s->backend)) {
		wlr_log(WLR_ERROR, "could not start the backend");
		return 1;
	}
	setenv("WAYLAND_DISPLAY", socket, 1);
	wlr_log(WLR_INFO, "nimbus-wm on WAYLAND_DISPLAY=%s", socket);
	wlr_cursor_set_xcursor(s->cursor, s->cursor_mgr, "default");
	if (wlr_box_empty(&s->screen))
		wlr_log(WLR_ERROR, "no screen yet");
	spawn_shell(s);

	wl_display_run(s->display);

	s->quitting = true;
	if (s->shell_pid > 0)
		kill(s->shell_pid, SIGTERM);
	ipc_close(s);
	if (s->xwayland) {
		unlisten(&s->xwayland_ready_listener);
		unlisten(&s->new_xwayland_surface);
		wlr_xwayland_destroy(s->xwayland);
	}
	wl_display_destroy_clients(s->display);
	wl_event_source_remove(s->layout_timer);
	wl_event_source_remove(s->idle_timer);
	wl_event_source_remove(s->sigchld);
	wl_event_source_remove(s->sigterm);
	wl_event_source_remove(s->sigint);
	wlr_scene_node_destroy(&s->scene->tree.node);
	wlr_xcursor_manager_destroy(s->cursor_mgr);
	wlr_cursor_destroy(s->cursor);
	wlr_allocator_destroy(s->allocator);
	wlr_renderer_destroy(s->renderer);
	wlr_backend_destroy(s->backend);
	wl_display_destroy(s->display);
	return 0;
}
