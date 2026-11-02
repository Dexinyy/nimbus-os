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
#include <xkbcommon/xkbcommon.h>

#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX_LAYOUT_WINDOWS 128
#define TASKBAR_GUESS 48

enum view_kind { VIEW_APP, VIEW_SHELL, VIEW_SHELL_DIALOG };
enum view_state { STATE_NORMAL, STATE_MAX, STATE_SNAP, STATE_FULL };
static const char *const state_names[] = { "normal", "max", "snap", "full" };
enum cursor_mode { CURSOR_PASSTHROUGH, CURSOR_MOVE, CURSOR_RESIZE };

struct server;

struct view {
	struct wl_list link;               /* server.views (program windows only) */
	struct server *server;
	enum view_kind kind;
	struct wlr_xdg_toplevel *toplevel;
	struct wlr_scene_tree *root;       /* program windows: holds tree, then above */
	struct wlr_scene_tree *tree;       /* the window with its popups, placed at its window geometry */
	struct wlr_scene_tree *above;      /* copies of the desktop's picture drawn over this window */
	uint32_t id;
	int x, y;                          /* top left of the window geometry, layout coordinates */
	bool mapped, hidden, announced, placed, listed;
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
	struct wl_listener modifiers, key, destroy;
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

	struct wlr_xdg_shell *xdg_shell;
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

	struct wl_listener new_output, new_input, new_xdg_surface, new_decoration, request_activate;
	struct wl_listener cursor_motion, cursor_motion_absolute, cursor_button, cursor_axis, cursor_frame;
	struct wl_listener request_cursor, request_set_shape, request_set_selection, request_set_primary_selection;
	struct wl_listener request_start_drag, start_drag, new_virtual_keyboard, new_virtual_pointer;
	struct wl_event_source *sigchld, *sigterm, *sigint;
};

static char shell_copy_marker;

static void process_motion(struct server *s, uint32_t time);
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

static struct wlr_box view_geometry(struct view *v) {
	struct wlr_box g;
	wlr_xdg_surface_get_geometry(v->toplevel->base, &g);
	return g;
}

