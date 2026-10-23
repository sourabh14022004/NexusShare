# NexusShare - Cross-Device Mouse & Keyboard Sharing

**NexusShare** is a high-performance, seamless mouse and keyboard sharing application for Windows built with **Electron** and a **Native Win32 Low-Level Hook Engine** (similar to ShareMouse, Synergy, and Mouse Without Borders).

It allows you to control two or more computers seamlessly using a single mouse and keyboard by simply moving your cursor off the edge of one screen onto the next.

---

## ✨ Features

- **⚡ Zero-Lag Native Input Engine**: Powered by a C# Win32 Low-Level Hook (`WH_MOUSE_LL` & `WH_KEYBOARD_LL`) and `SendInput` API for 60–144 FPS smooth cursor gliding and keystroke forwarding.
- **🛰️ Automatic LAN Discovery**: Uses UDP broadcast beacons to automatically discover nearby computers running NexusShare on your Wi-Fi or Ethernet network. No IP typing needed!
- **🔗 Direct IP Connection**: Fallback direct IP:Port connection for users across different subnets, VLANs, or VPNs.
- **🖥️ Interactive Screen Topology**: Visually arrange your monitors (Left, Right, Above, Below) to match your physical desk layout.
- **🔒 Emergency Escape & Hardware Lock**: Press `ScrollLock` or `Pause/Break` anytime to immediately force control back to your local computer.
- **🔐 Password & PIN Protection**: Require a password or 6-digit PIN for incoming connections. Discovered devices display a `🔒 Protected` badge and prompt for authentication before granting access.
- **📁 Cross-Device File Drag & Drop**: Drag and drop any file from Windows Explorer directly onto the Remote Monitor tile, onto the app window, or into the **File Transfer** vault to beam it across devices at high speed. Received files are safely saved in `Downloads/NexusShare` with instant 1-click open options.
- **📋 Shared Clipboard Sync**: Copy text or links on Computer A and paste them instantly on Computer B.
- **🎮 Interactive Sandbox Simulator**: Test screen boundary transitions, coordinate normalization, and cursor handoff directly inside the app without needing a 2nd computer turned on.
- **💎 Cyberpunk Glassmorphic UI**: Ultra-premium dark theme with real-time telemetry (Ping RTT in ms, packet stream rate, active monitor glow).

---

## 🚀 Quick Start

### 1. Requirements
- Windows 10 / 11
- Node.js (v18+)

### 2. Run the App
Clone or copy this folder to both computers, and run:
```bash
npm start
```

*(Optional) If you ever modify the C# native worker code, rebuild it anytime using:*
```bash
npm run build-native
```

---

## 📖 How to Use Across Two Computers

1. **Start NexusShare on Both Computers**:
   - Machine A (e.g. Your Desktop PC)
   - Machine B (e.g. Your Laptop)
2. **Connect**:
   - Go to the **Devices & Discovery** tab. Machine B will show up automatically under **Auto-Discovered LAN Devices**.
   - Click **Connect** (or type Machine B's IP address directly and click Connect).
3. **Arrange Screens**:
   - Go to the **Screen Topology** tab. Choose whether Machine B is on the **Left**, **Right**, **Above**, or **Below** Machine A.
4. **Move the Mouse Across Screens**:
   - Glide your mouse past the chosen edge of Machine A's screen.
   - The cursor will effortlessly glide onto Machine B's screen, and typing will now go to Machine B!
   - To return to Machine A, simply glide the cursor back across the border.

---

## ⚙️ Configuration & Shortcuts

| Action | Shortcut / Setting |
|---|---|
| **Emergency Lock / Unlock** | `ScrollLock` key (or click the lock icon in the top header) |
| **Edge Dwell Delay** | Configurable from `0ms` to `300ms` in Preferences (prevents accidental hops) |
| **Border Sensitivity** | Configurable from `1px` to `15px` threshold |
| **Port** | Default: `48260` (WebSocket) / `48261` (UDP Discovery) |

---

## 🛠️ Architecture

```
[ Primary PC ]                              [ Remote PC ]
  Cursor reaches edge ---> [HookService]
                                |
                         [PeerService] (WebSocket)
                                |
                     ======================= LAN Network
                                |
                         [PeerService]
                                |
                 [InputHookWorker.exe] (SendInput) ---> Moves Cursor & Injects Keys
```
