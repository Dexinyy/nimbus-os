#!/usr/bin/env python3
"""Pick Fluent System Icons (MIT, github.com/microsoft/fluentui-system-icons) for the Nimbus desktop and write
them as a JavaScript table of SVG path data. usage: fluent_icons.py ASSETS_DIR OUT_JS"""
import os, re, sys

ICONS = {
    # navigation and pages
    'home': 'Home', 'system': 'Desktop', 'display': 'Desktop', 'sound': 'Speaker 2', 'soundMute': 'Speaker Mute',
    'speaker0': 'Speaker 0', 'speaker1': 'Speaker 1', 'notifications': 'Alert', 'dnd': 'Alert Off', 'badge': 'Alert Badge',
    'focus': 'Target', 'timer': 'Timer', 'power': 'Power', 'battery': 'Battery 6', 'batterySaver': 'Battery Saver',
    'batteryCharge': 'Battery Charge', 'storage': 'Hard Drive', 'broom': 'Broom', 'multitasking': 'Window Multiple',
    'window': 'Window', 'snap': 'Layout Column Two Split Left', 'tab': 'Tab Desktop', 'handWave': 'Hand Wave',
    'troubleshoot': 'Wrench', 'recovery': 'Arrow Reset', 'clipboard': 'Clipboard', 'about': 'Info', 'info': 'Info',
    'bluetooth': 'Bluetooth', 'bluetoothSearching': 'Bluetooth Searching', 'bluetoothOff': 'Bluetooth Disabled',
    'devices': 'Keyboard Mouse', 'keyboard': 'Keyboard', 'mouse': 'Cursor', 'cursorClick': 'Cursor Click', 'printer': 'Print',
    'scanner': 'Scan', 'camera': 'Camera', 'cameraOff': 'Camera Off', 'usb': 'Usb Stick', 'touchpad': 'Tablet',
    'pen': 'Pen', 'autoplay': 'Play Circle', 'phone': 'Phone', 'headphones': 'Headphones', 'gamepad': 'Games',
    'wifi': 'WiFi 1', 'wifiOff': 'WiFi Off', 'wifiLock': 'WiFi Lock', 'wifiSettings': 'WiFi Settings', 'ethernet': 'Plug Connected',
    'vpn': 'Shield Lock', 'hotspot': 'Router', 'airplane': 'Airplane', 'proxy': 'Globe Desktop', 'network': 'Globe',
    'dataUsage': 'Data Usage', 'adapter': 'Developer Board', 'personalization': 'Paint Brush', 'background': 'Image',
    'colors': 'Color', 'themes': 'Paint Brush', 'lockScreen': 'Lock Closed', 'start': 'Grid', 'taskbar': 'Panel Bottom',
    'fonts': 'Text Font', 'textSize': 'Text Font Size', 'apps': 'Apps', 'installedApps': 'Apps List', 'defaultApps': 'Apps Settings',
    'startup': 'Rocket', 'accounts': 'Person', 'person': 'Person', 'personCircle': 'Person Circle', 'signIn': 'Key',
    'password': 'Password', 'backup': 'Cloud Sync', 'save': 'Save', 'time': 'Clock', 'clock': 'Clock', 'calendar': 'Calendar',
    'language': 'Local Language', 'globeLocation': 'Globe Location', 'typing': 'Keyboard', 'gaming': 'Games',
    'captures': 'Screenshot', 'gameMode': 'Top Speed', 'accessibility': 'Accessibility', 'visualEffects': 'Sparkle',
    'contrast': 'Dark Theme', 'eye': 'Eye', 'privacy': 'Shield', 'shieldCheck': 'Shield Checkmark', 'location': 'Location',
    'mic': 'Mic', 'micOff': 'Mic Off', 'history': 'History', 'search': 'Search', 'diagnostics': 'Pulse', 'update': 'Arrow Sync',
    'updateCheck': 'Arrow Sync Checkmark', 'pause': 'Pause Circle', 'settings': 'Settings', 'brightness': 'Brightness High',
    'brightnessLow': 'Brightness Low', 'night': 'Weather Moon', 'scale': 'Resize', 'resolution': 'Scale Fill', 'rotate': 'Rotate Right',
    'displays': 'Dual Screen', 'graphics': 'Developer Board', 'gauge': 'Gauge', 'sleep': 'Weather Moon', 'screenOff': 'Desktop Off',
    'laptop': 'Laptop', 'leaf': 'Leaf Two', 'delete': 'Delete', 'reset': 'Arrow Counterclockwise', 'restart': 'Arrow Clockwise',
    'pin': 'Pin', 'pinOff': 'Pin Off', 'lock': 'Lock Closed', 'unlock': 'Lock Open', 'star': 'Star', 'checkmark': 'Checkmark',
    'checkCircle': 'Checkmark Circle', 'dismiss': 'Dismiss', 'warning': 'Warning', 'error': 'Error Circle', 'more': 'More Horizontal',
    'open': 'Open', 'add': 'Add', 'edit': 'Edit', 'copy': 'Copy', 'chevronRight': 'Chevron Right', 'chevronDown': 'Chevron Down',
    'chevronUp': 'Chevron Up', 'chevronLeft': 'Chevron Left', 'arrowLeft': 'Arrow Left', 'download': 'Arrow Download',
    'folder': 'Folder', 'document': 'Document', 'music': 'Music Note 2', 'video': 'Video', 'translate': 'Translate',
    'options': 'Options', 'mixer': 'Options Speaker', 'plug': 'Plug Connected', 'shield': 'Shield', 'code': 'Code',
    'developer': 'Code', 'link': 'Link', 'sparkle': 'Sparkle', 'flash': 'Flash', 'drag': 'Arrow Move', 'eyeOff': 'Eye Off',
    'globe': 'Globe', 'cloud': 'Cloud', 'heart': 'Heart', 'filter': 'Filter', 'sort': 'Arrow Sort', 'grid': 'Grid',
    'list': 'Text Bullet List Ltr', 'trophy': 'Trophy', 'pulse': 'Pulse', 'magnifier': 'Zoom In', 'captions': 'Closed Caption',
    'narrator': 'Person Voice', 'external': 'Open', 'people': 'People', 'fingerprint': 'Fingerprint', 'cast': 'Cast',
    'speakerBluetooth': 'Speaker Bluetooth', 'speakerUsb': 'Speaker USB', 'arrowUpload': 'Arrow Upload', 'lightbulb': 'Lightbulb',
    'earth': 'Earth', 'imageMultiple': 'Image Multiple', 'windowApps': 'Window Apps', 'record': 'Record', 'globeClock': 'Globe Clock', 'speech': 'Mic', 'hearing': 'Sound Wave Circle', 'textCursor': 'Text Field', 'colorFilter': 'Color Fill',
    # Store
    'store': 'Shopping Bag', 'library': 'Library', 'games': 'Games', 'cloudOff': 'Cloud Off', 'tag': 'Tag', 'chat': 'Chat',
    'book': 'Book', 'toolbox': 'Toolbox', 'puzzle': 'Puzzle Piece',
    # Security
    'shieldError': 'Shield Error', 'shieldDismiss': 'Shield Dismiss', 'shieldKeyhole': 'Shield Keyhole', 'shieldTask': 'Shield Task',
    'shieldLock': 'Shield Lock', 'shieldProhibited': 'Shield Prohibited', 'heartPulse': 'Heart Pulse', 'windowShield': 'Window Shield',
    'desktopPulse': 'Desktop Pulse', 'bug': 'Bug', 'fire': 'Fire', 'globeShield': 'Globe Shield', 'personLock': 'Person Lock',
    'scan': 'Scan', 'folderSearch': 'Folder Search', 'documentSearch': 'Document Search', 'dismissCircle': 'Dismiss Circle',
    'arrowUndo': 'Arrow Undo', 'hardDrive': 'Hard Drive', 'batteryCheck': 'Battery Checkmark', 'key': 'Key', 'status': 'Status',
    # Game controllers
    'controller': 'Xbox Controller',
}


