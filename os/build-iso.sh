#!/usr/bin/env bash
# Build the Nimbus OS live ISO for 64-bit PCs from Ubuntu 24.04 packages.
#
# Needs root on Ubuntu 24.04 (a GitHub Actions runner works) with these tools:
#   debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub-common mtools dosfstools python3
# Output: out/nimbus-os-<version>-amd64.iso (boots on UEFI and BIOS PCs, from USB or disc), and the update package
#         running systems install in place: out/nimbus-os-update.json and out/nimbus-os-update-<commit>.tar.xz
set -euo pipefail

VERSION="${NIMBUS_VERSION:-0.1}"
# Raise BASE when a change can't reach running systems as an in-place update (it needs a newer kernel, new startup
# scripts or another Ubuntu release): Settings › Nimbus Update then offers the new ISO instead.
BASE=1
SUITE="noble"
MIRROR="${UBUNTU_MIRROR:-http://archive.ubuntu.com/ubuntu}"
SECURITY_MIRROR="${UBUNTU_SECURITY_MIRROR:-http://security.ubuntu.com/ubuntu}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORK="${WORK:-$REPO/build}"
OUT="${OUT:-$REPO/out}"
CHROOT="$WORK/chroot"
ISODIR="$WORK/iso"
ISO="$OUT/nimbus-os-$VERSION-amd64.iso"
APT_CACHE="${APT_CACHE:-}"   # optional folder that keeps downloaded packages between builds

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root, for example: sudo ./build.sh"
for tool in debootstrap mksquashfs grub-mkimage xorriso mformat mmd mcopy mkfs.msdos python3 curl gpg; do
  command -v "$tool" >/dev/null || die "missing tool: $tool (see the list at the top of this script)"
done

unmount_all() {
  for m in var/cache/apt/archives dev/pts dev proc sys run; do
    if mountpoint -q "$CHROOT/$m" 2>/dev/null; then umount -lf "$CHROOT/$m" || true; fi
  done
}
trap unmount_all EXIT

in_chroot() {
  chroot "$CHROOT" /usr/bin/env -i HOME=/root TERM=dumb PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true "$@"
}

log "Preparing $WORK"
unmount_all
rm -rf "$WORK"
mkdir -p "$CHROOT" "$ISODIR/casper" "$ISODIR/boot/grub" "$ISODIR/.disk" "$OUT"

log "Building the Nimbus desktop"
python3 "$REPO/shell/build.py" --native "$WORK/shell"

log "Downloading a minimal Ubuntu $SUITE system"
debootstrap --arch=amd64 --variant=minbase --components=main,restricted,universe "$SUITE" "$CHROOT" "$MIRROR"

mount -t proc proc "$CHROOT/proc"
mount -t sysfs sysfs "$CHROOT/sys"
# A private /dev: binding the build machine's own /dev would let package scripts
# change its device permissions (systemd resets /dev/kvm, /dev/fuse and others).
mount -t tmpfs -o mode=755,size=8M nimbusdev "$CHROOT/dev"
for node in "null 1 3" "zero 1 5" "full 1 7" "random 1 8" "urandom 1 9" "tty 5 0"; do
  read -r name major minor <<<"$node"
  mknod -m 666 "$CHROOT/dev/$name" c "$major" "$minor"
done
mkdir -p "$CHROOT/dev/pts" "$CHROOT/dev/shm"
mount -t devpts -o newinstance,ptmxmode=0666,mode=620 devpts "$CHROOT/dev/pts"
ln -s pts/ptmx "$CHROOT/dev/ptmx"
ln -s /proc/self/fd "$CHROOT/dev/fd"
mount -t tmpfs tmpfs "$CHROOT/run"

