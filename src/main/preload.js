const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config & State
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Networking & Connection
  connectPeer: (ip, port, password) => ipcRenderer.invoke('connect-peer', { ip, port, password }),
  disconnectPeer: () => ipcRenderer.invoke('disconnect-peer'),
  getDiscoveredPeers: () => ipcRenderer.invoke('get-discovered-peers'),

  // Control Actions
  toggleLock: (locked) => ipcRenderer.invoke('toggle-lock', locked),
  switchActiveMachine: (target) => ipcRenderer.invoke('switch-active-machine', target),
  setScreenLayout: (layout) => ipcRenderer.invoke('set-screen-layout', layout),

  // Simulation
  triggerSandboxHop: (direction) => ipcRenderer.invoke('trigger-sandbox-hop', direction),

  // File Transfer (Cross-Device Drag & Drop)
  sendFiles: (filePaths) => ipcRenderer.invoke('send-files', filePaths),
  getReceivedFiles: () => ipcRenderer.invoke('get-received-files'),
  openReceivedFile: (filePath) => ipcRenderer.invoke('open-received-file', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  getSaveDir: () => ipcRenderer.invoke('get-save-dir'),
  openSaveDir: () => ipcRenderer.invoke('open-save-dir'),

  // File Transfer Event Listeners
  onFileProgress: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('file-progress', handler);
    return () => ipcRenderer.removeListener('file-progress', handler);
  },
  onFileComplete: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('file-complete', handler);
    return () => ipcRenderer.removeListener('file-complete', handler);
  },
  onFileCancelled: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('file-cancelled', handler);
    return () => ipcRenderer.removeListener('file-cancelled', handler);
  },

  // Event Listeners
  onConnectionState: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('connection-state', handler);
    return () => ipcRenderer.removeListener('connection-state', handler);
  },
  onDiscoveredPeer: (callback) => {
    const handler = (e, peer) => callback(peer);
    ipcRenderer.on('peer-discovered', handler);
    return () => ipcRenderer.removeListener('peer-discovered', handler);
  },
  onPeerLost: (callback) => {
    const handler = (e, peer) => callback(peer);
    ipcRenderer.on('peer-lost', handler);
    return () => ipcRenderer.removeListener('peer-lost', handler);
  },
  onControlChanged: (callback) => {
    const handler = (e, state) => callback(state);
    ipcRenderer.on('control-changed', handler);
    return () => ipcRenderer.removeListener('control-changed', handler);
  },
  onTelemetry: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('telemetry', handler);
    return () => ipcRenderer.removeListener('telemetry', handler);
  },
  onClipboardEvent: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('clipboard-event', handler);
    return () => ipcRenderer.removeListener('clipboard-event', handler);
  },
  onEmergencyUnlock: (callback) => {
    const handler = (e, data) => callback(data);
    ipcRenderer.on('emergency-unlock', handler);
    return () => ipcRenderer.removeListener('emergency-unlock', handler);
  },
  onLog: (callback) => {
    const handler = (e, log) => callback(log);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  }
});