static struct view *view_parent(struct view *v) {
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
	jb_str(&j, "app", v->toplevel->app_id);
	jb_str(&j, "title", v->toplevel->title);
	jb_int(&j, "x", v->x);
	jb_int(&j, "y", v->y);
	jb_int(&j, "w", g.width);
	jb_int(&j, "h", g.height);
	jb_str(&j, "state", state_names[v->state]);
	struct view *p = view_parent(v);
	jb_int(&j, "parent", p ? p->id : 0);
	jb_int(&j, "min", v->hidden);
	pid_t pid = 0;
	wl_client_get_credentials(wl_resource_get_client(v->toplevel->resource), &pid, NULL, NULL);
	jb_int(&j, "pid", pid);
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

/* Give the keyboard to a program window, or to the desktop (v == NULL). */
static void set_focus(struct server *s, struct view *v) {
	if (v && (!v->mapped || v->hidden))
		v = NULL;
	struct view *old = s->active;
	struct wlr_surface *target = v ? v->toplevel->base->surface : shell_surface(s);
	/* an open menu keeps the keyboard; moving the focus elsewhere closes it */
	if (target != s->seat->keyboard_state.focused_surface &&
			s->seat->keyboard_state.grab != s->seat->keyboard_state.default_grab)
		wlr_seat_keyboard_end_grab(s->seat);
	if (old && old != v)
		wlr_xdg_toplevel_set_activated(old->toplevel, false);
	s->active = v;
	if (v) {
		wlr_xdg_toplevel_set_activated(v->toplevel, true);
		kbd_enter(s, v->toplevel->base->surface);
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
	wlr_xdg_toplevel_set_maximized(t, st == STATE_MAX);
	wlr_xdg_toplevel_set_fullscreen(t, st == STATE_FULL);
	set_tiled(t, st == STATE_MAX || st == STATE_SNAP);
	wlr_xdg_toplevel_set_size(t, MAX(b.width, 0), MAX(b.height, 0));
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

static void view_place_initial(struct view *v) {
	struct server *s = v->server;
	struct wlr_box w = work_area(s);
	struct wlr_box g = view_geometry(v);
	struct view *parent = view_parent(v);
	if (parent) {
		struct wlr_box pg = view_geometry(parent);
		v->x = parent->x + (pg.width - g.width) / 2;
		v->y = parent->y + (pg.height - g.height) / 2;
	} else {
		int off = (s->cascade++ % 6) * 26 - 52;
		v->x = w.x + (w.width - g.width) / 2 + off;
		v->y = w.y + (w.height - g.height) / 2 + off * 7 / 10;
	}
	v->x = MAX(w.x, MIN(v->x, w.x + w.width - MIN(g.width, w.width)));
	v->y = MAX(w.y, MIN(v->y, w.y + w.height - MIN(g.height, w.height)));
	v->placed = true;
}

/* ---------- windows ---------- */

static struct view *view_from_surface_tree(struct wlr_xdg_surface *xs) {
	if (!xs || !xs->data)
		return NULL;
	struct wlr_scene_tree *t = xs->data;
	return t->node.data;
}

static void view_handle_map(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, map);
	struct server *s = v->server;
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
	wlr_log(WLR_INFO, "window %u (%s) opened", v->id, v->toplevel->app_id ? v->toplevel->app_id : "?");
	set_focus(s, v);
	update_copies(s, v, true);
}

static void view_handle_unmap(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, unmap);
	struct server *s = v->server;
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
	if (!v->mapped)
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
	jb_str(&j, "title", v->toplevel->title);
	jb_send(v->server, &j);
}

static void view_handle_set_app_id(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, set_app_id);
	if (!v->announced)
		return;
	struct jbuf j;
	jb_begin(&j, "app");
	jb_int(&j, "id", v->id);
	jb_str(&j, "app", v->toplevel->app_id);
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

static bool swallowed_take(struct server *s, uint32_t keycode);

static void begin_grab(struct view *v, enum cursor_mode mode, uint32_t edges) {
	struct server *s = v->server;
	struct wlr_surface *focused = s->seat->pointer_state.focused_surface;
	if (v->kind != VIEW_APP || !focused || wlr_surface_get_root_surface(focused) != v->toplevel->base->surface)
		return;
	if (mode == CURSOR_RESIZE && (v->state == STATE_MAX || v->state == STATE_FULL))
		return;
	if (mode == CURSOR_MOVE && v->state == STATE_FULL)
		return;
	struct wlr_box g = view_geometry(v);
	if (mode == CURSOR_RESIZE && v->state == STATE_SNAP) {
		/* resizing a snapped window lets go of the snap and keeps its size */
		v->state = STATE_NORMAL;
		set_tiled(v->toplevel, false);
		wlr_xdg_surface_schedule_configure(v->toplevel->base);
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
	begin_grab(v, CURSOR_MOVE, 0);
}

static void view_handle_request_resize(struct wl_listener *l, void *data) {
	struct view *v = wl_container_of(l, v, request_resize);
	struct wlr_xdg_toplevel_resize_event *e = data;
	begin_grab(v, CURSOR_RESIZE, e->edges);
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
	ny = MAX(w.y, MIN(ny, w.y + w.height - 40));
	v->x = nx;
	v->y = ny;
	view_update_position(v);
	if (time - s->last_moving_msec >= 30) {
		s->last_moving_msec = time;
		send_moving(s, "moving");
	}
}

static void do_resize(struct server *s) {
	struct view *v = s->grab_view;
	double dx = s->cursor->x - s->grab_x, dy = s->cursor->y - s->grab_y;
	struct wlr_box b = s->grab_box;
	struct wlr_xdg_toplevel_state *cur = &v->toplevel->current;
	if (s->grab_edges & WLR_EDGE_RIGHT)
		b.width = s->grab_box.width + (int)dx;
	if (s->grab_edges & WLR_EDGE_LEFT)
		b.width = s->grab_box.width - (int)dx;
	if (s->grab_edges & WLR_EDGE_BOTTOM)
		b.height = s->grab_box.height + (int)dy;
	if (s->grab_edges & WLR_EDGE_TOP) {
		struct wlr_box w = work_area(s);
		b.height = s->grab_box.height - (int)dy;
		b.height = MIN(b.height, s->grab_box.y + s->grab_box.height - w.y);
	}
	int minw = MAX(cur->min_width, 120), minh = MAX(cur->min_height, 60);
	b.width = MAX(b.width, minw);
	b.height = MAX(b.height, minh);
	if (cur->max_width > 0)
		b.width = MIN(b.width, cur->max_width);
	if (cur->max_height > 0)
		b.height = MIN(b.height, cur->max_height);
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
	wlr_cursor_move(s->cursor, &e->pointer->base, e->delta_x, e->delta_y);
	process_motion(s, e->time_msec);
}

static void handle_cursor_motion_absolute(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_motion_absolute);
	struct wlr_pointer_motion_absolute_event *e = data;
	wlr_cursor_warp_absolute(s->cursor, &e->pointer->base, e->x, e->y);
	process_motion(s, e->time_msec);
}

static void handle_cursor_button(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, cursor_button);
	struct wlr_pointer_button_event *e = data;
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
		if (s->active) {
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
	wlr_seat_pointer_notify_axis(s->seat, e->time_msec, e->orientation, e->delta, e->delta_discrete, e->source);
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
		snprintf(key, sizeof key, "super+%s", name);
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
	unlisten(&k->modifiers);
	unlisten(&k->key);
	unlisten(&k->destroy);
	wl_list_remove(&k->link);
	free(k);
}

static void add_keyboard(struct server *s, struct wlr_keyboard *kb, bool set_keymap) {
	struct keyboard *k = calloc(1, sizeof *k);
	if (!k)
		return;
	k->server = s;
	k->wlr_keyboard = kb;
	if (set_keymap) {
		struct xkb_context *ctx = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
		struct xkb_keymap *keymap = xkb_keymap_new_from_names(ctx, NULL, XKB_KEYMAP_COMPILE_NO_FLAGS);
		if (keymap) {
			wlr_keyboard_set_keymap(kb, keymap);
			xkb_keymap_unref(keymap);
		}
		xkb_context_unref(ctx);
		wlr_keyboard_set_repeat_info(kb, 25, 600);
	}
	hook(&kb->events.modifiers, &k->modifiers, keyboard_handle_modifiers);
	hook(&kb->events.key, &k->key, keyboard_handle_key);
	hook(&kb->base.events.destroy, &k->destroy, keyboard_handle_destroy);
	wlr_seat_set_keyboard(s->seat, kb);
	wl_list_insert(&s->keyboards, &k->link);
}

static void update_capabilities(struct server *s) {
	uint32_t caps = WL_SEAT_CAPABILITY_POINTER;
	if (!wl_list_empty(&s->keyboards))
		caps |= WL_SEAT_CAPABILITY_KEYBOARD;
	wlr_seat_set_capabilities(s->seat, caps);
}

/* Touchpads: tap to click and natural scrolling, as on Windows. */
static void configure_pointer(struct wlr_input_device *device) {
	if (!wlr_input_device_is_libinput(device))
		return;
	struct libinput_device *li = wlr_libinput_get_device_handle(device);
	if (!li || libinput_device_config_tap_get_finger_count(li) == 0)
		return;
	libinput_device_config_tap_set_enabled(li, LIBINPUT_CONFIG_TAP_ENABLED);
	libinput_device_config_tap_set_drag_enabled(li, LIBINPUT_CONFIG_DRAG_ENABLED);
	if (libinput_device_config_scroll_has_natural_scroll(li))
		libinput_device_config_scroll_set_natural_scroll_enabled(li, 1);
}

static void handle_new_input(struct wl_listener *l, void *data) {
	struct server *s = wl_container_of(l, s, new_input);
	struct wlr_input_device *device = data;
	switch (device->type) {
	case WLR_INPUT_DEVICE_KEYBOARD:
		add_keyboard(s, wlr_keyboard_from_input_device(device), true);
		break;
	case WLR_INPUT_DEVICE_POINTER:
		configure_pointer(device);
		wlr_cursor_attach_input_device(s->cursor, device);
		break;
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
			wlr_xdg_toplevel_send_close(v->toplevel);
	} else if (!strcmp(line, "show")) {
		struct view *v = view_by_id(s, (uint32_t)tok_int(&t));
		long on = tok_int(&t);
		if (!t.ok || !v)
			return;
		v->hidden = !on;
		wlr_scene_node_set_enabled(&v->root->node, v->mapped && !v->hidden);
		if (v->hidden && s->active == v)
			set_focus(s, NULL);
	} else if (!strcmp(line, "geom")) {
		cmd_geom(s, &t);
	} else if (!strcmp(line, "area")) {
		long x = tok_int(&t), y = tok_int(&t), w = tok_int(&t), h = tok_int(&t);
		if (!t.ok || w <= 0 || h <= 0)
			return;
		s->work = (struct wlr_box){ (int)x, (int)y, (int)w, (int)h };
		s->work_set = true;
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
	while ((pid = waitpid(-1, &status, WNOHANG)) > 0) {
		if (pid != s->shell_pid)
			continue;
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
	wl_list_init(&s->shell_client_destroy.link);
	wl_list_init(&s->shell_commit.link);
	pixman_region32_init(&s->top_region);
	pixman_region32_init(&s->top_copied);
	pixman_region32_init(&s->layout.top);
	if (!getenv("XCURSOR_THEME"))
		setenv("XCURSOR_THEME", "Adwaita", 1);
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
	wlr_compositor_create(s->display, 5, s->renderer);
	wlr_subcompositor_create(s->display);
	wlr_data_device_manager_create(s->display);
	wlr_primary_selection_v1_device_manager_create(s->display);
	wlr_data_control_manager_v1_create(s->display);
	wlr_viewporter_create(s->display);
	wlr_single_pixel_buffer_manager_v1_create(s->display);
	wlr_screencopy_manager_v1_create(s->display);

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
	s->cursor_mgr = wlr_xcursor_manager_create(NULL, 24);
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

	s->layout_timer = wl_event_loop_add_timer(s->loop, handle_layout_timeout, s);
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
	wl_display_destroy_clients(s->display);
	wl_event_source_remove(s->layout_timer);
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