rm -f "$CHROOT/etc/apt/sources.list.d/"*.sources 2>/dev/null || true
cat > "$CHROOT/etc/apt/sources.list" <<EOF
deb $MIRROR $SUITE main restricted universe
deb $MIRROR $SUITE-updates main restricted universe
deb $SECURITY_MIRROR $SUITE-security main restricted universe
EOF
cat > "$CHROOT/etc/apt/apt.conf.d/90nimbus" <<'EOF'
APT::Install-Recommends "false";
APT::Install-Suggests "false";
Dpkg::Options { "--force-confdef"; "--force-confold"; }
EOF
# Manuals and translations are not needed on the live image.
mkdir -p "$CHROOT/etc/dpkg/dpkg.cfg.d"
cat > "$CHROOT/etc/dpkg/dpkg.cfg.d/90nimbus-slim" <<'EOF'
path-exclude=/usr/share/doc/*
path-include=/usr/share/doc/*/copyright
path-exclude=/usr/share/man/*
path-exclude=/usr/share/info/*
path-exclude=/usr/share/locale/*
path-include=/usr/share/locale/locale.alias
path-include=/usr/share/locale/en*
EOF
# Firmware for data-centre network cards and phone chips is not needed on PCs.
for dir in netronome mellanox liquidio qed cxgb4 bnx2x mrvl/prestera qcom dpaa2; do
  printf 'path-exclude=/lib/firmware/%s/*\npath-exclude=/usr/lib/firmware/%s/*\n' "$dir" "$dir"
done > "$CHROOT/etc/dpkg/dpkg.cfg.d/91nimbus-firmware"
# Services must not start inside the build environment.
printf '#!/bin/sh\nexit 101\n' > "$CHROOT/usr/sbin/policy-rc.d"
chmod 755 "$CHROOT/usr/sbin/policy-rc.d"

log "Choosing a kernel"
in_chroot apt-get update
KERNEL_META="linux-image-generic-hwe-24.04"
in_chroot apt-cache show "$KERNEL_META" >/dev/null 2>&1 || KERNEL_META="linux-image-generic"
KIMAGE="$(in_chroot apt-cache depends "$KERNEL_META" | awk '/Depends: linux-image-[0-9]/ && !found {print $2; found = 1}')"
[ -n "$KIMAGE" ] || die "could not find a kernel package behind $KERNEL_META"
# Older kernels keep many drivers in a separate package; newer ones ship them all together.
KEXTRA="${KIMAGE/linux-image-/linux-modules-extra-}"
in_chroot apt-cache show "$KEXTRA" >/dev/null 2>&1 || KEXTRA=""
echo "Kernel package: $KIMAGE ${KEXTRA:+(+ $KEXTRA)}"

log "Installing the system"
# What starts the live system. Only a new ISO changes these: the kernel and startup image are on the USB stick.
BASE_PACKAGES=(
  "$KIMAGE" ${KEXTRA:+"$KEXTRA"} linux-firmware intel-microcode amd64-microcode
  casper user-setup initramfs-tools
)
# Everything else. An in-place update installs any of these that a running system doesn't have yet.
PACKAGES=(
  systemd-sysv systemd-resolved systemd-timesyncd udev dbus dbus-user-session libpam-systemd polkitd kmod
  network-manager wpasupplicant wireless-regdb iw dnsmasq-base
  fdisk e2fsprogs
  sudo locales tzdata kbd iproute2 ca-certificates less nano
  procps psmisc htop neofetch curl wget vim-tiny bash-completion
  cage libwlroots12t64 libgl1-mesa-dri libegl1 libegl-mesa0 libgles2 libgbm1
  # X11 programs (Steam, Discord, games, Windows programs through Wine) draw through Xwayland
  xwayland
  python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
  adwaita-icon-theme hicolor-icon-theme gsettings-desktop-schemas dconf-gsettings-backend shared-mime-info
  fontconfig fonts-dejavu-core
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-alsa
  # Sound through PipeWire (steadier than ALSA alone, above all in virtual machines), with Bluetooth audio
  pipewire pipewire-pulse pipewire-alsa wireplumber rtkit libspa-0.2-bluetooth gstreamer1.0-pipewire gstreamer1.0-pulseaudio pulseaudio-utils
  # What Settings controls: Bluetooth, power modes, screenshots and the clipboard, pointer styles
  bluez power-profiles-daemon grim wl-clipboard dmz-cursor-theme
  # What Google Chrome needs beyond the above, so installing it later only downloads Chrome itself
  fonts-liberation libcups2t64 libnss3 libvulkan1 xdg-utils
  # The Store: apps from Flathub (Steam, Discord, Lutris for Battle.net...) installed with flatpak, and the
  # portals they open files and links through
  flatpak gir1.2-flatpak-1.0 xdg-desktop-portal xdg-desktop-portal-gtk
  # Nimbus Security: ClamAV (its definitions download when first needed) and the firewall
  clamav clamav-freshclam ufw
)
if [ -n "$APT_CACHE" ]; then
  mkdir -p "$APT_CACHE/apt/partial"
  mount --bind "$(cd "$APT_CACHE/apt" && pwd)" "$CHROOT/var/cache/apt/archives"
fi
in_chroot apt-get install -y "${BASE_PACKAGES[@]}" "${PACKAGES[@]}"
# Printing: driverless (IPP Everywhere) printers on the network and on USB, without a pile of drivers
PRINTING=(cups-daemon cups-client cups-filters cups-ipp-utils avahi-daemon ipp-usb libnss-mdns)
in_chroot apt-get install -y --no-install-recommends "${PRINTING[@]}"

# bubblewrap builds every Flatpak app's sandbox, and refuses to run with file capabilities ("Unexpected capabilities
# but not setuid"): it needs none, as user namespaces are allowed (etc/sysctl.d/60-nimbus-userns.conf)
in_chroot python3 -c '
import os
try:
    caps = os.getxattr("/usr/bin/bwrap", "security.capability")
    os.removexattr("/usr/bin/bwrap", "security.capability")
    print("bwrap had file capabilities (%s): removed" % caps.hex())
except OSError as exc:
    print("bwrap has no file capabilities (%s)" % exc.strerror)
'

log "Building the window manager (nimbus-wm)"
WM_BUILD=(build-essential pkg-config libwlroots-dev wayland-protocols libwayland-bin libxcb1-dev libxcb-ewmh-dev libxcb-icccm4-dev)
in_chroot apt-get install -y --no-install-recommends "${WM_BUILD[@]}"
mkdir -p "$CHROOT/tmp/nimbus-wm"
cp "$REPO/wm/Makefile" "$REPO/wm/nimbus-wm.c" "$CHROOT/tmp/nimbus-wm/"
in_chroot make -C /tmp/nimbus-wm
install -m 755 "$CHROOT/tmp/nimbus-wm/nimbus-wm" "$CHROOT/usr/bin/nimbus-wm"
rm -rf "$CHROOT/tmp/nimbus-wm"
in_chroot apt-get purge -y --auto-remove "${WM_BUILD[@]}"
in_chroot ldd /usr/bin/nimbus-wm | grep -q "not found" && die "nimbus-wm is missing a library"
# The packages nimbus-wm's libraries come from: an update brings any a system lacks along with a new nimbus-wm
mapfile -t WM_RUNTIME < <(in_chroot python3 - <<'LIBS'
import os, re, subprocess
out = subprocess.run(["ldd", "/usr/bin/nimbus-wm"], capture_output=True, text=True).stdout
packages = set()
owner = re.compile(r"^([a-z0-9][a-z0-9+.-]+(?::[a-z0-9]+)?(?:, [a-z0-9][a-z0-9+.-]+(?::[a-z0-9]+)?)*): /")
for line in out.splitlines():
    lib = line.split("=>")[1].split("(")[0].strip() if "=>" in line else ""
    if not lib.startswith("/"):
        continue
    for path in (lib, os.path.realpath(lib), "/usr" + lib if lib.startswith("/lib") else lib):
        r = subprocess.run(["dpkg", "-S", path], capture_output=True, text=True)
        found = [m.group(1) for m in map(owner.match, r.stdout.splitlines()) if m]
        if found:
            packages.update(p.split(":")[0] for p in found[0].split(", "))
            break
print("\n".join(sorted(packages)))
LIBS
)
[ "${#WM_RUNTIME[@]}" -gt 3 ] || die "could not tell which packages nimbus-wm's libraries come from"
echo "nimbus-wm's libraries come from: ${WM_RUNTIME[*]}"

if [ -n "$APT_CACHE" ]; then
  umount "$CHROOT/var/cache/apt/archives"
  rm -rf "$APT_CACHE/apt/partial" "$APT_CACHE/apt/lock"
  chmod -R a+rX "$APT_CACHE"
  echo "Package cache: $(du -sh "$APT_CACHE" | cut -f1)"
fi

log "Configuring Nimbus OS"
in_chroot locale-gen en_US.UTF-8
ln -sf /usr/share/zoneinfo/Etc/UTC "$CHROOT/etc/localtime"
echo "Etc/UTC" > "$CHROOT/etc/timezone"

# Copy our files in as root, without touching the owner or rights of existing folders like /etc.
tar -C "$HERE/overlay" --owner=0 --group=0 -cf - . | tar -C "$CHROOT" --no-overwrite-dir -xf -
chmod 755 "$CHROOT/usr/bin/nimbus-shell" "$CHROOT/usr/bin/nimbus-session" "$CHROOT/usr/lib/nimbus/shell-debug" \
  "$CHROOT/usr/lib/nimbus/test-wifi-ap" "$CHROOT/usr/lib/nimbus/nimbus-storage" "$CHROOT/usr/lib/nimbus/nimbus-apps" \
  "$CHROOT/usr/lib/nimbus/nimbus-open" "$CHROOT/usr/lib/nimbus/nimbus-sys" "$CHROOT/usr/lib/nimbus/nimbus-update"
chmod 440 "$CHROOT"/etc/sudoers.d/nimbus-*
in_chroot visudo -cq || die "a sudoers file is broken"
# Which version this is, for Settings > Nimbus Update and About. An in-place update rewrites it and keeps "base".
COMMIT="${GITHUB_SHA:-$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)}"
BUILD_DATE="$(date +%s)"
mkdir -p "$CHROOT/usr/share/nimbus"
printf '{"version": "%s", "commit": "%s", "date": %s, "base": %s}\n' "$VERSION" "$COMMIT" "$BUILD_DATE" "$BASE" > "$CHROOT/usr/share/nimbus/build-info.json"

# Google Chrome can't be copied into this image, so Nimbus installs it from Google's repository when it's
# first opened (usr/lib/nimbus/nimbus-apps). Its packages are checked with Google's RSA 4096 signing key.
GOOGLE_KEY=EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
curl -fsSL --retry 3 https://dl.google.com/linux/linux_signing_key.pub -o "$GNUPGHOME/google.pub"
gpg --batch --quiet --import "$GNUPGHOME/google.pub" 2>/dev/null || true
gpg --batch --with-colons --list-keys "$GOOGLE_KEY" 2>/dev/null | grep -q "^fpr:::::::::$GOOGLE_KEY:" \
  || die "Google's signing key did not have the expected fingerprint"
mkdir -p "$CHROOT/usr/share/keyrings"
gpg --batch --export "$GOOGLE_KEY" > "$CHROOT/usr/share/keyrings/google-chrome.gpg"
rm -rf "$GNUPGHOME"; unset GNUPGHOME
echo "Google's signing key: $GOOGLE_KEY"
mkdir -p "$CHROOT/usr/share/nimbus" "$CHROOT/usr/share/fonts/truetype/nimbus" "$CHROOT/usr/share/doc/nimbus-os"
cp -a "$WORK/shell" "$CHROOT/usr/share/nimbus/shell"
cp "$HERE/fonts/"*.ttf "$HERE/fonts/"*-OFL.txt "$CHROOT/usr/share/fonts/truetype/nimbus/"
cp "$REPO/README.md" "$CHROOT/usr/share/doc/nimbus-os/README.md"
in_chroot fc-cache -f >/dev/null
# Our defaults for programs' settings (usr/share/glib-2.0/schemas/90_nimbus.gschema.override)
in_chroot sh -c 'for c in /usr/bin/glib-compile-schemas /usr/lib/x86_64-linux-gnu/glib-2.0/glib-compile-schemas; do
  [ -x "$c" ] && exec "$c" /usr/share/glib-2.0/schemas; done; echo "glib-compile-schemas not found" >&2; exit 1'

# Our name on the system, keeping a record of the Ubuntu release it is built on
cp "$CHROOT/usr/lib/os-release" "$CHROOT/usr/lib/os-release.base"
cat > "$CHROOT/usr/lib/os-release" <<EOF
PRETTY_NAME="Nimbus OS $VERSION"
NAME="Nimbus OS"
VERSION_ID="$VERSION"
VERSION="$VERSION"
ID=nimbus
ID_LIKE="ubuntu debian"
VERSION_CODENAME=$SUITE
UBUNTU_CODENAME=$SUITE
EOF
printf 'Nimbus OS %s \\n \\l\n\n' "$VERSION" > "$CHROOT/etc/issue"
echo "nimbus" > "$CHROOT/etc/hostname"
printf '127.0.0.1 localhost\n127.0.1.1 nimbus\n::1 localhost ip6-localhost ip6-loopback\n' > "$CHROOT/etc/hosts"

in_chroot systemctl set-default graphical.target
in_chroot systemctl enable nimbus-session.service NetworkManager.service systemd-resolved.service systemd-timesyncd.service \
  nimbus-test-wifi.service bluetooth.service power-profiles-daemon.service cups.socket avahi-daemon.service
# PipeWire and WirePlumber start with each person's session
in_chroot systemctl --global enable pipewire.socket pipewire-pulse.socket wireplumber.service
in_chroot systemctl disable systemd-networkd.service systemd-networkd.socket >/dev/null 2>&1 || true
in_chroot systemctl mask systemd-networkd-wait-online.service NetworkManager-wait-online.service
# The ISO has no checksum list to verify, so this check would only report a failure at startup.
in_chroot systemctl mask casper-md5check.service
# Nimbus Security downloads ClamAV's definitions when they're first needed, then daily (the desktop asks the
# root helper); freshclam's own service would download 230 MB at every start of a live system.
in_chroot systemctl disable clamav-freshclam.service >/dev/null 2>&1 || true
# The firewall is on from the start (Windows' is): incoming connections are refused unless allowed
sed -i 's/^ENABLED=.*/ENABLED=yes/' "$CHROOT/etc/ufw/ufw.conf"
grep -q '^ENABLED=yes' "$CHROOT/etc/ufw/ufw.conf" || die "could not turn the firewall on"
in_chroot systemctl enable ufw.service

