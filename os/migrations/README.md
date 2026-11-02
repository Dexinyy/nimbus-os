# One-off setup steps (migrations)

Nimbus OS updates in place (Settings › Nimbus Update): a running system gets each new version's files without the
ISO being written to its USB stick again. Files are the easy part. A change that is *done* rather than *copied*
(enabling a service, editing a file a package owns, moving settings) also has to reach systems that were set up
before it. That is what a migration is for.

- One shell script per change, named `NNNN-what-it-does.sh` with the next free number. Steps run in number order.
- The ISO build runs every script in the new system (`os/build-iso.sh`), so new ISOs have them all. An update runs
  the ones a system hasn't had yet, as root, after the new files are in place (`usr/lib/nimbus/nimbus-update`).
  `/var/lib/nimbus/update/migrations.done` remembers which ones ran.
- Each script runs with `sh -e`. It must be safe to run on any older Nimbus system and must not depend on the
  order of other updates. Check before changing anything, and don't fail when the change is already there.
- Systemd is not running inside the ISO build, so use `systemctl enable` or `disable`, not `start` or `restart`.
  A restart finishes every update anyway.