def snake(name):
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def main():
    assets, out = sys.argv[1], sys.argv[2]
    table, missing = {}, []
    folders = {f.lower(): f for f in os.listdir(assets)}
    for key, name in ICONS.items():
        folder = folders.get(name.lower())
        path = None
        if folder:
            svg = os.path.join(assets, folder, 'SVG')
            for f in sorted(os.listdir(svg)) if os.path.isdir(svg) else []:
                if f.endswith('_20_regular.svg'):
                    path = os.path.join(svg, f)
                    break
        if not path:
            missing.append(f'{key}={name}')
            continue
        svg = open(path).read()
        ds = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
        table[key] = ' '.join(ds)
    if missing:
        print('missing:', ', '.join(missing))
    with open(out, 'w') as f:
        f.write('/* Fluent System Icons, 20px regular, from github.com/microsoft/fluentui-system-icons\n'
                '   Copyright (c) 2020 Microsoft Corporation, MIT License (see shell/LICENSE-fluent-icons.txt).\n'
                '   Generated by tools: name -> SVG path data in a 20x20 box. */\n')
        f.write('const FLUENT = {\n')
        for k, d in table.items():
            f.write(f"  {k}: '{d}',\n")
        f.write('};\n')
        f.write("function fi(name, cls) { const d = FLUENT[name]; return d ? `<svg class=\"fi${cls ? ' ' + cls : ''}\" viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"${d}\"/></svg>` : ''; }\n")
    print(len(table), 'icons,', os.path.getsize(out), 'bytes')


main()