log "Adjusting the live boot scripts"
# casper creates the storage area ("writable") in a USB stick's free space by itself, then mounts it
# a moment later, while udev may still be rescanning the stick ("Device or resource busy"). Retry
# for a few seconds instead of stopping the boot.
CASPER_SCRIPT="$CHROOT/usr/share/initramfs-tools/scripts/casper"
COW_MOUNT='    mount -t ${cow_fstype} -o ${cow_mountopt} ${cowdevice} /cow || panic "Can not mount $cowdevice on /cow"'
grep -qxF "$COW_MOUNT" "$CASPER_SCRIPT" || die "casper's storage mount line changed; review the Nimbus patch in build-iso.sh"
python3 - "$CASPER_SCRIPT" "$COW_MOUNT" <<'PATCH'
import sys
path, line = sys.argv[1], sys.argv[2]
retry = """    # Nimbus: a storage area casper has just created can be busy for a moment while udev rescans the disk
    for _try in 1 2 3 4 5 6 7 8 9 10; do
        mount -t ${cow_fstype} -o ${cow_mountopt} ${cowdevice} /cow && break
        udevadm settle; sleep 1
    done
    grep -qs " /cow " /proc/mounts || panic "Can not mount $cowdevice on /cow\""""
text = open(path).read()
open(path, "w").write(text.replace(line, retry, 1))
PATCH
grep -q "Nimbus: a storage area casper has just created" "$CASPER_SCRIPT" || die "patching casper failed"

