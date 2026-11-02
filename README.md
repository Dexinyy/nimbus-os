# Nimbus OS

Your own desktop operating system, inspired by Windows 11, without ads, without an account to create, and with a taskbar you can move. It runs on Linux, built from Ubuntu 24.04 LTS packages.

**Version 0.1, first milestone:** the computer starts straight into the Nimbus desktop, from a USB stick or in a virtual machine.

## Try it

Download `nimbus-os-0.1-amd64.iso` from the [latest release](../../releases/tag/latest).

### In a virtual machine (easiest)

1. Install [VirtualBox](https://www.virtualbox.org/) (free).
2. Click **New**. Name it Nimbus OS, pick the ISO file, set the type to **Linux** and the version to **Ubuntu (64-bit)**, and tick **Skip Unattended Installation**.
3. Give it **4096 MB** of memory and 2 processors. It doesn't need a hard disk.
4. In **Settings → Display**, choose the **VMSVGA** graphics controller.
5. Click **Start**. The desktop appears in about 30 seconds.

### On a real PC

1. Write the ISO to a USB stick with [balenaEtcher](https://etcher.balena.io/) or [Rufus](https://rufus.ie/). In Rufus, pick **DD image** mode when it asks.
2. Restart the PC and open its boot menu (usually **F12**, **F11**, **F8** or **Esc** while it starts). Choose the USB stick.
3. **Secure Boot must be turned off** in your PC's firmware settings for now.

Nothing gets installed and your drive isn't touched. When you shut down, the live session is gone.

If the screen stays black, pick **Start Nimbus OS with basic graphics** in the boot menu.

Every build is started in virtual machines (UEFI and BIOS) before it's published. The test opens Start, Terminal and Settings, switches windows with Alt+Tab and shuts down from the keyboard. The screenshots are on the [`ci-results`](../../tree/ci-results) branch.

## What works in 0.1

- Starts on UEFI and older BIOS PCs, from USB or disc
- The full Nimbus desktop: windows, snap layouts, Task View, Start and search, quick settings, notifications
- Apps: Files, Notes, Paint, Photos, Calculator, Terminal, Clock, Mines, Task Manager, Settings
- **Shut down, Restart and Sleep** control the real computer
- **Settings → About** shows your real hardware, and you can set the **time zone**
- Keyboard: **Windows key** opens Start, **Alt+Tab** switches windows, **Alt+F4** closes a window or offers to shut down. Win+E opens Files, Win+I opens Settings, Win+D shows the desktop, Win+L locks, and Win+arrow keys snap the active window.
- Wired internet connects automatically, and the clock sets itself
- A text console for the curious: **Ctrl+Alt+F2**, user `nimbus`, no password. **Ctrl+Alt+F1** goes back to the desktop.

## Not yet

- Installing to a drive, so nothing you do is kept after shutdown
- Wi-Fi, Bluetooth, sound volume, display settings
- Running other programs such as a web browser or Steam. The Terminal app is Nimbus's own; a real Linux shell in a window comes with milestone 2.
- Opening files from your own drives
- Secure Boot

## Roadmap

1. ✅ Starts into the Nimbus desktop (0.1)
2. Real programs (a web browser, for example) open as Nimbus windows with snapping and the taskbar
3. Settings controls Wi-Fi, Bluetooth, sound and displays, and Files opens your real drives
4. An installer
5. Polish on real hardware, and Secure Boot

## How it fits together

| Part | What it does |
|---|---|
| `shell/` | The desktop itself (HTML, CSS and JavaScript). `python3 shell/build.py` builds the web version; `--native DIR` builds the version for the OS. |
| `os/overlay/usr/bin/nimbus-shell` | Shows the desktop full screen with WebKitGTK and gives it a few system abilities: power, hardware info, time zone. |
| `os/overlay/usr/bin/nimbus-session` and `nimbus-session.service` | Start the desktop on the screen at boot, using the cage Wayland compositor. |
| `os/build-iso.sh` | Builds the bootable ISO from Ubuntu 24.04 packages. |
| `os/test-boot.sh`, `os/qmp.py` | Boot the ISO in virtual machines (UEFI and BIOS), take screenshots, try the desktop, and check that Shut down powers off. |
| `.github/workflows/build.yml` | Builds and tests on every push to `main`. It publishes the ISO as the **latest** release and saves test screenshots to the `ci-results` branch. |

## Troubleshooting

Add `nimbus.debug` to the kernel command line (press **e** on the boot menu entry) to log the desktop's keyboard, focus and Wayland messages. Read them on a text console with `journalctl -b -u nimbus-session`.

## Build it yourself

On Ubuntu 24.04:

```sh
sudo apt-get install debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub-common mtools dosfstools qemu-system-x86 ovmf python3-pil
sudo ./build.sh                                   # writes out/nimbus-os-0.1-amd64.iso
./os/test-boot.sh out/nimbus-os-0.1-amd64.iso     # optional boot test with screenshots in out/ci
```

## Credits

Built from Ubuntu 24.04 LTS packages. Nimbus OS is not affiliated with Canonical or Microsoft. The fonts Figtree, Sora and JetBrains Mono are used under the SIL Open Font License (see `os/fonts`).
