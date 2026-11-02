# Nimbus OS

Your own desktop operating system, inspired by Windows 11, without ads, without an account to create, and with a taskbar you can move. It runs on Linux, built from Ubuntu 24.04 LTS packages.

**Version 0.1:** the computer starts straight into the Nimbus desktop, from a USB stick or in a virtual machine, and real programs such as Google Chrome open as windows on it. Settings looks and works like Windows 11's and controls the real hardware: sound, displays, Bluetooth, mouse and keyboard, power, networks, printers and more.

## Try it

Download `nimbus-os-0.1-amd64.iso` from the [latest release](../../releases/tag/latest).

### In a virtual machine (easiest)

1. Install [VirtualBox](https://www.virtualbox.org/) (free).
2. Click **New**. Name it Nimbus OS, pick the ISO file, set the type to **Linux** and the version to **Ubuntu (64-bit)**, and tick **Skip Unattended Installation**.
3. Give it **4096 MB** of memory and 2 processors. To keep your work between restarts, also add a new hard disk (8 GB is plenty); otherwise choose **Do Not Add a Virtual Hard Disk**.
4. In **Settings → Display**, choose the **VMSVGA** graphics controller. In **Settings → Audio**, keep audio on and choose **Intel HD Audio** as the controller (sound plays through your PC's speakers).
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
- **Real programs are real windows**: Chrome, or anything you start from Terminal, sits on the desktop with Nimbus's own windows. The taskbar, Alt+Tab, Task View, snapping (drag to an edge, or Win+arrow keys), minimizing and Start all work with them. Programs made for X11 (Steam, Discord, most games, Windows programs through Wine) work too, through Xwayland; the ones that don't draw their own title bar get a Windows 11-style one from Nimbus.
- **The Store**, like the Microsoft Store: search and browse thousands of apps and games from [Flathub](https://flathub.org) and install them with one click: **Steam**, **Discord**, Spotify, VLC, OBS, Heroic (Epic Games and GOG), Prism Launcher (Minecraft) and more. **Battle.net**, the **EA app** and **Ubisoft Connect** are Windows programs: the Store sets them up with Lutris, which runs them with Wine. Installed apps are in Start and search, pin to the taskbar, show their own icon on their windows, get updates in the Store's Library, and uninstall from Start, the Store or Settings. They install for you alone, without a password; without saving turned on (see above), they're gone after a restart.
- **Nimbus Security**, like Windows Security: virus & threat protection with ClamAV (quick, full and custom scans, real-time protection of your downloads and desktop, quarantine, allowed threats, exclusions and protection history), the firewall on from the start with Private and Public network profiles and allowed apps (Steam Remote Play is allowed on private networks), app & browser control, device security (Secure Boot, the TPM, exploit protections) and a health report. Its virus definitions (about 230 MB) download the first time they're needed, then update daily.
- **Game controllers**: Xbox, PlayStation 5 (DualSense), PlayStation 4 (DualShock 4) and 3, Switch Pro and Joy-Con, Steam, 8BitDo and most others work over USB and Bluetooth, for Steam (and Steam Input) and games. **Settings › Bluetooth & devices › Game controllers** lists them with their battery, tests their buttons and sticks, makes them vibrate, and explains how to pair each kind.
- **Shut down, Restart and Sleep** control the real computer
- **Wi-Fi**: the Wi-Fi tile in quick settings and **Settings › Network & internet** list nearby networks; click one and type its password. Airplane mode too.
- **Terminal** runs real `bash`: `sudo`, `nano`, `less`, `top`, `htop`, `neofetch` and the rest, with colors, scrollback and copy/paste (Ctrl+Shift+C / Ctrl+Shift+V)
- **Saving between restarts**: automatic from a USB stick, or on an empty disk (see above)
- **Settings, like Windows 11's**: Home, System, Bluetooth & devices, Network & internet, Personalization, Apps, Accounts, Time & language, Gaming, Accessibility, Privacy & security and Nimbus Update, with Find a setting. What they control on the real computer:
  - **Sound**: the output and input device, volume and mute, volume for each program, a sound troubleshooter. Sound goes through PipeWire (smooth in virtual machines too), and the volume keys work.
  - **Display**: resolution, refresh rate, scale and orientation (with Windows' "Keep these display settings?" countdown), brightness, night light on a schedule
  - **Bluetooth**: turn it on, pair headphones, speakers, mice and keyboards, connect and remove them
  - **Mouse and touchpad**: pointer speed, primary button, scrolling lines and direction, tap to click; **keyboard** layout and repeat speed; pointer size and color
  - **Power**: screen off and sleep after a while, power modes, battery
  - **Network**: Wi-Fi and known networks, IP and DNS settings, metered connections, WireGuard VPNs, mobile hotspot, proxy, data usage, network reset
  - **Printers**: find and add printers on your network or USB (driverless), test page, default printer
  - **Time**: set automatically or by hand, time zone, 24-hour clock, regional formats
  - **Personalization**: themes, background (picture, solid color, slideshow), accent color, dark mode, lock screen, Start layout and folders, taskbar (alignment, search box, auto-hide), fonts you can install
  - Also: PC name, storage use and cleanup, a lock-screen PIN, startup apps, the default browser, camera and microphone access, screenshots with **Print screen**, clipboard history with **Win+V**, and checking for new versions of Nimbus and Chrome
  - **Privacy & security › Nimbus Security** shows each protection area's status and opens the Security app
  - Left out on purpose: the Microsoft account
- Keyboard: **Windows key** opens Start, **Alt+Tab** switches windows, **Alt+F4** closes a window or offers to shut down. Win+E opens Files, Win+I opens Settings, Win+D shows the desktop, Win+L locks, and Win+arrow keys snap the active window.
- Wired internet connects automatically, and the clock sets itself
- A text console for the curious: **Ctrl+Alt+F2**, user `nimbus`, no password. **Ctrl+Alt+F1** goes back to the desktop.

## Not yet

- Installing to a drive (saving between restarts works from the USB stick or an empty disk)
- More than one display at a time (the desktop shows on the first one)
- Games whose anti-cheat refuses Linux (some online shooters): check a game on [ProtonDB](https://www.protondb.com) before buying it
- Xbox controllers through Microsoft's USB wireless adapter (over Bluetooth or a cable they work)
- Opening files from your own drives
- Secure Boot

## Roadmap

1. ✅ Starts into the Nimbus desktop (0.1)
2. ✅ Real programs open as Nimbus windows with snapping and the taskbar; Google Chrome is the browser
3. ✅ Settings, like Windows 11's, controls the real hardware (Files opening your own drives comes next)
4. ✅ The Store (Steam, Discord, Battle.net and more), Nimbus Security, game controllers
5. An installer
6. Polish on real hardware, and Secure Boot

## How it fits together

| Part | What it does |
|---|---|
| `shell/` | The desktop itself (HTML, CSS and JavaScript). `python3 shell/build.py` builds the web version; `--native DIR` builds the version for the OS. |
| `wm/nimbus-wm.c` | The window manager, a Wayland compositor built on wlroots. It draws the desktop page at the bottom and programs' windows above it; the page tells it which of its parts (its own windows, the taskbar, menus, title bars it draws for X11 programs) belong above each program window. It starts Xwayland for X11 programs when the first one opens. |
| `os/overlay/usr/bin/nimbus-shell` | Shows the desktop with WebKitGTK and gives it a few system abilities: power, hardware info, time zone, starting and installing programs. It passes messages between the page and the window manager. |
| `os/overlay/usr/bin/nimbus-session` and `nimbus-session.service` | Start the window manager and the desktop at boot (falling back to the cage compositor if it can't start). |
| `os/build-iso.sh` | Builds the bootable ISO from Ubuntu 24.04 packages. |
| `os/overlay/usr/lib/nimbus/` | `nimbus_term.py` (the terminal's screen), `nimbus_net.py` (Wi-Fi through NetworkManager), `nimbus_sys.py` (what Settings controls: PipeWire, BlueZ, displays and input through the window manager, power, the clock, CUPS, NetworkManager, updates), `nimbus-sys` (the few settings that need root), `nimbus-storage` (sets up saving, run as root), `nimbus-apps` (installs and updates Chrome from Google's signed repository, run as root), `nimbus-open` (opens web links), `nimbus_store.py` (the Store: Flathub through flatpak, and Lutris), `nimbus_security.py` (ClamAV scans, real-time protection, quarantine, the firewall through `nimbus-sys`, device security), `nimbus_controllers.py` (game controllers: list, batteries, live test, rumble). `/usr/lib/udev/rules.d/70-nimbus-controllers.rules` lets Steam and games reach controllers. |
| `os/test-boot.sh`, `os/qmp.py` | Boot the ISO in virtual machines and check it: UEFI and BIOS start, Start and Terminal, Alt+Tab, joining a simulated Wi-Fi network, saving across restarts, installing and using Chrome, Settings changing the volume and the resolution, Nimbus Security finding a test virus (in real time and in a scan) and the firewall, a virtual DualSense in Settings, the Store installing Discord from Flathub and opening it, and Shut down. |
| `wm/test-headless.sh` | A quick check of the window manager with the desktop and Chrome, without a virtual machine. |
| `os/test-*.py`, `shell/test/` | Tests for the terminal, network and storage helpers, and for the desktop's terminal, Wi-Fi, saving, program-window code and every Settings page (`node shell/test/settings.js`). |
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

Built from Ubuntu 24.04 LTS packages. Nimbus OS is not affiliated with Canonical, Microsoft, Google, Valve, Discord, Blizzard or Flathub. Google Chrome is Google's software, downloaded from Google under its own terms; Nimbus doesn't include it. Apps in the Store come from Flathub and their developers, under their own licenses; Battle.net, the EA app and Ubisoft Connect are installed by Lutris's install scripts. Virus definitions are ClamAV's (Cisco Talos), downloaded when needed. The fonts Selawik (Microsoft's open-source stand-in for Segoe UI), Figtree, Sora and JetBrains Mono are used under the SIL Open Font License (see `os/fonts`). Settings' icons are Microsoft's Fluent System Icons, under the MIT License (`shell/LICENSE-fluent-icons.txt`, regenerated with `shell/tools/fluent_icons.py`); its category icons are Nimbus's own.