log "Building the startup image (initramfs)"
KVER="$(ls "$CHROOT/usr/lib/modules" | sort -V | tail -n 1)"
in_chroot update-initramfs -d -k "$KVER" >/dev/null 2>&1 || true
in_chroot update-initramfs -c -k "$KVER"

log "Applying Nimbus's one-off setup steps (os/migrations)"
# The same steps reach systems updating in place (usr/lib/nimbus/nimbus-update), so they live in one place
for step in "$HERE"/migrations/[0-9][0-9][0-9][0-9]-*.sh; do
  [ -e "$step" ] || continue
  cp "$step" "$CHROOT/tmp/nimbus-migration.sh"
  in_chroot sh -e /tmp/nimbus-migration.sh || die "migration $(basename "$step") failed"
  rm -f "$CHROOT/tmp/nimbus-migration.sh"
  echo "Ran $(basename "$step")"
done

log "Packing the update for running systems"
# Nimbus's own files, for Settings > Nimbus Update on systems started from an older ISO (os/update-bundle.py). It
# also writes the new system's list of those files, which the next update compares against.
rm -f "$OUT"/nimbus-os-update-*.tar.xz "$OUT/nimbus-os-update.json"
python3 "$HERE/update-bundle.py" build "$CHROOT" "$OUT" --overlay "$HERE/overlay" --migrations "$HERE/migrations" \
  --version "$VERSION" --commit "$COMMIT" --date "$BUILD_DATE" --suite "$SUITE" --base "$BASE" \
  --packages "${PACKAGES[*]} ${PRINTING[*]} ${WM_RUNTIME[*]}" --notes-from "$REPO"

