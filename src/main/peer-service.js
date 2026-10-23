const WebSocket = require('ws');
const EventEmitter = require('events');

class PeerService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 48260;
    this.deviceName = options.deviceName || 'Local PC';
    this.requirePassword = !!options.requirePassword;
    this.password = options.password || options.secretKey || '';
    this.secretKey = this.password;
    this.screen = options.screen || { width: 1920, height: 1080 };

    this.server = null;
    this.activeSocket = null; // Currently connected peer socket
    this.isServer = false;
    this.connectionState = 'disconnected'; // 'disconnected', 'connecting', 'connected'
    this.remotePeer = null; // { name, ip, port, screen }

    this.activeMachine = 'local'; // 'local' or 'remote'
    this.pingTimer = null;
    this.lastLatency = 0;

    // Packet metrics for HUD
    this.packetsSent = 0;
    this.packetsReceived = 0;
    this.ppsSent = 0;
    this.ppsReceived = 0;
    this.metricsTimer = null;
  }

  setScreen(screen) {
    if (screen) this.screen = screen;
  }

  setDeviceName(name) {
    if (name) this.deviceName = name;
  }

  setPasswordSettings(requirePassword, password) {
    this.requirePassword = !!requirePassword;
    this.password = password || '';
    this.secretKey = this.password;
  }

  setSecretKey(key) {
    this.password = key || '';
    this.secretKey = this.password;
  }

  startServer() {
    if (this.server) return;

    try {
      this.server = new WebSocket.Server({ port: this.port });
      this.isServer = true;

      this.server.on('connection', (ws, req) => {
        const remoteIp = req.socket.remoteAddress ? req.socket.remoteAddress.replace(/^.*:/, '') : 'unknown';
        console.log(`Incoming connection from ${remoteIp}`);

        // If already connected, close previous
        if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
          try { this.activeSocket.close(); } catch (e) {}
        }

        this.setupSocket(ws, remoteIp, false, '');
      });

      this.server.on('error', (err) => {
        console.warn('Peer server error:', err.message);
        this.emit('server-error', err);
      });

      this.startMetricsTimer();
      console.log(`Peer server listening on port ${this.port}`);
    } catch (e) {
      console.error('Failed to start peer server:', e);
    }
  }

  connectTo(ip, port = 48260, password = '') {
    if (this.activeSocket) {
      try { this.activeSocket.close(); } catch (e) {}
    }

    this.connectionState = 'connecting';
    this.emit('state-changed', { state: 'connecting', ip, port });

    const wsUrl = `ws://${ip}:${port}`;
    console.log(`Connecting to peer at ${wsUrl}...`);

    let ws;
    try {
      ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
    } catch (e) {
      this.connectionState = 'disconnected';
      this.emit('state-changed', { state: 'disconnected', error: e.message });
      return;
    }

    this.setupSocket(ws, ip, true, password);
  }

  setupSocket(ws, ip, isInitiator, targetPassword = '') {
    this.activeSocket = ws;

    ws.on('open', () => {
      // Send handshake with authentication password if provided
      this.sendRaw({
        type: 'handshake',
        name: this.deviceName,
        password: targetPassword || '',
        secretKey: targetPassword || '',
        screen: this.screen
      });
    });

    ws.on('message', (data) => {
      this.packetsReceived++;
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg, ws, ip);
      } catch (e) {
        console.warn('Error parsing incoming peer message:', e);
      }
    });

    ws.on('close', () => {
      console.log('Peer connection closed');
      const wasConnected = (this.connectionState === 'connected');
      this.activeSocket = null;
      this.connectionState = 'disconnected';
      this.remotePeer = null;
      this.activeMachine = 'local';
      this.stopPingTimer();
      this.emit('state-changed', { state: 'disconnected', wasConnected });
    });

    ws.on('error', (err) => {
      console.warn('Peer socket error:', err.message);
      this.emit('socket-error', err);
    });
  }

  handleMessage(msg, ws, ip) {
    switch (msg.type) {
      case 'handshake': {
        // Authenticate password if this device is password-protected
        const incomingPass = (msg.password !== undefined) ? msg.password : msg.secretKey;
        if (this.requirePassword) {
          if (!incomingPass || incomingPass !== this.password) {
            this.sendRaw({
              type: 'handshake_err',
              reason: 'Incorrect password. Target PC requires a valid password to connect.'
            });
            setTimeout(() => {
              try { ws.close(); } catch (e) {}
            }, 100);
            return;
          }
        }

        this.remotePeer = {
          name: msg.name || 'Remote PC',
          ip: ip,
          screen: msg.screen || { width: 1920, height: 1080 }
        };

        this.connectionState = 'connected';
        this.emit('state-changed', { state: 'connected', peer: this.remotePeer });

        // Respond with handshake_ack
        this.sendRaw({
          type: 'handshake_ack',
          name: this.deviceName,
          screen: this.screen
        });

        this.startPingTimer();
        break;
      }

      case 'handshake_ack': {
        this.remotePeer = {
          name: msg.name || 'Remote PC',
          ip: ip,
          screen: msg.screen || { width: 1920, height: 1080 }
        };
        this.connectionState = 'connected';
        this.emit('state-changed', { state: 'connected', peer: this.remotePeer });
        this.startPingTimer();
        break;
      }

      case 'handshake_err': {
        console.warn('Handshake rejected:', msg.reason);
        this.connectionState = 'disconnected';
        this.emit('handshake-failed', msg.reason);
        this.emit('state-changed', { state: 'disconnected', error: msg.reason || 'Authentication failed' });
        try { ws.close(); } catch (e) {}
        break;
      }

      case 'ping': {
        this.sendRaw({ type: 'pong', t: msg.t });
        break;
      }

      case 'pong': {
        if (msg.t) {
          this.lastLatency = Date.now() - msg.t;
          this.emit('telemetry', {
            latency: this.lastLatency,
            ppsSent: this.ppsSent,
            ppsReceived: this.ppsReceived
          });
        }
        break;
      }

      case 'control_take': {
        // Remote host has pushed cursor into this machine
        this.activeMachine = 'remote';
        this.emit('remote-control-take', msg);
        break;
      }

      case 'control_release': {
        // Remote machine returned control back to this machine
        this.activeMachine = 'local';
        this.emit('remote-control-release', msg);
        break;
      }

      case 'input': {
        // High frequency input packet
        this.emit('remote-input', msg.payload);
        break;
      }

      case 'clipboard': {
        this.emit('remote-clipboard', msg);
        break;
      }

      case 'file_start':
      case 'file_chunk':
      case 'file_complete':
      case 'file_cancel': {
        this.emit('file-message', msg);
        break;
      }

      default:
        break;
    }
  }

  sendInput(payload) {
    if (!this.isConnected()) return false;
    this.sendRaw({ type: 'input', payload });
    return true;
  }

  sendControlTake(entryEdge, ratio) {
    if (!this.isConnected()) return false;
    this.activeMachine = 'remote';
    this.sendRaw({ type: 'control_take', entryEdge, ratio });
    return true;
  }

  sendControlRelease(exitEdge, ratio) {
    if (!this.isConnected()) return false;
    this.activeMachine = 'local';
    this.sendRaw({ type: 'control_release', exitEdge, ratio });
    return true;
  }

  sendClipboard(kind, data) {
    if (!this.isConnected()) return false;
    this.sendRaw({ type: 'clipboard', kind, data });
    return true;
  }

  sendRaw(obj) {
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
      try {
        this.activeSocket.send(JSON.stringify(obj));
        this.packetsSent++;
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  isConnected() {
    return this.connectionState === 'connected' && this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.activeSocket) {
      try { this.activeSocket.close(); } catch (e) {}
      this.activeSocket = null;
    }
    this.connectionState = 'disconnected';
    this.remotePeer = null;
    this.activeMachine = 'local';
    this.stopPingTimer();
    this.emit('state-changed', { state: 'disconnected' });
  }

  startPingTimer() {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendRaw({ type: 'ping', t: Date.now() });
      }
    }, 1000);
  }

  stopPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  startMetricsTimer() {
    if (this.metricsTimer) return;
    let prevSent = 0;
    let prevRecv = 0;

    this.metricsTimer = setInterval(() => {
      this.ppsSent = this.packetsSent - prevSent;
      this.ppsReceived = this.packetsReceived - prevRecv;
      prevSent = this.packetsSent;
      prevRecv = this.packetsReceived;

      if (this.isConnected()) {
        this.emit('telemetry', {
          latency: this.lastLatency,
          ppsSent: this.ppsSent,
          ppsReceived: this.ppsReceived,
          totalSent: this.packetsSent,
          totalReceived: this.packetsReceived
        });
      }
    }, 1000);
  }

  stop() {
    this.disconnect();
    this.stopPingTimer();
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.server) {
      try { this.server.close(); } catch (e) {}
      this.server = null;
    }
  }
}

module.exports = PeerService;
