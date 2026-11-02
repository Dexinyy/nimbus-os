#!/usr/bin/env bash
# Build the Nimbus OS live ISO for 64-bit PCs from Ubuntu 24.04 packages.
#
# Needs root on Ubuntu 24.04 (a GitHub Actions runner works) with these tools:
#   debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub-common mtools dosfstools python3
# Output: out/nimbus-os-<version>-amd64.iso (boots on UEFI and BIOS PCs, from USB or disc)
set -euo pipefail

VERSION="${NIMBUS_VERSION:-0.1}"
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
for tool in debootstrap mksquashfs grub-mkrescue xorriso mformat python3; do
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
PACKAGES=(
  "$KIMAGE" ${KEXTRA:+"$KEXTRA"} linux-firmware intel-microcode amd64-microcode
  casper user-setup initramfs-tools
  systemd-sysv systemd-resolved systemd-timesyncd udev dbus dbus-user-session libpam-systemd polkitd kmod
  network-manager wpasupplicant wireless-regdb iw dnsmasq-base
  fdisk e2fsprogs
  sudo locales tzdata kbd iproute2 ca-certificates less nano
  procps psmisc htop neofetch curl wget vim-tiny bash-completion
  cage libgl1-mesa-dri libegl1 libegl-mesa0 libgles2 libgbm1
  python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
  adwaita-icon-theme hicolor-icon-theme gsettings-desktop-schemas dconf-gsettings-backend shared-mime-info
  fontconfig fonts-dejavu-core
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-alsa
)
if [ -n "$APT_CACHE" ]; then
  mkdir -p "$APT_CACHE/apt/partial"
  mount --bind "$(cd "$APT_CACHE/apt" && pwd)" "$CHROOT/var/cache/apt/archives"
fi
in_chroot apt-get install -y "${PACKAGES[@]}"
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
  "$CHROOT/usr/lib/nimbus/test-wifi-ap" "$CHROOT/usr/lib/nimbus/nimbus-storage"
chmod 440 "$CHROOT/etc/sudoers.d/nimbus-storage"
mkdir -p "$CHROOT/usr/share/nimbus" "$CHROOT/usr/share/fonts/truetype/nimbus" "$CHROOT/usr/share/doc/nimbus-os"
cp -a "$WORK/shell" "$CHROOT/usr/share/nimbus/shell"
cp "$HERE/fonts/"*.ttf "$HERE/fonts/"*-OFL.txt "$CHROOT/usr/share/fonts/truetype/nimbus/"
cp "$REPO/README.md" "$CHROOT/usr/share/doc/nimbus-os/README.md"
in_chroot fc-cache -f >/dev/null

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
  nimbus-test-wifi.service
in_chroot systemctl disable systemd-networkd.service systemd-networkd.socket >/dev/null 2>&1 || true
in_chroot systemctl mask systemd-networkd-wait-online.service NetworkManager-wait-online.service
# The ISO has no checksum list to verify, so this check would only report a failure at startup.
in_chroot systemctl mask casper-md5check.service

log "Building the startup image (initramfs)"
KVER="$(ls "$CHROOT/usr/lib/modules" | sort -V | tail -n 1)"
in_chroot update-initramfs -d -k "$KVER" >/dev/null 2>&1 || true
in_chroot update-initramfs -c -k "$KVER"

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
rm -f "$ISO"
grub-mkrescue -o "$ISO" "$ISODIR" -- -volid NIMBUS_OS
(cd "$OUT" && sha256sum "$(basename "$ISO")" > "$(basename "$ISO").sha256")
ls -lh "$ISO"
log "Done: $ISO"