log "Cleaning up"
in_chroot apt-get clean
# The finished system uses the public Ubuntu servers and its own name lookup service.
cat > "$CHROOT/etc/apt/sources.list" <<EOF
deb http://archive.ubuntu.com/ubuntu $SUITE main restricted universe
deb http://archive.ubuntu.com/ubuntu $SUITE-updates main restricted universe
deb http://security.ubuntu.com/ubuntu $SUITE-security main restricted universe
EOF
ln -sf ../run/systemd/resolve/stub-resolv.conf "$CHROOT/etc/resolv.conf"
rm -rf "$CHROOT/var/lib/apt/lists/"* "$CHROOT/var/cache/apt/"*.bin "$CHROOT/tmp/"* "$CHROOT/var/tmp/"* "$CHROOT/var/log/"*.log
rm -f "$CHROOT/usr/sbin/policy-rc.d" "$CHROOT/var/lib/dbus/machine-id"
: > "$CHROOT/etc/machine-id"

[ -f "$CHROOT/boot/vmlinuz-$KVER" ] || die "kernel $KVER was not installed"
cp "$CHROOT/boot/vmlinuz-$KVER" "$ISODIR/casper/vmlinuz"
cp "$CHROOT/boot/initrd.img-$KVER" "$ISODIR/casper/initrd"
echo "Kernel $KVER"

