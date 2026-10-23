const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const EventEmitter = require('events');

class HookService extends EventEmitter {
  constructor() {
    super();
    this.worker = null;
    this.readline = null;
    this.screen = { left: 0, top: 0, width: 1920, height: 1080 };
    this.isRedirected = false;
    this.isLocked = false;
    this.isReady = false;
  }

  start() {
    const workerPath = path.join(__dirname, '../../native/InputHookWorker.exe');

    if (!fs.existsSync(workerPath)) {
      console.error(`Native worker binary not found at ${workerPath}.`);
      this.emit('error', new Error(`Native worker binary not found at ${workerPath}`));
      return false;
    }

    try {
      this.worker = spawn(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      this.readline = readline.createInterface({
        input: this.worker.stdout,
        crlfDelay: Infinity
      });

      this.readline.on('line', (line) => {
        line = line.trim();
        if (!line) return;

        try {
          const msg = JSON.parse(line);
          this.handleWorkerMessage(msg);
        } catch (e) {
          console.warn('Malformed message from native hook worker:', line, e.message);
        }
      });

      this.worker.stderr.on('data', (data) => {
        console.error('Native hook stderr:', data.toString());
      });

      this.worker.on('exit', (code, signal) => {
        console.log(`Native hook worker exited with code ${code}, signal ${signal}`);
        this.worker = null;
        this.isReady = false;
        this.emit('exit', { code, signal });
      });

      this.worker.on('error', (err) => {
        console.error('Failed to spawn native hook worker:', err);
        this.emit('error', err);
      });

      return true;
    } catch (err) {
      console.error('Error starting HookService:', err);
      this.emit('error', err);
      return false;
    }
  }

  handleWorkerMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.isReady = true;
        if (msg.screen) this.screen = msg.screen;
        this.emit('ready', this.screen);
        break;

      case 'screen':
        if (msg.screen) this.screen = msg.screen;
        this.emit('screen', this.screen);
        break;

      case 'edge_hit':
        this.emit('edge-hit', msg);
        break;

      case 'mouse_move':
        this.emit('mouse-move', msg);
        break;

      case 'mouse_button':
        this.emit('mouse-button', msg);
        break;

      case 'mouse_wheel':
        this.emit('mouse-wheel', msg);
        break;

      case 'key':
        this.emit('key', msg);
        break;

      case 'mode_changed':
        this.isRedirected = (msg.mode === 'redirect');
        this.emit('mode-changed', msg.mode);
        break;

      case 'lock_changed':
        this.isLocked = msg.locked;
        this.emit('lock-changed', msg.locked);
        break;

      case 'emergency_unlock':
        this.isRedirected = false;
        this.isLocked = false;
        this.emit('emergency-unlock', msg);
        break;

      case 'error':
        console.error('Worker reported error:', msg.message);
        this.emit('worker-error', msg.message);
        break;

      default:
        break;
    }
  }

  sendCommand(cmdObj) {
    if (!this.worker || !this.worker.stdin || this.worker.killed) {
      return false;
    }
    try {
      this.worker.stdin.write(JSON.stringify(cmdObj) + '\n');
      return true;
    } catch (e) {
      console.error('Error writing to native hook worker stdin:', e);
      return false;
    }
  }

  setMode(mode) {
    return this.sendCommand({ cmd: 'set_mode', mode });
  }

  setLock(locked) {
    this.isLocked = locked;
    return this.sendCommand({ cmd: 'set_lock', locked: !!locked });
  }

  setEdge(edge, threshold = 2) {
    return this.sendCommand({ cmd: 'set_edge', edge, threshold });
  }

  injectMousePos(x, y) {
    return this.sendCommand({ cmd: 'inject_mouse_pos', x: Math.round(x), y: Math.round(y) });
  }

  injectMouseDelta(dx, dy) {
    return this.sendCommand({ cmd: 'inject_mouse_delta', dx: Math.round(dx), dy: Math.round(dy) });
  }

  injectMouseButton(button, down) {
    return this.sendCommand({ cmd: 'inject_mouse_button', button, down: !!down });
  }

  injectMouseWheel(delta, horizontal = false) {
    return this.sendCommand({ cmd: 'inject_mouse_wheel', delta, horizontal: !!horizontal });
  }

  injectKey(vk, scan, down, extended = false) {
    return this.sendCommand({ cmd: 'inject_key', vk, scan, down: !!down, extended: !!extended });
  }

  getScreen() {
    return this.sendCommand({ cmd: 'get_screen' });
  }

  stop() {
    if (this.worker) {
      try {
        this.sendCommand({ cmd: 'exit' });
      } catch (e) {}
      setTimeout(() => {
        if (this.worker && !this.worker.killed) {
          try { this.worker.kill(); } catch (e) {}
        }
      }, 500);
    }
  }
}

module.exports = HookService;
