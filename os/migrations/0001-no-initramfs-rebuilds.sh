#!/bin/sh
# A live system starts with the startup image (initramfs) on its USB stick or disc, so one rebuilt on the system
# would never be used: it would only take a minute and fill the storage area whenever a package asks for it.
conf=/etc/initramfs-tools/update-initramfs.conf
if [ -f "$conf" ] && grep -q '^update_initramfs=' "$conf"; then
  sed -i 's/^update_initramfs=.*/update_initramfs=no/' "$conf"
fi