unmount_all
log "Compressing the system"
du -sx --block-size=1 "$CHROOT" | cut -f1 > "$ISODIR/casper/filesystem.size"
mksquashfs "$CHROOT" "$ISODIR/casper/filesystem.squashfs" -noappend -comp xz -Xbcj x86 -b 1M -wildcards -e 'boot/*'
printf 'Nimbus OS %s "%s" - amd64 (%s)\n' "$VERSION" "$SUITE" "$(date -u +%Y%m%d)" > "$ISODIR/.disk/info"
cp "$HERE/grub.cfg" "$ISODIR/boot/grub/grub.cfg"

log "Making the bootable ISO"
# The same layout as Ubuntu's own ISOs: the ISO 9660 file system is also readable as partition 1
# (-partition_offset 16), with the EFI boot image as partition 2. casper mounts partition 1, so
# it can still mount the storage area it adds to a USB stick (it can't while the whole stick is in use).
GRUB_LIB=/usr/lib/grub
mkdir -p "$ISODIR/boot/grub/i386-pc" "$ISODIR/boot/grub/x86_64-efi" "$ISODIR/boot/grub/fonts"
cp "$GRUB_LIB"/i386-pc/*.mod "$GRUB_LIB"/i386-pc/*.lst "$ISODIR/boot/grub/i386-pc/"
cp "$GRUB_LIB"/x86_64-efi/*.mod "$GRUB_LIB"/x86_64-efi/*.lst "$ISODIR/boot/grub/x86_64-efi/"
cp /usr/share/grub/unicode.pf2 "$ISODIR/boot/grub/fonts/"
: > "$ISODIR/.disk/nimbus-os"  # GRUB on UEFI finds the Nimbus disc or stick by this file
# BIOS: GRUB as an El Torito image; on a USB stick the hybrid MBR code starts it
grub-mkimage -O i386-pc-eltorito -p /boot/grub -o "$ISODIR/boot/grub/i386-pc/eltorito.img" biosdisk iso9660
# UEFI: GRUB in a small FAT image. Its built-in config only finds the Nimbus file system; GRUB then
# reads $prefix/grub.cfg itself, keeping $root (a "configfile" here would start a context without it).
cat > "$WORK/grub-efi.cfg" <<'EOF'
search --no-floppy --set=root --file /.disk/nimbus-os
set prefix=($root)/boot/grub
EOF
grub-mkimage -O x86_64-efi -p /boot/grub -c "$WORK/grub-efi.cfg" -o "$WORK/bootx64.efi" \
  part_gpt part_msdos fat iso9660 search search_fs_file configfile normal
rm -f "$WORK/efi.img"
mkfs.msdos -C "$WORK/efi.img" 4096 >/dev/null
mmd -i "$WORK/efi.img" ::/EFI ::/EFI/BOOT
mcopy -i "$WORK/efi.img" "$WORK/bootx64.efi" ::/EFI/BOOT/BOOTX64.EFI
rm -f "$ISO"
xorriso -as mkisofs -r -J -joliet-long -V NIMBUS_OS -o "$ISO" \
  --grub2-mbr "$GRUB_LIB/i386-pc/boot_hybrid.img" \
  --protective-msdos-label -partition_cyl_align off -partition_offset 16 --mbr-force-bootable \
  -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$WORK/efi.img" -appended_part_as_gpt \
  -iso_mbr_part_type a2a0d0ebe5b9334487c068b6b72699c7 \
  -c /boot.catalog \
  -b /boot/grub/i386-pc/eltorito.img -no-emul-boot -boot-load-size 4 -boot-info-table --grub2-boot-info \
  -eltorito-alt-boot -e '--interval:appended_partition_2:::' -no-emul-boot \
  "$ISODIR"
(cd "$OUT" && sha256sum "$(basename "$ISO")" > "$(basename "$ISO").sha256")
ls -lh "$ISO"
log "Done: $ISO"
