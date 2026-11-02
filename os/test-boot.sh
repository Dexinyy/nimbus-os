#!/usr/bin/env bash
# Boot a Nimbus OS ISO in virtual machines and check that it works.
#   1. UEFI (DVD): start, open Start, Terminal and Settings, Alt+Tab, shut down
#   2. BIOS (DVD): start, shut down; then the same from a USB stick, on BIOS and on UEFI
#   3. Logs: the same as 1, with the system log and keyboard/focus events copied to the serial port
#   4. Wi-Fi: joins a simulated access point through the desktop's Wi-Fi code
#   5. Saving from a USB image: casper saves in its free space; a setting survives a restart
#   6. Saving from a DVD with an empty disk: Nimbus sets the disk up; a setting survives a restart
#   7. Chrome: installed from Google, opened as a window; Start, Settings and Alt+Tab over it, typing, closing
#   8. Settings: sound, display resolution, input, power, printing and storage through the real services
#   9. Security: real-time protection, scans and quarantine (a test signature), the firewall, a virtual controller
#  10. Store: Flathub's catalog, then Discord installed and opened as a window
#  11. Nimbus Update: from a USB image that saves, a newer build installed in place from Settings, a restart into
#      it, then back to the first build from Recovery and another restart
# usage: os/test-boot.sh ISO [OUTDIR]     results: OUTDIR/*.png, *-serial.log, summary.md
#        NIMBUS_ONLY="name ..." runs only those machines (uefi bios usb-bios usb-uefi logs wifi usb disk settings chrome
#        security store update)
set -uo pipefail

ISO="$(readlink -f "${1:?usage: test-boot.sh ISO [OUTDIR]}")"
mkdir -p "${2:-out/ci}"
OUTDIR="$(cd "${2:-out/ci}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$ISO" ] || { echo "No ISO at $ISO"; exit 1; }

if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
  ACCEL=(-accel kvm -cpu host); SLOW=1
else
  ACCEL=(-accel tcg -cpu max); SLOW=6; echo "No hardware acceleration: the tests will be slow"
fi
OVMF_CODE="$(ls /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd 2>/dev/null | head -n 1)"
OVMF_VARS="$(ls /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd 2>/dev/null | head -n 1)"
printf '## Boot test\n\nImage: %s (%s MB)\n' "$(basename "$ISO")" "$(( $(stat -c %s "$ISO") / 1048576 ))" > "$OUTDIR/summary.md"
FAILED=0

run_vm() { # name scenario [extra qemu arguments]   (MEM=megabytes to change the memory)
  local name="$1" scenario="$2"; shift 2
  # NIMBUS_ONLY="update store" runs just those machines (quicker while working on one part)
  if [ -n "${NIMBUS_ONLY:-}" ] && [[ " $NIMBUS_ONLY " != *" $name "* ]]; then echo "== $name: skipped"; return 0; fi
  local sock="/tmp/nimbus-$name.qmp"
  rm -f "$sock"
  echo "== $name ($scenario)"
  qemu-system-x86_64 "${ACCEL[@]}" -machine q35 -m "${MEM:-4096}" -smp 2 \
    -vga none -device VGA,edid=on,xres=1440,yres=900 \
    -device qemu-xhci -device usb-tablet \
    -nic user,model=virtio-net-pci \
    -audiodev none,id=snd -device intel-hda -device hda-duplex,audiodev=snd \
    -display none -serial "file:$OUTDIR/$name-serial.log" \
    -qmp "unix:$sock,server=on,wait=off" "$@" &
  local pid=$!
  python3 "$HERE/qmp.py" "$sock" "$OUTDIR" "$name" "$SLOW" "$scenario" || FAILED=1
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  return 0
}

usb_image() { # a fresh copy of the ISO as a 3 GB "USB stick"
  cp --sparse=always "$ISO" "$1" && truncate -s 3G "$1"
}
uefi_firmware() {
  cp "$OVMF_VARS" "/tmp/nimbus-ovmf-vars-$1.fd"
  echo -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" -drive if=pflash,format=raw,file="/tmp/nimbus-ovmf-vars-$1.fd"
}
if [ -n "$OVMF_CODE" ]; then
  # shellcheck disable=SC2046
  run_vm uefi full -cdrom "$ISO" $(uefi_firmware cd)
else
  echo "OVMF is not installed: skipping the UEFI tests"
