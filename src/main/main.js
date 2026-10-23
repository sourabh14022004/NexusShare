const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const os = require('os');

const configManager = require('./config');
const HookService = require('./hook-service');
const PeerService = require('./peer-service');
const DiscoveryService = require('./discovery-service');
const ClipboardService = require('./clipboard-service');
const FileTransferService = require('./file-transfer-service');

let mainWindow = null;
let hookService = null;
let peerService = null;
let discoveryService = null;
let clipboardService = null;
let fileTransferService = null;

let isLocked = false;
let activeMachine = 'local'; // 'local' or 'remote'
let edgeHitTimer = null;
let lastEdgeHitTime = 0;

function createWindow() {
  const cfg = configManager.get();

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#0a0d14',
    title: 'NexusShare - Seamless Cross-Device Mouse & Keyboard Sharing',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getLocalIpAddresses() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if ('IPv4' === iface.family && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function getOppositeEdge(edge) {
  if (edge === 'right') return 'left';
  if (edge === 'left') return 'right';
  if (edge === 'top') return 'bottom';
  if (edge === 'bottom') return 'top';
  return 'left';
}

function setupServices() {
  const cfg = configManager.get();
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenMetrics = {
    left: primaryDisplay.bounds.x,
    top: primaryDisplay.bounds.y,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height
  };

  // 1. Hook Service
  hookService = new HookService();
  hookService.start();

  hookService.on('ready', (nativeScreen) => {
    console.log('Native Hook Service Ready. Screen:', nativeScreen);
    if (nativeScreen && nativeScreen.width > 0) {
      screenMetrics.width = nativeScreen.width;
      screenMetrics.height = nativeScreen.height;
      if (peerService) peerService.setScreen(screenMetrics);
      if (discoveryService) discoveryService.setScreen(screenMetrics);
    }
    // Set configured active edge
    hookService.setEdge(cfg.screenLayout.relativePosition, cfg.screenLayout.edgeThreshold);
  });

  // Handle local edge crossing
  hookService.on('edge-hit', (data) => {
    if (isLocked) return;
    if (activeMachine === 'remote') return;

    if (!peerService || !peerService.isConnected()) {
      // In sandbox mode, allow simulating transition without a physical peer
      if (cfg.sandboxMode) {
        simulateSandboxTransition('out');
      }
      return;
    }

    const now = Date.now();
    const switchDelay = cfg.screenLayout.edgeSwitchDelay || 80;

    if (now - lastEdgeHitTime < switchDelay) {
      return; // Still waiting for edge dwell duration
    }
    lastEdgeHitTime = now;

    // Calculate ratio across the edge
    let ratio = 0.5;
    if (data.edge === 'left' || data.edge === 'right') {
      ratio = (data.y - screenMetrics.top) / screenMetrics.height;
    } else {
      ratio = (data.x - screenMetrics.left) / screenMetrics.width;
    }
    ratio = Math.max(0, Math.min(1, ratio));

    const targetEntryEdge = getOppositeEdge(data.edge);

    // Switch to redirected mode
    activeMachine = 'remote';
    hookService.setMode('redirect');
    peerService.sendControlTake(targetEntryEdge, ratio);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', {
        activeMachine: 'remote',
        peer: peerService.remotePeer
      });
    }
  });

  // Stream mouse & keyboard while redirected
  hookService.on('mouse-move', (data) => {
    if (activeMachine === 'remote' && peerService && peerService.isConnected()) {
      peerService.sendInput({ t: 'm', dx: data.dx, dy: data.dy });
    }
  });

  hookService.on('mouse-button', (data) => {
    if (activeMachine === 'remote' && peerService && peerService.isConnected()) {
      peerService.sendInput({ t: 'b', b: data.button, d: data.down });
    }
  });

  hookService.on('mouse-wheel', (data) => {
    if (activeMachine === 'remote' && peerService && peerService.isConnected()) {
      peerService.sendInput({ t: 'w', d: data.delta, h: data.horizontal });
    }
  });

  hookService.on('key', (data) => {
    if (activeMachine === 'remote' && peerService && peerService.isConnected()) {
      peerService.sendInput({ t: 'k', vk: data.vk, scan: data.scan, d: data.down, ext: data.extended });
    }
  });

  hookService.on('emergency-unlock', () => {
    activeMachine = 'local';
    isLocked = false;
    hookService.setMode('local');
    hookService.setLock(false);
    if (peerService && peerService.isConnected()) {
      peerService.sendControlRelease('local', 0.5);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('emergency-unlock', { message: 'Emergency unlock triggered! Restored local control.' });
      mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
    }
  });

  // 2. Peer Service (WebSocket Network Layer)
  peerService = new PeerService({
    port: cfg.port,
    deviceName: cfg.deviceName,
    requirePassword: cfg.requirePassword,
    password: cfg.password || cfg.secretKey,
    screen: screenMetrics
  });
  peerService.startServer();

  peerService.on('state-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-state', data);
    }
    if (data.state === 'disconnected') {
      activeMachine = 'local';
      hookService.setMode('local');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
      }
    }
  });

  peerService.on('telemetry', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('telemetry', data);
    }
  });

  // Received control take from remote machine (Remote machine is pushing cursor into our screen!)
  peerService.on('remote-control-take', (data) => {
    activeMachine = 'remote_controlling_us';

    let targetX = screenMetrics.left + Math.round(screenMetrics.width / 2);
    let targetY = screenMetrics.top + Math.round(screenMetrics.height / 2);

    if (data.entryEdge === 'left') {
      targetX = screenMetrics.left + 5;
      targetY = screenMetrics.top + Math.round((data.ratio || 0.5) * screenMetrics.height);
    } else if (data.entryEdge === 'right') {
      targetX = screenMetrics.left + screenMetrics.width - 5;
      targetY = screenMetrics.top + Math.round((data.ratio || 0.5) * screenMetrics.height);
    } else if (data.entryEdge === 'top') {
      targetX = screenMetrics.left + Math.round((data.ratio || 0.5) * screenMetrics.width);
      targetY = screenMetrics.top + 5;
    } else if (data.entryEdge === 'bottom') {
      targetX = screenMetrics.left + Math.round((data.ratio || 0.5) * screenMetrics.width);
      targetY = screenMetrics.top + screenMetrics.height - 5;
    }

    hookService.injectMousePos(targetX, targetY);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', {
        activeMachine: 'remote_controlling_us',
        peer: peerService.remotePeer
      });
    }
  });

  // Injected cursor moving on our screen: if it moves back to the entry edge, return control!
  let currentInjectedX = -1;
  let currentInjectedY = -1;

  peerService.on('remote-input', (input) => {
    if (input.t === 'm') {
      hookService.injectMouseDelta(input.dx, input.dy);
    } else if (input.t === 'b') {
      hookService.injectMouseButton(input.b, input.d);
    } else if (input.t === 'w') {
      hookService.injectMouseWheel(input.d, input.h);
    } else if (input.t === 'k') {
      hookService.injectKey(input.vk, input.scan, input.d, input.ext);
    }
  });

  // Remote returned control back to us
  peerService.on('remote-control-release', (data) => {
    activeMachine = 'local';
    hookService.setMode('local');

    // Park cursor back near the edge
    let returnX = screenMetrics.left + screenMetrics.width - 10;
    let returnY = screenMetrics.top + Math.round((data.ratio || 0.5) * screenMetrics.height);

    if (cfg.screenLayout.relativePosition === 'left') {
      returnX = screenMetrics.left + 10;
    } else if (cfg.screenLayout.relativePosition === 'top') {
      returnX = screenMetrics.left + Math.round((data.ratio || 0.5) * screenMetrics.width);
      returnY = screenMetrics.top + 10;
    } else if (cfg.screenLayout.relativePosition === 'bottom') {
      returnX = screenMetrics.left + Math.round((data.ratio || 0.5) * screenMetrics.width);
      returnY = screenMetrics.top + screenMetrics.height - 10;
    }

    hookService.injectMousePos(returnX, returnY);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
    }
  });

  // 3. Discovery Service (LAN UDP Broadcast)
  discoveryService = new DiscoveryService({
    port: cfg.port,
    discoveryPort: cfg.discoveryPort,
    deviceName: cfg.deviceName,
    requirePassword: cfg.requirePassword
  });
  discoveryService.setScreen(screenMetrics);
  discoveryService.start();

  discoveryService.on('peer-discovered', (peer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peer-discovered', peer);
    }
  });

  discoveryService.on('peer-lost', (peer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peer-lost', peer);
    }
  });

  // 4. Clipboard Service
  clipboardService = new ClipboardService();
  clipboardService.setEnabled(cfg.syncClipboard);
  clipboardService.start();

  clipboardService.on('clipboard-changed', (clipData) => {
    if (peerService && peerService.isConnected()) {
      peerService.sendClipboard(clipData.kind, clipData.data);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard-event', { action: 'sent', kind: clipData.kind });
      }
    }
  });

  peerService.on('remote-clipboard', (msg) => {
    clipboardService.applyRemoteClipboard(msg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-event', { action: 'received', kind: msg.kind });
    }
  });

  // 5. File Transfer Service (Cross-Device Drag & Drop)
  fileTransferService = new FileTransferService(peerService);

  peerService.on('file-message', (msg) => {
    fileTransferService.handlePeerMessage(msg);
  });

  fileTransferService.on('transfer-progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-progress', data);
    }
  });

  fileTransferService.on('transfer-complete', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-complete', data);
    }
  });

  fileTransferService.on('transfer-cancelled', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-cancelled', data);
    }
  });
}

