const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

class ConfigManager {
  constructor() {
    // Save settings in user data directory
    const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '../../');
    this.configPath = path.join(userDataPath, 'nexus-share-settings.json');
    this.config = this.getDefaults();
    this.load();
  }

  getDefaults() {
    return {
      deviceName: os.hostname() || 'My-PC',
      port: 48260,
      discoveryPort: 48261,
      requirePassword: false,
      password: '',
      secretKey: '',
      screenLayout: {
        relativePosition: 'right', // 'left', 'right', 'top', 'bottom'
        edgeSwitchDelay: 80,       // ms delay before switching
        edgeThreshold: 3           // pixels from border
      },
      syncClipboard: true,
      soundEffects: true,
      emergencyKey: 'ScrollLock', // 'ScrollLock', 'Pause', 'F12'
      autoConnect: true,
      lastConnectedIp: '',
      lastConnectedPort: 48260,
      sandboxMode: false
    };
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(data);
        this.config = { ...this.getDefaults(), ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load config, using defaults:', e.message);
    }
  }

  save(newConfig = {}) {
    try {
      this.config = { ...this.config, ...newConfig };
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Failed to save config:', e.message);
      return false;
    }
  }

  get() {
    return { ...this.config };
  }
}

module.exports = new ConfigManager();
