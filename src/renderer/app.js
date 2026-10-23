// ==========================================================================
// NexusShare Renderer Controller
// ==========================================================================

class NexusApp {
  constructor() {
    this.config = null;
    this.systemInfo = null;
    this.activeMachine = 'local';
    this.isLocked = false;
    this.connectionState = 'disconnected';
    this.connectedPeer = null;
    this.audioCtx = null;
    this.sandboxActive = false;

    this.initElements();
    this.bindEvents();
    this.initAudio();
    this.loadInitialData();
  }

  initElements() {
    // Header
    this.elActiveMachinePill = document.getElementById('active-machine-pill');
    this.elActiveMachineName = document.getElementById('active-machine-name');
    this.elBtnToggleLock = document.getElementById('btn-toggle-lock');
    this.elLockBtnText = document.getElementById('lock-btn-text');
    this.elHeaderSecurityBadge = document.getElementById('header-security-badge');
    this.elHeaderSecurityText = document.getElementById('header-security-text');
    this.elNetStatusBadge = document.getElementById('net-status-badge');
    this.elNetStatusText = document.getElementById('net-status-text');

    // Navigation
    this.navTabs = document.querySelectorAll('.nav-tab');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    this.elDiscoveryCount = document.getElementById('discovery-count');

    // Topology
    this.elTopologyCanvas = document.getElementById('topology-canvas');
    this.elMonitorLocal = document.getElementById('monitor-local');
    this.elMonitorLocalName = document.getElementById('monitor-local-name');
    this.elMonitorLocalRes = document.getElementById('monitor-local-res');
    this.elMonitorRemote = document.getElementById('monitor-remote');
    this.elMonitorRemoteName = document.getElementById('monitor-remote-name');
    this.elMonitorRemoteRes = document.getElementById('monitor-remote-res');
    this.layoutButtons = document.querySelectorAll('.btn-layout');
    this.elBtnManualSwitch = document.getElementById('btn-manual-switch');

    // Telemetry
    this.elTelemetryLatency = document.getElementById('telemetry-latency');
    this.elTelemetryPps = document.getElementById('telemetry-pps');
    this.elTelemetryClipboard = document.getElementById('telemetry-clipboard-sub');
    this.elTelemetryEdge = document.getElementById('telemetry-edge');
    this.elTelemetryEdgeSub = document.getElementById('telemetry-edge-sub');

    // Devices & Direct Connect
    this.elDiscoveredList = document.getElementById('discovered-list');
    this.elEmptyDiscovery = document.getElementById('empty-discovery');
    this.formDirectConnect = document.getElementById('form-direct-connect');
    this.elInputTargetIp = document.getElementById('input-target-ip');
    this.elInputTargetPort = document.getElementById('input-target-port');
    this.elInputTargetPassword = document.getElementById('input-target-password');
    this.elBtnToggleTargetPass = document.getElementById('btn-toggle-target-pass');
    this.elBtnConnect = document.getElementById('btn-connect');
    this.elBtnDisconnect = document.getElementById('btn-disconnect');
    this.elMyDeviceName = document.getElementById('my-device-name');
    this.elMyLocalIps = document.getElementById('my-local-ips');
    this.elMyLocalPort = document.getElementById('my-local-port');

    // Sandbox
    this.elBtnSandboxToggle = document.getElementById('btn-sandbox-toggle');
    this.elSandboxStateText = document.getElementById('sandbox-state-text');
    this.elVirtualScreenA = document.getElementById('virtual-screen-a');
    this.elVirtualScreenB = document.getElementById('virtual-screen-b');
    this.elCanvasAreaA = document.getElementById('canvas-area-a');
    this.elCanvasAreaB = document.getElementById('canvas-area-b');
    this.elVcursorA = document.getElementById('vcursor-a');
    this.elVcursorB = document.getElementById('vcursor-b');
    this.elSbCoords = document.getElementById('sb-coords');
    this.elSbFocus = document.getElementById('sb-focus');
    this.elSbTransitionEvent = document.getElementById('sb-transition-event');

    // Preferences
    this.prefSwitchDelay = document.getElementById('pref-switch-delay');
    this.prefSwitchDelayVal = document.getElementById('pref-switch-delay-val');
    this.prefEdgeThreshold = document.getElementById('pref-edge-threshold');
    this.prefEdgeThresholdVal = document.getElementById('pref-edge-threshold-val');
    this.prefSyncClipboard = document.getElementById('pref-sync-clipboard');
    this.prefSoundEffects = document.getElementById('pref-sound-effects');
    this.prefEmergencyKey = document.getElementById('pref-emergency-key');
    this.prefDeviceName = document.getElementById('pref-device-name');
    this.prefRequirePassword = document.getElementById('pref-require-password');
    this.rowPrefPassword = document.getElementById('row-pref-password');
    this.prefPassword = document.getElementById('pref-password');
    this.btnTogglePrefPass = document.getElementById('btn-toggle-pref-pass');
    this.btnGenPin = document.getElementById('btn-gen-pin');
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.saveSettingsIndicator = document.getElementById('save-settings-indicator');

    // Password Modal
    this.elModalPassword = document.getElementById('modal-password');
    this.elModalDeviceTitle = document.getElementById('modal-device-title');
    this.elModalDeviceSubtitle = document.getElementById('modal-device-subtitle');
    this.elInputModalPassword = document.getElementById('input-modal-password');
    this.elBtnToggleModalPass = document.getElementById('btn-toggle-modal-pass');
    this.elModalAuthError = document.getElementById('modal-auth-error');
    this.elBtnModalCancel = document.getElementById('btn-modal-cancel');
    this.elBtnModalSubmit = document.getElementById('btn-modal-submit');
    this.pendingConnectPeer = null;

    // File Transfer Elements
    this.elTransfersActiveBadge = document.getElementById('transfers-active-badge');
    this.elMonitorDropOverlay = document.getElementById('monitor-drop-overlay');
    this.elFileDropZone = document.getElementById('file-drop-zone');
    this.elFileInputPicker = document.getElementById('file-input-picker');
    this.elBtnBrowseFilePicker = document.getElementById('btn-browse-file-picker');
    this.elFileTargetNotice = document.getElementById('file-target-notice');
    this.elActiveTransfersList = document.getElementById('active-transfers-list');
    this.elEmptyTransfers = document.getElementById('empty-transfers');
    this.elReceivedFilesList = document.getElementById('received-files-list');
    this.elEmptyReceived = document.getElementById('empty-received');
    this.elBtnOpenDownloadsDir = document.getElementById('btn-open-downloads-dir');
    this.elBtnRefreshReceived = document.getElementById('btn-refresh-received');
    this.elWindowDragOverlay = document.getElementById('window-drag-overlay');
    this.elWindowDragTargetName = document.getElementById('window-drag-target-name');
    this.activeTransfers = new Map();

    // Footer
    this.elLatestLog = document.getElementById('latest-log');
  }