function simulateSandboxTransition(direction) {
  if (direction === 'out') {
    activeMachine = 'remote';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', {
        activeMachine: 'remote',
        peer: { name: 'Virtual Screen B', ip: '127.0.0.1' }
      });
    }
  } else {
    activeMachine = 'local';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
    }
  }
}

// IPC Handlers
ipcMain.handle('get-config', () => {
  return configManager.get();
});

ipcMain.handle('save-config', (e, newCfg) => {
  const updated = configManager.save(newCfg);
  const cfg = configManager.get();

  if (hookService) {
    hookService.setEdge(cfg.screenLayout.relativePosition, cfg.screenLayout.edgeThreshold);
  }
  if (clipboardService) {
    clipboardService.setEnabled(cfg.syncClipboard);
  }
  if (discoveryService) {
    discoveryService.setDeviceName(cfg.deviceName);
    discoveryService.setPasswordProtected(cfg.requirePassword);
  }
  if (peerService) {
    peerService.setDeviceName(cfg.deviceName);
    peerService.setPasswordSettings(cfg.requirePassword, cfg.password || cfg.secretKey);
  }
  return updated;
});

ipcMain.handle('get-system-info', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    ips: getLocalIpAddresses(),
    screen: {
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      scaleFactor: primaryDisplay.scaleFactor
    }
  };
});

