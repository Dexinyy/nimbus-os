# Nimbus OS

Your own desktop operating system, inspired by Windows 11, without ads, without an account to create, and with a taskbar you can move. It runs on Linux, built from Ubuntu 24.04 LTS packages.

**Version 0.1:** the computer starts straight into the Nimbus desktop, from a USB stick or in a virtual machine, and real programs such as Google Chrome open as windows on it.

## Try it

Download `nimbus-os-0.1-amd64.iso` from the [latest release](../../releases/tag/latest).

### In a virtual machine (easiest)

1. Install [VirtualBox](https://www.virtualbox.org/) (free).
2. Click **New**. Name it Nimbus OS, pick the ISO file, set the type to **Linux** and the version to **Ubuntu (64-bit)**, and tick **Skip Unattended Installation**.
3. Give it **4096 MB** of memory and 2 processors. To keep your work between restarts, also add a new hard disk (8 GB is plenty); otherwise choose **Do Not Add a Virtual Hard Disk**.
4. In **Settings → Display**, choose the **VMSVGA** graphics controller.
5. Click **Start**. The desktop appears in about 30 seconds.

### On a real PC

1. Write the ISO to a USB stick with [balenaEtcher](https://etcher.balena.io/) or [Rufus](https://rufus.ie/). In Rufus, pick **DD image** mode when it asks.
2. Restart the PC and open its boot menu (usually **F12**, **F11**, **F8** or **Esc** while it starts). Choose the USB stick.
3. **Secure Boot must be turned off** in your PC's firmware settings for now.

Nothing gets installed and your drive isn't touched. Until you set up saving, everything is gone when you shut down.

### Keeping your work

- **From a USB stick**, Nimbus saves your files, settings, Wi-Fi passwords and installed programs by itself, in the stick's free space. Nothing else on the stick changes.
- **In a virtual machine or from a DVD**, add an empty disk (in VirtualBox: a new hard disk, 8 GB is plenty), then click **Set up saving** in the Welcome window or in **Settings › System**. Nimbus only offers disks that are completely empty, and asks once more before using one. Restart once, and from then on your work is kept.

## What works in 0.1

- Starts on UEFI and older BIOS PCs, from USB or disc
- The full Nimbus desktop: windows, snap layouts, Task View, Start and search, quick settings, notifications
- Apps: Files, Notes, Paint, Photos, Calculator, Terminal, Clock, Mines, Task Manager, Settings
- **Google Chrome is the web browser**, pinned to the taskbar. Its license doesn't allow copying it into Nimbus, so the first time you open it, Nimbus downloads it from Google (about 120 MB, so you need internet) and installs it. After that it opens right away, and Nimbus keeps it updated. Without saving turned on (see above), it's gone after a restart.
- **Real programs are real windows**: Chrome, or anything you start from Terminal, sits on the desktop with Nimbus's own windows. The taskbar, Alt+Tab, Task View, snapping (drag to an edge, or Win+arrow keys), minimizing and Start all work with them.
- **Shut down, Restart and Sleep** control the real computer
- **Wi-Fi**: the Wi-Fi tile in quick settings and **Settings › Network & internet** list nearby networks; click one and type its password. Airplane mode too.
- **Terminal** runs real `bash`: `sudo`, `nano`, `less`, `top`, `htop`, `neofetch` and the rest, with colors, scrollback and copy/paste (Ctrl+Shift+C / Ctrl+Shift+V)
- **Saving between restarts**: automatic from a USB stick, or on an empty disk (see above)
- **Settings → About** shows your real hardware, and you can set the **time zone**
- Keyboard: **Windows key** opens Start, **Alt+Tab** switches windows, **Alt+F4** closes a window or offers to shut down. Win+E opens Files, Win+I opens Settings, Win+D shows the desktop, Win+L locks, and Win+arrow keys snap the active window.
- Wired internet connects automatically, and the clock sets itself
- A text console for the curious: **Ctrl+Alt+F2**, user `nimbus`, no password. **Ctrl+Alt+F1** goes back to the desktop.

## Not yet

- Installing to a drive (saving between restarts works from the USB stick or an empty disk)
- Bluetooth, sound volume, display settings
- An app store: programs other than Chrome install from Terminal (`sudo apt install ...`, from Ubuntu's repositories)
- Opening files from your own drives
- Secure Boot

## Roadmap

1. ✅ Starts into the Nimbus desktop (0.1)
2. ✅ Real programs open as Nimbus windows with snapping and the taskbar; Google Chrome is the browser
3. Settings controls Bluetooth, sound and displays, and Files opens your real drives (Wi-Fi ✅)
4. An installer
5. Polish on real hardware, and Secure Boot

## How it fits together

| Part | What it does |
|---|---|
| `shell/` | The desktop itself (HTML, CSS and JavaScript). `python3 shell/build.py` builds the web version; `--native DIR` builds the version for the OS. |
| `wm/nimbus-wm.c` | The window manager, a Wayland compositor built on wlroots. It draws the desktop page at the bottom and programs' windows above it; the page tells it which of its parts (its own windows, the taskbar, menus) belong above each program window. |
| `os/overlay/usr/bin/nimbus-shell` | Shows the desktop with WebKitGTK and gives it a few system abilities: power, hardware info, time zone, starting and installing programs. It passes messages between the page and the window manager. |
| `os/overlay/usr/bin/nimbus-session` and `nimbus-session.service` | Start the window manager and the desktop at boot (falling back to the cage compositor if it can't start). |
| `os/build-iso.sh` | Builds the bootable ISO from Ubuntu 24.04 packages. |
| `os/overlay/usr/lib/nimbus/` | `nimbus_term.py` (the terminal's screen), `nimbus_net.py` (Wi-Fi through NetworkManager), `nimbus-storage` (sets up saving, run as root), `nimbus-apps` (installs Chrome from Google's signed repository, run as root), `nimbus-open` (opens web links). |
| `os/test-boot.sh`, `os/qmp.py` | Boot the ISO in virtual machines and check it: UEFI and BIOS start, Start and Terminal, Alt+Tab, joining a simulated Wi-Fi network, saving across restarts, installing and using Chrome, and Shut down. |
| `wm/test-headless.sh` | A quick check of the window manager with the desktop and Chrome, without a virtual machine. |
| `os/test-*.py`, `shell/test/` | Tests for the terminal, network and storage helpers, and for the desktop's terminal, Wi-Fi, saving and program-window code. |
| `.github/workflows/build.yml` | Builds and tests on every push to `main`. It publishes the ISO as the **latest** release and saves test screenshots to the `ci-results` branch. |

## Troubleshooting

Add `nimbus.debug` to the kernel command line (press **e** on the boot menu entry) to log the desktop's keyboard, focus and Wayland messages. Read them on a text console with `journalctl -b -u nimbus-session`.

## Build it yourself

On Ubuntu 24.04:

```sh
sudo apt-get install debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub-common mtools dosfstools curl gnupg qemu-system-x86 ovmf python3-pil
sudo ./build.sh                                   # writes out/nimbus-os-0.1-amd64.iso
./os/test-boot.sh out/nimbus-os-0.1-amd64.iso     # optional boot test with screenshots in out/ci
```

## Credits

Built from Ubuntu 24.04 LTS packages. Nimbus OS is not affiliated with Canonical, Microsoft or Google. Google Chrome is Google's software, downloaded from Google under its own terms; Nimbus doesn't include it. The fonts Figtree, Sora and JetBrains Mono are used under the SIL Open Font License (see `os/fonts`).
