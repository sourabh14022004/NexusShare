const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');
const crypto = require('crypto');

class DiscoveryService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.discoveryPort || 48261;
    this.servicePort = options.port || 48260;
    this.deviceName = options.deviceName || os.hostname();
    this.instanceId = crypto.randomBytes(6).toString('hex');
    this.isPasswordProtected = !!options.requirePassword;
    this.socket = null;
    this.broadcastTimer = null;
    this.pruneTimer = null;
    this.discoveredPeers = new Map(); // id -> peer info
    this.screen = { width: 1920, height: 1080 };
  }

  setPasswordProtected(isProtected) {
    this.isPasswordProtected = !!isProtected;
  }

  setScreen(screen) {
    if (screen) this.screen = screen;
  }

  setDeviceName(name) {
    if (name) this.deviceName = name;
  }

  setServicePort(port) {
    if (port) this.servicePort = port;
  }

  getLocalIps() {
    const ips = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if ('IPv4' === iface.family && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  }

  start() {
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn('Discovery UDP socket error:', err.message);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        try {
          this.socket.setBroadcast(true);
        } catch (e) {
          console.warn('Failed to set broadcast flag:', e.message);
        }
        // Start broadcast loop
        this.broadcastBeacon();
        this.broadcastTimer = setInterval(() => this.broadcastBeacon(), 3000);
      });

      this.socket.bind(this.port);

      // Periodically clean up stale peers (lost connection > 8 seconds)
      this.pruneTimer = setInterval(() => this.pruneStalePeers(), 4000);
      return true;
    } catch (e) {
      console.error('Failed to initialize discovery socket:', e);
      return false;
    }
  }

  broadcastBeacon() {
    if (!this.socket) return;

    const payload = JSON.stringify({
      app: 'NexusShare',
      version: '1.0',
      id: this.instanceId,
      name: this.deviceName,
      port: this.servicePort,
      screen: this.screen,
      isPasswordProtected: this.isPasswordProtected,
      ips: this.getLocalIps()
    });

    const buffer = Buffer.from(payload);

    try {
      this.socket.send(buffer, 0, buffer.length, this.port, '255.255.255.255', (err) => {
        if (err && err.code !== 'ENETUNREACH' && err.code !== 'EHOSTUNREACH') {
          // Normal on some closed networks, suppress repetitive logging
        }
      });
    } catch (e) {}
  }

  handleMessage(msgBuffer, rinfo) {
    try {
      const data = JSON.parse(msgBuffer.toString('utf8'));
      if (data.app !== 'NexusShare' || data.id === this.instanceId) {
        return; // Ignore non-NexusShare or self broadcast
      }

      const peerId = data.id;
      const peerIp = rinfo.address;
      const existing = this.discoveredPeers.get(peerId);

      const peer = {
        id: peerId,
        name: data.name || 'Unknown PC',
        ip: peerIp,
        port: data.port || 48260,
        screen: data.screen || { width: 1920, height: 1080 },
        isPasswordProtected: !!data.isPasswordProtected,
        ips: data.ips || [peerIp],
        lastSeen: Date.now()
      };

      this.discoveredPeers.set(peerId, peer);

      if (!existing) {
        this.emit('peer-discovered', peer);
      } else {
        this.emit('peer-updated', peer);
      }
    } catch (e) {
      // Ignore malformed packets
    }
  }

  pruneStalePeers() {
    const now = Date.now();
    for (const [id, peer] of this.discoveredPeers.entries()) {
      if (now - peer.lastSeen > 9000) {
        this.discoveredPeers.delete(id);
        this.emit('peer-lost', { id, name: peer.name });
      }
    }
  }

  getDiscoveredPeers() {
    return Array.from(this.discoveredPeers.values());
  }

  stop() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }
}

module.exports = DiscoveryService;