ipcMain.handle('connect-peer', (e, { ip, port, password }) => {
  if (peerService) {
    peerService.connectTo(ip, port || 48260, password || '');
    configManager.save({ lastConnectedIp: ip, lastConnectedPort: port || 48260 });
    return true;
  }
  return false;
});

ipcMain.handle('disconnect-peer', () => {
  if (peerService) {
    peerService.disconnect();
    return true;
  }
  return false;
});

ipcMain.handle('get-discovered-peers', () => {
  return discoveryService ? discoveryService.getDiscoveredPeers() : [];
});

ipcMain.handle('toggle-lock', (e, locked) => {
  isLocked = !!locked;
  if (hookService) {
    hookService.setLock(isLocked);
    if (isLocked && activeMachine === 'remote') {
      activeMachine = 'local';
      hookService.setMode('local');
      if (peerService && peerService.isConnected()) {
        peerService.sendControlRelease('local', 0.5);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
      }
    }
  }
  return isLocked;
});

ipcMain.handle('switch-active-machine', (e, target) => {
  if (target === 'remote' && peerService && peerService.isConnected()) {
    activeMachine = 'remote';
    hookService.setMode('redirect');
    peerService.sendControlTake('left', 0.5);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', { activeMachine: 'remote', peer: peerService.remotePeer });
    }
  } else {
    activeMachine = 'local';
    hookService.setMode('local');
    if (peerService && peerService.isConnected()) {
      peerService.sendControlRelease('local', 0.5);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('control-changed', { activeMachine: 'local' });
    }
  }
  return activeMachine;
});

ipcMain.handle('set-screen-layout', (e, layout) => {
  const cfg = configManager.get();
  cfg.screenLayout = { ...cfg.screenLayout, ...layout };
  configManager.save({ screenLayout: cfg.screenLayout });
  if (hookService) {
    hookService.setEdge(cfg.screenLayout.relativePosition, cfg.screenLayout.edgeThreshold);
  }
  return cfg.screenLayout;
});

ipcMain.handle('trigger-sandbox-hop', (e, direction) => {
  simulateSandboxTransition(direction);
  return activeMachine;
});

// File Transfer IPC Handlers
ipcMain.handle('send-files', async (e, filePaths) => {
  if (!fileTransferService || !peerService || !peerService.isConnected()) {
    return { success: false, error: 'Not connected to remote device.' };
  }
  const results = [];
  for (const fp of filePaths) {
    try {
      const res = await fileTransferService.sendFile(fp);
      results.push(res);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: true, count: results.length, results };
});

ipcMain.handle('get-received-files', () => {
  return fileTransferService ? fileTransferService.getReceivedFiles() : [];
});

ipcMain.handle('open-received-file', (e, filePath) => {
  return shell.openPath(filePath);
});

ipcMain.handle('show-in-folder', (e, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('get-save-dir', () => {
  return fileTransferService ? fileTransferService.getSaveDir() : '';
});

ipcMain.handle('open-save-dir', () => {
  if (fileTransferService) {
    shell.openPath(fileTransferService.getSaveDir());
    return true;
  }
  return false;
});

// App Lifecycle
app.whenReady().then(() => {
  setupServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (hookService) hookService.stop();
  if (peerService) peerService.stop();
  if (discoveryService) discoveryService.stop();
  if (clipboardService) clipboardService.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (hookService) hookService.stop();
  if (peerService) peerService.stop();
  if (discoveryService) discoveryService.stop();
  if (clipboardService) clipboardService.stop();
});