fi
run_vm bios short -cdrom "$ISO" -boot d
# Started from a USB stick by the PC's firmware: BIOS through the hybrid MBR, UEFI through the EFI partition.
# The default menu entry saves by itself, so these also cover casper adding the storage area.
usb_image /tmp/nimbus-usb-bios.img
run_vm usb-bios short -drive if=none,id=stick,file=/tmp/nimbus-usb-bios.img,format=raw -device usb-storage,drive=stick,bootindex=0
if [ -n "$OVMF_CODE" ]; then
  usb_image /tmp/nimbus-usb-uefi.img
  # shellcheck disable=SC2046
  run_vm usb-uefi short $(uefi_firmware usb) -drive if=none,id=stick,file=/tmp/nimbus-usb-uefi.img,format=raw -device usb-storage,drive=stick,bootindex=0
fi

xorriso -osirrox on -indev "$ISO" -extract /casper/vmlinuz /tmp/nimbus-vmlinuz -extract /casper/initrd /tmp/nimbus-initrd >/dev/null 2>&1
# Same steps again with the system log (and the desktop's keyboard and focus events) on the serial port
SERIAL="console=tty0 console=ttyS0,115200 systemd.journald.forward_to_console=1 systemd.show_status=1"
run_vm logs full -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug $SERIAL"
# Wi-Fi: a simulated access point (mac80211_hwsim), joined with its password
run_vm wifi wifi -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug nimbus.test=wifi nimbus.open=settings:network $SERIAL"
# Saving from a USB stick: the ISO written to a 3 GB image file; casper saves in its free space by itself
usb_image /tmp/nimbus-usb.img
run_vm usb storage -drive if=none,id=stick,file=/tmp/nimbus-usb.img,format=raw -device usb-storage,drive=stick \
  -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt persistent nimbus.debug nimbus.test=storage nimbus.open=settings:system $SERIAL"
# Saving from a DVD with an empty disk (like VirtualBox): Nimbus sets the disk up
truncate -s 2G /tmp/nimbus-empty.img
run_vm disk storage -cdrom "$ISO" -drive file=/tmp/nimbus-empty.img,format=raw,if=virtio \
  -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt persistent nimbus.debug nimbus.test=storage nimbus.open=settings:system $SERIAL"

# Settings: sound through PipeWire (the machine has an HD Audio card), resolutions through the window manager, ...
run_vm settings settings -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug nimbus.test=settings $SERIAL"

# Google Chrome: Nimbus installs it from Google (the machine reaches the internet through QEMU) and shows it as a window
run_vm chrome chrome -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug nimbus.test=chrome $SERIAL"

# Nimbus Security: virus protection with a test signature, the firewall, device security, a virtual game controller
run_vm security security -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug nimbus.test=security $SERIAL"

# The Store: Flathub's catalog, and Discord installed and opened (an X11 program, through Xwayland). Apps land in
# memory on a live system, so this machine gets more of it.
MEM=6144 run_vm store store -cdrom "$ISO" -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
  -append "boot=casper noprompt nimbus.debug nimbus.test=store $SERIAL"

# Nimbus Update: the build's own update package, made newer (os/update-bundle.py test) and offered by a server on this
# machine, which the VM reaches as 10.0.2.2. It also needs a package from Ubuntu's servers ("hello").
UPDATE_JSON="$(dirname "$ISO")/nimbus-os-update.json"
if [ -f "$UPDATE_JSON" ]; then
  rm -rf /tmp/nimbus-update-server
  python3 "$HERE/update-bundle.py" test "$UPDATE_JSON" /tmp/nimbus-update-server
  python3 -m http.server 8642 --bind 127.0.0.1 --directory /tmp/nimbus-update-server >"$OUTDIR/update-server.log" 2>&1 &
  server=$!
  usb_image /tmp/nimbus-usb-update.img
  run_vm update update -drive if=none,id=stick,file=/tmp/nimbus-usb-update.img,format=raw -device usb-storage,drive=stick \
    -kernel /tmp/nimbus-vmlinuz -initrd /tmp/nimbus-initrd \
    -append "boot=casper noprompt persistent nimbus.debug nimbus.test=update nimbus.update-url=http://10.0.2.2:8642/ $SERIAL"
  kill "$server" 2>/dev/null
  rm -f /tmp/nimbus-usb-update.img
else
  printf '\n### update\n- ❌ No update package next to the ISO (%s)\n' "$UPDATE_JSON" >> "$OUTDIR/summary.md"
  FAILED=1
fi

cat "$OUTDIR/summary.md"
exit "$FAILED"
