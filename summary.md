## Boot test

Image: nimbus-os-0.1-amd64.iso (900 MB)

### uefi
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ The first Windows key press opens Start (11% of the screen changed)
- ✅ Shut down turns the computer off

### bios
- ✅ Starts to the Nimbus desktop (39 s)
- ✅ Shut down turns the computer off

### usb-bios
- ✅ Starts to the Nimbus desktop (39 s)
- ✅ Shut down turns the computer off

### usb-uefi
- ✅ Starts to the Nimbus desktop (45 s)
- ✅ Shut down turns the computer off

### logs
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ The first Windows key press opens Start (11% of the screen changed)
- ✅ Shut down turns the computer off

### wifi
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ Joins a Wi-Fi network with its password
- ✅ Settings shows the network it joined (NimbusTestAP)
- ✅ Shut down turns the computer off

### usb
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ Saves by itself from the first start
- ✅ A setting survives a restart
- ✅ Shut down turns the computer off

### disk
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ Sets up saving on the empty disk
- ✅ Starts with saving on after a restart
- ✅ A setting survives a restart
- ✅ Shut down turns the computer off

### settings
- ✅ Starts to the Nimbus desktop (37 s)
- ✅ Sound plays through PipeWire (1 output(s), default Line Out)
- ✅ Settings changes the real volume (37)
- ✅ Settings lists the display's resolutions (Virtual-1 1440x900, 21 modes)
- ✅ Settings changes the resolution (1920x1440)
- ✅ ...and puts it back (1440x900)
- ✅ Settings sees the keyboard and pointer (1 keyboard(s), 3 pointer(s))
- ✅ Power modes answer (power-saver,balanced active=balanced)
- ✅ The printing service runs (ready)
- ✅ Storage is measured (1.9 GB total)
- ✅ Every Settings page opens (all pages: 84 opened, 0 failed)
- ✅ The Settings test finished

### chrome
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ Installs Google Chrome from Google (26 s, version 156.0.8078.79)
- ✅ Chrome opens as a window on the desktop (Nimbus test page - Google Chrome)
- ✅ Chrome shows a web page (Nimbus test page - Google Chrome)
- ✅ Chrome maximizes through the desktop (1440x852)
- ✅ The Windows key opens Start over Chrome (34% of the screen changed)
- ✅ A Nimbus window opens over Chrome (51% of the screen changed)
- ✅ Alt+Tab brings Chrome back to the front (0% differs from Chrome before)
- ✅ Typing goes to Chrome (87% of the screen changed)
- ✅ Alt+F4 closes Chrome
- ✅ Shut down turns the computer off

### security
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ ClamAV and the test signature are ready (engine 1.5.4 definitions test (1 signatures) realtime true)
- ✅ The firewall is on (firewall active network public)
- ✅ Real-time protection quarantines a threat in a new download (realtime found 1 Nimbus.Test.EICAR.UNOFFICIAL and quarantined it)
- ✅ A quick scan finds a threat (quick scan done: 3 files, 1 threats)
- ✅ Start actions quarantines it (start actions: 1 quarantined, 0 still active, 2 in quarantine)
- ✅ Protection history: remove and restore (history 3 items, allowed 1, quarantine 0)
- ✅ Blocking all incoming connections works (firewall block public true active true)
- ✅ ...and unblocking (firewall unblock public true)
- ✅ A Private network allows Steam Remote Play (firewall network Wired connection 1 now private, steam remote play allowed true)
- ✅ Device security is read (device secure boot n/a, tpm none, lockdown none, mitigations 2/5)
- ✅ A PlayStation controller is detected (controller Nimbus Test DualSense: DualSense (playstation) over USB)
- ✅ Its button presses reach Settings (controller input: Cross pressed, left stick x 1)
- ✅ The Security test finished (done)

### store
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ Flatpak and Flathub are ready (flatpak true flathub false libflatpak true)
- ✅ The Store downloads Flathub's catalog (catalog 3392 apps in 8 s)
- ✅ Search finds Discord (search discord: com.discordapp.Discord)
- ✅ Search finds Steam (search steam: com.valvesoftware.Steam)
- ✅ Discord's page has its details (details Discord by Discord Inc.: 252 MB to download, 4 permissions, 2 screenshots)
- ✅ The Store installs Discord (installed in 21 s; Start has fp:com.discordapp.Discord)
- ✅ Discord opens as a window with its taskbar button (window Discord Updater (Wayland) on the taskbar as fp:com.discordapp.Discord)
- ✅ Updates can be checked (updates waiting: 0)
- ✅ The Store test finished (done)

### update
- ✅ Starts to the Nimbus desktop (36 s)
- ✅ The ISO's files match the list it keeps of them (build 4ae2d24, 59 of 59 files)
- ✅ Finds a newer build on the update server (build 7e57d24, 0.8 MB to download, 1 package to add)
- ✅ Downloads and installs it from Settings (16 s, 3 files changed, added hello, 0 warnings)
- ✅ Starts the new build after a restart (build 7e57d24)
- ✅ Every file is the new build's (59 of 59)
- ✅ The package it needs is installed (hello)
- ✅ Its one-off setup step ran
- ✅ A file it adds is there and one it drops is gone
- ✅ Settings says it's up to date (You’re up to date)
- ✅ Recovery offers going back (build 4ae2d24)
- ✅ Goes back from Recovery (went back, Nimbus OS 0.1 (build 4ae2d24) waits for a restart)
- ✅ Starts the earlier build after a restart (build 4ae2d24, 59 of 59 files as before)
- ✅ The Update test finished (done)