  initAudio() {
    // Pure Web Audio synthesized acoustic chime for seamless sound feedback
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  playChime(type = 'hop') {
    if (!this.config || !this.config.soundEffects || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'hop') {
        // High-tech subtle whoosh/hop
        osc.type = 'sine';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'lock') {
        // Subtle click/thud
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.06);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch (e) {}
  }

  async loadInitialData() {
    try {
      // 1. Load Config
      this.config = await window.api.getConfig();
      this.populateSettings();

      // 2. Load System Info
      this.systemInfo = await window.api.getSystemInfo();
      this.populateSystemInfo();

      // 3. Set Topology view according to config
      this.updateTopologyOrientation(this.config.screenLayout.relativePosition);

      // 4. Poll / Load Discovered Peers
      const peers = await window.api.getDiscoveredPeers();
      this.renderDiscoveredPeers(peers);

      // 5. Load Received Files
      this.loadReceivedFiles();

      this.log('NexusShare ready. Monitoring edge boundaries and network beacons.');
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  }

  populateSystemInfo() {
    if (!this.systemInfo) return;

    this.elMonitorLocalName.textContent = this.systemInfo.hostname || 'Primary PC';
    if (this.systemInfo.screen) {
      this.elMonitorLocalRes.textContent = `${this.systemInfo.screen.width} × ${this.systemInfo.screen.height}`;
    }

    this.elMyDeviceName.textContent = this.systemInfo.hostname || 'My-PC';
    if (this.systemInfo.ips && this.systemInfo.ips.length > 0) {
      this.elMyLocalIps.textContent = this.systemInfo.ips.map(i => i.address).join(', ');
      // Pre-fill target IP hint if available
      if (!this.elInputTargetIp.value && this.config.lastConnectedIp) {
        this.elInputTargetIp.value = this.config.lastConnectedIp;
      }
    } else {
      this.elMyLocalIps.textContent = '127.0.0.1';
    }

    this.elMyLocalPort.textContent = this.config.port || '48260';
  }

  populateSettings() {
    if (!this.config) return;

    this.prefSwitchDelay.value = this.config.screenLayout.edgeSwitchDelay || 80;
    this.prefSwitchDelayVal.textContent = `${this.prefSwitchDelay.value} ms`;

    this.prefEdgeThreshold.value = this.config.screenLayout.edgeThreshold || 3;
    this.prefEdgeThresholdVal.textContent = `${this.prefEdgeThreshold.value} px`;

    this.prefSyncClipboard.checked = !!this.config.syncClipboard;
    this.prefSoundEffects.checked = !!this.config.soundEffects;
    this.prefEmergencyKey.value = this.config.emergencyKey || 'ScrollLock';
    this.prefDeviceName.value = this.config.deviceName || '';

    this.prefRequirePassword.checked = !!this.config.requirePassword;
    this.prefPassword.value = this.config.password || this.config.secretKey || '';
    this.rowPrefPassword.style.display = this.config.requirePassword ? 'flex' : 'none';

    this.updateSecurityHeaderUI(this.config.requirePassword);
    this.updateTelemetryEdgeInfo();
  }

  updateSecurityHeaderUI(isProtected) {
    if (isProtected) {
      this.elHeaderSecurityBadge.className = 'header-pill pill-security protected';
      this.elHeaderSecurityBadge.querySelector('.sec-icon').textContent = '🔒';
      this.elHeaderSecurityText.textContent = 'Protected';
    } else {
      this.elHeaderSecurityBadge.className = 'header-pill pill-security unprotected';
      this.elHeaderSecurityBadge.querySelector('.sec-icon').textContent = '🔓';
      this.elHeaderSecurityText.textContent = 'Open';
    }
  }

  updateTelemetryEdgeInfo() {
    const pos = this.config.screenLayout.relativePosition;
    const posLabel = pos.charAt(0).toUpperCase() + pos.slice(1) + ' Edge';
    this.elTelemetryEdge.textContent = posLabel;
    this.elTelemetryEdgeSub.textContent = `Delay: ${this.config.screenLayout.edgeSwitchDelay}ms • Thresh: ${this.config.screenLayout.edgeThreshold}px`;
  }

  bindEvents() {
    // Tab Switching
    this.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.navTabs.forEach(t => t.classList.remove('active'));
        this.tabPanes.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetId = tab.dataset.tab;
        document.getElementById(targetId).classList.add('active');
      });
    });

    // Emergency Lock Button
    this.elBtnToggleLock.addEventListener('click', async () => {
      this.isLocked = !this.isLocked;
      const locked = await window.api.toggleLock(this.isLocked);
      this.updateLockUI(locked);
      this.playChime('lock');
    });

    // Topology Orientation Buttons
    this.layoutButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const pos = btn.dataset.pos;
        this.layoutButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.updateTopologyOrientation(pos);
        this.config.screenLayout.relativePosition = pos;
        await window.api.setScreenLayout({ relativePosition: pos });
        this.updateTelemetryEdgeInfo();
        this.log(`Monitor arrangement set to: Remote PC on the ${pos.toUpperCase()}`);
      });
    });

    // Manual Screen Switch Button
    this.elBtnManualSwitch.addEventListener('click', async () => {
      const target = (this.activeMachine === 'local') ? 'remote' : 'local';
      await window.api.switchActiveMachine(target);
      this.playChime('hop');
    });

    // Security Badge Quick Link
    if (this.elHeaderSecurityBadge) {
      this.elHeaderSecurityBadge.addEventListener('click', () => {
        // Switch to Preferences Tab
        this.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'tab-settings'));
        this.tabPanes.forEach(p => p.classList.toggle('active', p.id === 'tab-settings'));
        if (this.rowPrefPassword) {
          this.rowPrefPassword.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Password Show/Hide Toggle Helpers
    const setupEyeToggle = (btn, input) => {
      if (!btn || !input) return;
      btn.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '👁️' : '🙈';
      });
    };
    setupEyeToggle(this.elBtnToggleTargetPass, this.elInputTargetPassword);
    setupEyeToggle(this.btnTogglePrefPass, this.prefPassword);
    setupEyeToggle(this.elBtnToggleModalPass, this.elInputModalPassword);

    // Require Password Toggle Switch in Preferences
    if (this.prefRequirePassword) {
      this.prefRequirePassword.addEventListener('change', () => {
        const isReq = this.prefRequirePassword.checked;
        this.rowPrefPassword.style.display = isReq ? 'flex' : 'none';
        this.updateSecurityHeaderUI(isReq);
      });
    }

    // Generate PIN Button
    if (this.btnGenPin) {
      this.btnGenPin.addEventListener('click', () => {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        this.prefPassword.value = pin;
        this.prefPassword.type = 'text';
        if (this.btnTogglePrefPass) this.btnTogglePrefPass.textContent = '🙈';
        this.log(`Generated secure 6-digit PIN: ${pin}`);
      });
    }

    // Direct Connect Form
    this.formDirectConnect.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ip = this.elInputTargetIp.value.trim();
      const port = parseInt(this.elInputTargetPort.value, 10) || 48260;
      const password = this.elInputTargetPassword ? this.elInputTargetPassword.value.trim() : '';

      if (!ip) return;

      this.log(`Initiating connection to ${ip}:${port}...`);
      await window.api.connectPeer(ip, port, password);
    });

    this.elBtnDisconnect.addEventListener('click', async () => {
      await window.api.disconnectPeer();
      this.log('Disconnected from peer.');
    });

    // Preferences Form
    this.prefSwitchDelay.addEventListener('input', () => {
      this.prefSwitchDelayVal.textContent = `${this.prefSwitchDelay.value} ms`;
    });

    this.prefEdgeThreshold.addEventListener('input', () => {
      this.prefEdgeThresholdVal.textContent = `${this.prefEdgeThreshold.value} px`;
    });

    this.btnSaveSettings.addEventListener('click', async () => {
      const isReqPass = this.prefRequirePassword.checked;
      const passVal = this.prefPassword.value.trim();

      const newSettings = {
        deviceName: this.prefDeviceName.value.trim() || this.systemInfo.hostname,
        syncClipboard: this.prefSyncClipboard.checked,
        soundEffects: this.prefSoundEffects.checked,
        emergencyKey: this.prefEmergencyKey.value,
        requirePassword: isReqPass,
        password: passVal,
        secretKey: passVal,
        screenLayout: {
          ...this.config.screenLayout,
          edgeSwitchDelay: parseInt(this.prefSwitchDelay.value, 10),
          edgeThreshold: parseInt(this.prefEdgeThreshold.value, 10)
        }
      };

      await window.api.saveConfig(newSettings);
      this.config = { ...this.config, ...newSettings };
      this.updateSecurityHeaderUI(isReqPass);
      this.updateTelemetryEdgeInfo();

      this.saveSettingsIndicator.classList.add('show');
      setTimeout(() => this.saveSettingsIndicator.classList.remove('show'), 2000);
      this.log('Preferences saved. Security configuration updated.');
    });

    // Password Modal Action Listeners
    if (this.elBtnModalCancel) {
      this.elBtnModalCancel.addEventListener('click', () => {
        this.hidePasswordModal();
      });
    }

    if (this.elBtnModalSubmit) {
      this.elBtnModalSubmit.addEventListener('click', async () => {
        if (!this.pendingConnectPeer) return;
        const enteredPassword = this.elInputModalPassword.value.trim();
        this.elModalAuthError.style.display = 'none';
        this.log(`Authenticating with ${this.pendingConnectPeer.name} using password...`);
        await window.api.connectPeer(this.pendingConnectPeer.ip, this.pendingConnectPeer.port, enteredPassword);
      });
    }

    if (this.elInputModalPassword) {
      this.elInputModalPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.elBtnModalSubmit.click();
        } else if (e.key === 'Escape') {
          this.hidePasswordModal();
        }
      });
    }

    // Interactive Sandbox Handlers
    this.initSandbox();

    // Cross-Device Drag & Drop File Transfer Handlers
    this.initFileDropEvents();

    // IPC Event Listeners from Main Process
    window.api.onConnectionState((data) => this.handleConnectionState(data));
    window.api.onDiscoveredPeer((peer) => this.handlePeerDiscovered(peer));
    window.api.onPeerLost((peer) => this.handlePeerLost(peer));
    window.api.onControlChanged((state) => this.handleControlChanged(state));
    window.api.onTelemetry((telemetry) => this.handleTelemetry(telemetry));
    window.api.onClipboardEvent((clip) => this.handleClipboardEvent(clip));
    window.api.onEmergencyUnlock((data) => this.handleEmergencyUnlock(data));
    window.api.onFileProgress((data) => this.updateTransferProgress(data));
    window.api.onFileComplete((data) => this.handleFileTransferComplete(data));
    window.api.onFileCancelled((data) => this.handleFileTransferCancelled(data));
    window.api.onLog((log) => this.log(log));
  }

  updateTopologyOrientation(pos) {
    this.elTopologyCanvas.className = `screen-canvas orient-${pos}`;
    this.layoutButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pos === pos);
    });
  }

  updateLockUI(locked) {
    this.isLocked = locked;
    if (locked) {
      this.elBtnToggleLock.className = 'header-pill btn-pill-lock locked';
      this.elBtnToggleLock.querySelector('.btn-icon').textContent = '🔒';
      this.elLockBtnText.textContent = 'Locked';
      this.log('Mouse lock ENGAGED. Cursor will not cross screen borders.');
    } else {
      this.elBtnToggleLock.className = 'header-pill btn-pill-lock';
      this.elBtnToggleLock.querySelector('.btn-icon').textContent = '🔓';
      this.elLockBtnText.textContent = 'Unlocked';
      this.log('Mouse lock released. Cross-screen transition enabled.');
    }
  }

  handleConnectionState(data) {
    this.connectionState = data.state;

    if (data.state === 'connected') {
      this.hidePasswordModal();
      this.connectedPeer = data.peer;
      this.elNetStatusBadge.className = 'header-pill pill-net connected';
      this.elNetStatusText.textContent = `Connected: ${data.peer.name || data.peer.ip}`;

      this.elMonitorRemoteName.textContent = data.peer.name || 'Remote PC';
      if (data.peer.screen) {
        this.elMonitorRemoteRes.textContent = `${data.peer.screen.width} × ${data.peer.screen.height}`;
      } else {
        this.elMonitorRemoteRes.textContent = 'Active Link';
      }

      this.elBtnConnect.style.display = 'none';
      this.elBtnDisconnect.style.display = 'block';

      if (this.elFileTargetNotice) {
        this.elFileTargetNotice.textContent = `Ready to beam files to ${data.peer.name || data.peer.ip} • Saved to Downloads/NexusShare`;
      }
      if (this.elWindowDragTargetName) {
        this.elWindowDragTargetName.textContent = `Sending to: ${data.peer.name || data.peer.ip}`;
      }

      this.log(`Successfully connected to ${data.peer.name || data.peer.ip}!`);
    } else if (data.state === 'connecting') {
      this.elNetStatusBadge.className = 'header-pill pill-net';
      this.elNetStatusText.textContent = `Connecting to ${data.ip}...`;
    } else {
      if (data.error) {
        this.log(`⚠️ Connection error: ${data.error}`);
        if (this.elModalPassword && this.elModalPassword.style.display !== 'none') {
          this.elModalAuthError.textContent = `⚠️ ${data.error}`;
          this.elModalAuthError.style.display = 'block';
          this.playChime('lock');
        }
      }

      this.connectedPeer = null;
      this.elNetStatusBadge.className = 'header-pill pill-net disconnected';
      this.elNetStatusText.textContent = `Port :${this.config ? this.config.port : 48260}`;

      this.elMonitorRemoteName.textContent = 'No Device Connected';
      this.elMonitorRemoteRes.textContent = 'Waiting for link...';

      this.elBtnConnect.style.display = 'block';
      this.elBtnDisconnect.style.display = 'none';

      if (this.elFileTargetNotice) {
        this.elFileTargetNotice.textContent = 'Connect to a remote PC to enable cross-device file beam';
      }

      this.elTelemetryLatency.textContent = '--';
      this.elTelemetryPps.textContent = '0';

      this.handleControlChanged({ activeMachine: 'local' });
    }
  }

  handleControlChanged(state) {
    this.activeMachine = state.activeMachine;

    if (state.activeMachine === 'remote') {
      this.playChime('hop');
      this.elActiveMachinePill.className = 'header-pill pill-control remote';
      const peerName = (state.peer && state.peer.name) ? state.peer.name : 'REMOTE PC';
      this.elActiveMachineName.textContent = peerName.toUpperCase();

      this.elMonitorLocal.classList.remove('active');
      this.elMonitorRemote.classList.add('active');

      this.elBtnManualSwitch.innerHTML = `<span>Recall to Local PC</span> <span class="btn-arrow">←</span>`;
      this.log(`Mouse transitioned to ${peerName}. Controlling remote desktop.`);
    } else {
      if (this.elActiveMachinePill.classList.contains('remote')) {
        this.playChime('hop');
      }
      this.elActiveMachinePill.className = 'header-pill pill-control local';
      this.elActiveMachineName.textContent = 'THIS PC';

      this.elMonitorLocal.classList.add('active');
      this.elMonitorRemote.classList.remove('active');

      this.elBtnManualSwitch.innerHTML = `<span>Switch Screen Now</span> <span class="btn-arrow">→</span>`;
      this.log('Mouse active on Primary PC.');
    }
  }

  handleTelemetry(data) {
    if (data.latency !== undefined) {
      this.elTelemetryLatency.textContent = data.latency;
    }
    if (data.ppsSent !== undefined || data.ppsReceived !== undefined) {
      const totalPps = (data.ppsSent || 0) + (data.ppsReceived || 0);
      this.elTelemetryPps.textContent = totalPps;
    }
  }

  handleClipboardEvent(clip) {
    if (clip.action === 'sent') {
      this.elTelemetryClipboard.textContent = `Pushed ${clip.kind} to remote`;
      this.log(`Clipboard: Pushed copied ${clip.kind} to peer.`);
    } else if (clip.action === 'received') {
      this.elTelemetryClipboard.textContent = `Received ${clip.kind} from remote`;
      this.log(`Clipboard: Synced incoming ${clip.kind} from peer.`);
    }
  }

  handleEmergencyUnlock(data) {
    this.updateLockUI(false);
    this.handleControlChanged({ activeMachine: 'local' });
    this.playChime('lock');
    this.log(`⚠️ ${data.message}`);
  }

  handlePeerDiscovered(peer) {
    this.renderDiscoveredPeers(window.api.getDiscoveredPeers());
  }

  handlePeerLost(peer) {
    this.renderDiscoveredPeers(window.api.getDiscoveredPeers());
  }

  showPasswordModal(peer) {
    this.pendingConnectPeer = peer;
    this.elModalDeviceTitle.textContent = `Connect to ${peer.name}`;
    this.elModalDeviceSubtitle.textContent = `Target PC (${peer.ip}) is password-protected. Enter its PIN or password:`;
    this.elInputModalPassword.value = '';
    this.elModalAuthError.style.display = 'none';
    this.elModalPassword.style.display = 'flex';
    setTimeout(() => this.elInputModalPassword.focus(), 50);
  }

  hidePasswordModal() {
    this.elModalPassword.style.display = 'none';
    this.pendingConnectPeer = null;
    this.elModalAuthError.style.display = 'none';
  }

  async renderDiscoveredPeers(peersPromise) {
    const peers = await peersPromise;
    this.elDiscoveryCount.textContent = peers.length;

    if (!peers || peers.length === 0) {
      this.elDiscoveredList.innerHTML = '';
      this.elDiscoveredList.appendChild(this.elEmptyDiscovery);
      return;
    }

    this.elDiscoveredList.innerHTML = '';
    peers.forEach(peer => {
      const item = document.createElement('div');
      item.className = 'device-item';

      const resText = peer.screen ? `${peer.screen.width}×${peer.screen.height}` : 'HD Screen';
      const ipText = `${peer.ip}:${peer.port}`;
      const secBadge = peer.isPasswordProtected
        ? `<span class="badge-protected">🔒 Protected</span>`
        : `<span class="badge-open">🔓 Open</span>`;

      item.innerHTML = `
        <div class="device-info">
          <div class="device-icon">💻</div>
          <div class="device-details">
            <h4>${this.escapeHtml(peer.name)} ${secBadge}</h4>
            <div class="device-meta">${ipText} • ${resText}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm btn-connect-peer">Connect</button>
      `;

      item.querySelector('.btn-connect-peer').addEventListener('click', async () => {
        this.elInputTargetIp.value = peer.ip;
        this.elInputTargetPort.value = peer.port;

        if (peer.isPasswordProtected) {
          this.showPasswordModal(peer);
        } else {
          this.log(`Connecting to discovered peer ${peer.name} (${peer.ip})...`);
          await window.api.connectPeer(peer.ip, peer.port, '');
        }
      });

      this.elDiscoveredList.appendChild(item);
    });
  }

  // ==========================================================================
  // Interactive Sandbox Mode Simulator
  // ==========================================================================
  initSandbox() {
    let currentScreen = 'A';

    this.elBtnSandboxToggle.addEventListener('click', () => {
      this.sandboxActive = !this.sandboxActive;
      this.elSandboxStateText.textContent = this.sandboxActive ? 'Simulator Active' : 'Enable Local Simulator';
      this.elBtnSandboxToggle.classList.toggle('btn-primary', this.sandboxActive);
      this.log(`Interactive sandbox ${this.sandboxActive ? 'ENABLED' : 'DISABLED'}.`);
    });

    const handleCanvasMove = (e, screenId) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);

      this.elSbCoords.textContent = `X: ${x}, Y: ${y}`;

      if (screenId === 'A') {
        this.elVcursorA.style.opacity = '1';
        this.elVcursorA.style.left = `${x}px`;
        this.elVcursorA.style.top = `${y}px`;
        this.elVcursorB.style.opacity = '0';

        // Check if cursor crosses right boundary of Screen A
        if (x >= rect.width - 6) {
          if (currentScreen !== 'B') {
            currentScreen = 'B';
            this.elVirtualScreenA.classList.remove('active');
            this.elVirtualScreenB.classList.add('active');
            this.elSbFocus.textContent = 'SCREEN 2 (CLIENT)';
            this.elSbTransitionEvent.textContent = `Hop Right (Y: ${y})`;
            this.playChime('hop');
            this.log(`Sandbox: Cursor glided across boundary into Screen B at Y=${y}`);
          }
        }
      } else if (screenId === 'B') {
        this.elVcursorB.style.opacity = '1';
        this.elVcursorB.style.left = `${x}px`;
        this.elVcursorB.style.top = `${y}px`;
        this.elVcursorA.style.opacity = '0';

        // Check if cursor crosses left boundary of Screen B
        if (x <= 6) {
          if (currentScreen !== 'A') {
            currentScreen = 'A';
            this.elVirtualScreenB.classList.remove('active');
            this.elVirtualScreenA.classList.add('active');
            this.elSbFocus.textContent = 'SCREEN 1 (HOST)';
            this.elSbTransitionEvent.textContent = `Hop Left (Y: ${y})`;
            this.playChime('hop');
            this.log(`Sandbox: Cursor returned back across boundary into Screen A at Y=${y}`);
          }
        }
      }
    };

    this.elCanvasAreaA.addEventListener('mousemove', (e) => handleCanvasMove(e, 'A'));
    this.elCanvasAreaB.addEventListener('mousemove', (e) => handleCanvasMove(e, 'B'));

    this.elCanvasAreaA.addEventListener('mouseleave', () => {
      this.elVcursorA.style.opacity = '0';
    });
    this.elCanvasAreaB.addEventListener('mouseleave', () => {
      this.elVcursorB.style.opacity = '0';
    });
  }

  // ==========================================================================
  // Cross-Device Drag & Drop File Transfer Implementation
  // ==========================================================================
  initFileDropEvents() {
    // 1. Drop on Remote Monitor in Topology Canvas
    if (this.elMonitorRemote) {
      this.elMonitorRemote.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elMonitorRemote.classList.add('drag-over');
      });

      this.elMonitorRemote.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elMonitorRemote.classList.remove('drag-over');
      });

      this.elMonitorRemote.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elMonitorRemote.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
          this.handleFilesDrop(e.dataTransfer.files);
        }
      });
    }

    // 2. Drop on Hero Drop Zone in File Transfer Tab
    if (this.elFileDropZone) {
      this.elFileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elFileDropZone.classList.add('drag-over');
      });

      this.elFileDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elFileDropZone.classList.remove('drag-over');
      });

      this.elFileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.elFileDropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
          this.handleFilesDrop(e.dataTransfer.files);
        }
      });

      this.elFileDropZone.addEventListener('click', (e) => {
        if (e.target !== this.elBtnBrowseFilePicker && this.elFileInputPicker) {
          this.elFileInputPicker.click();
        }
      });
    }

    if (this.elBtnBrowseFilePicker && this.elFileInputPicker) {
      this.elBtnBrowseFilePicker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.elFileInputPicker.click();
      });

      this.elFileInputPicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleFilesDrop(e.target.files);
          e.target.value = '';
        }
      });
    }

    // 3. Full Window Drag & Drop Overlay
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (this.connectedPeer && this.elWindowDragOverlay) {
        this.elWindowDragOverlay.style.display = 'flex';
      }
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0 && this.elWindowDragOverlay) {
        this.elWindowDragOverlay.style.display = 'none';
        dragCounter = 0;
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (this.elWindowDragOverlay) {
        this.elWindowDragOverlay.style.display = 'none';
      }
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleFilesDrop(e.dataTransfer.files);
      }
    });

    // 4. Vault Action Buttons
    if (this.elBtnOpenDownloadsDir) {
      this.elBtnOpenDownloadsDir.addEventListener('click', () => {
        window.api.openSaveDir();
      });
    }

    if (this.elBtnRefreshReceived) {
      this.elBtnRefreshReceived.addEventListener('click', () => {
        this.loadReceivedFiles();
      });
    }
  }

  async handleFilesDrop(fileList) {
    if (!this.connectedPeer || this.connectionState !== 'connected') {
      this.log('⚠️ Cannot send file: No remote computer connected. Connect to a device first.');
      this.playChime('lock');
      // Switch to Devices tab
      this.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'tab-devices'));
      this.tabPanes.forEach(p => p.classList.toggle('active', p.id === 'tab-devices'));
      return;
    }

    const paths = [];
    for (let i = 0; i < fileList.length; i++) {
      if (fileList[i].path) {
        paths.push(fileList[i].path);
      }
    }

    if (paths.length === 0) return;

    // Switch to File Transfer tab to watch real-time progress
    this.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'tab-files'));
    this.tabPanes.forEach(p => p.classList.toggle('active', p.id === 'tab-files'));

    this.log(`Streaming ${paths.length} file(s) across to ${this.connectedPeer.name}...`);
    this.playChime('hop');

    try {
      const res = await window.api.sendFiles(paths);
      if (!res.success) {
        this.log(`⚠️ Transfer error: ${res.error}`);
      }
    } catch (e) {
      this.log(`⚠️ Transfer failed: ${e.message}`);
    }
  }

  updateTransferProgress(data) {
    const { transferId, name, size, bytesTransferred, progress, direction } = data;
    this.activeTransfers.set(transferId, data);

    if (this.elTransfersActiveBadge) {
      this.elTransfersActiveBadge.textContent = this.activeTransfers.size;
      this.elTransfersActiveBadge.style.display = this.activeTransfers.size > 0 ? 'inline-block' : 'none';
    }

    if (this.elEmptyTransfers) {
      this.elEmptyTransfers.style.display = this.activeTransfers.size > 0 ? 'none' : 'flex';
    }

    let item = document.getElementById(`transfer-${transferId}`);
    if (!item) {
      item = document.createElement('div');
      item.id = `transfer-${transferId}`;
      item.className = 'transfer-item';
      this.elActiveTransfersList.appendChild(item);
    }

    const dirBadgeClass = direction === 'outgoing' ? 'outgoing' : 'incoming';
    const dirLabel = direction === 'outgoing' ? '⬆ Sending to Remote' : '⬇ Receiving from Remote';
    const fileIcon = this.getFileIcon(name);

    item.innerHTML = `
      <div class="transfer-header">
        <div class="transfer-file-info">
          <span class="transfer-file-icon">${fileIcon}</span>
          <span class="transfer-file-name" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</span>
        </div>
        <span class="transfer-direction-badge ${dirBadgeClass}">${dirLabel}</span>
      </div>
      <div class="transfer-progress-track">
        <div class="transfer-progress-bar" style="width: ${progress}%"></div>
      </div>
      <div class="transfer-meta-footer">
        <span>${this.formatBytes(bytesTransferred)} / ${this.formatBytes(size)}</span>
        <span><strong>${progress}%</strong></span>
      </div>
    `;
  }

  handleFileTransferComplete(record) {
    this.activeTransfers.delete(record.id);

    if (this.elTransfersActiveBadge) {
      this.elTransfersActiveBadge.textContent = this.activeTransfers.size;
      this.elTransfersActiveBadge.style.display = this.activeTransfers.size > 0 ? 'inline-block' : 'none';
    }

    // Remove active transfer card after 1.5 seconds
    const item = document.getElementById(`transfer-${record.id}`);
    if (item) {
      const bar = item.querySelector('.transfer-progress-bar');
      if (bar) bar.style.width = '100%';
      setTimeout(() => {
        if (item && item.parentNode) {
          item.parentNode.removeChild(item);
        }
        if (this.elEmptyTransfers) {
          this.elEmptyTransfers.style.display = this.activeTransfers.size > 0 ? 'none' : 'flex';
        }
      }, 1500);
    }

    this.playChime('hop');
    this.log(`File transfer complete: ${record.name} (${this.formatBytes(record.size)})`);
    this.loadReceivedFiles();
  }

  handleFileTransferCancelled(data) {
    this.activeTransfers.delete(data.transferId);
    const item = document.getElementById(`transfer-${data.transferId}`);
    if (item && item.parentNode) {
      item.parentNode.removeChild(item);
    }
    if (this.elEmptyTransfers) {
      this.elEmptyTransfers.style.display = this.activeTransfers.size > 0 ? 'none' : 'flex';
    }
    this.log(`File transfer cancelled: ${data.transferId}`);
  }

  async loadReceivedFiles() {
    try {
      const files = await window.api.getReceivedFiles();
      if (!this.elReceivedFilesList) return;

      if (!files || files.length === 0) {
        this.elReceivedFilesList.innerHTML = '';
        if (this.elEmptyReceived) this.elReceivedFilesList.appendChild(this.elEmptyReceived);
        return;
      }

      this.elReceivedFilesList.innerHTML = '';
      files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

      files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'vault-item';
        const fileIcon = this.getFileIcon(file.name);
        const dateStr = file.mtime ? new Date(file.mtime).toLocaleDateString() : '';

        item.innerHTML = `
          <div class="vault-file-details">
            <span class="transfer-file-icon">${fileIcon}</span>
            <div>
              <div class="vault-file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
              <div class="vault-file-meta">${this.formatBytes(file.size)} • ${dateStr}</div>
            </div>
          </div>
          <div class="vault-actions">
            <button class="btn btn-outline btn-xs btn-open-file">Open</button>
            <button class="btn btn-outline btn-xs btn-show-folder">Folder</button>
          </div>
        `;

        item.querySelector('.btn-open-file').addEventListener('click', () => {
          window.api.openReceivedFile(file.path);
        });

        item.querySelector('.btn-show-folder').addEventListener('click', () => {
          window.api.showInFolder(file.path);
        });

        this.elReceivedFilesList.appendChild(item);
      });
    } catch (e) {
      console.warn('Error loading received files:', e);
    }
  }

  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return '🖼️';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return '🎵';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return '📄';
    if (['js', 'ts', 'py', 'cs', 'cpp', 'html', 'css', 'json'].includes(ext)) return '💻';
    if (['exe', 'msi', 'bat', 'cmd', 'ps1'].includes(ext)) return '⚙️';
    return '📁';
  }

  formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  log(msg) {
    const time = new Date().toLocaleTimeString();
    this.elLatestLog.textContent = `[${time}] ${msg}`;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.nexusApp = new NexusApp();
});
