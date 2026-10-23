const { clipboard, nativeImage } = require('electron');
const EventEmitter = require('events');

class ClipboardService extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.lastText = '';
    this.isUpdatingFromRemote = false;
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  start() {
    if (this.timer) return;
    try {
      this.lastText = clipboard.readText();
    } catch (e) {}

    this.timer = setInterval(() => {
      if (!this.enabled || this.isUpdatingFromRemote) return;

      try {
        const currentText = clipboard.readText();
        if (currentText && currentText !== this.lastText) {
          this.lastText = currentText;
          this.emit('clipboard-changed', {
            kind: 'text',
            data: currentText
          });
        }
      } catch (e) {}
    }, 600);
  }

  applyRemoteClipboard(msg) {
    if (!this.enabled) return;

    this.isUpdatingFromRemote = true;
    try {
      if (msg.kind === 'text' && msg.data) {
        this.lastText = msg.data;
        clipboard.writeText(msg.data);
        this.emit('clipboard-received', { kind: 'text', length: msg.data.length });
      } else if (msg.kind === 'image' && msg.data) {
        const img = nativeImage.createFromDataURL(msg.data);
        if (!img.isEmpty()) {
          clipboard.writeImage(img);
          this.emit('clipboard-received', { kind: 'image' });
        }
      }
    } catch (e) {
      console.warn('Failed to apply remote clipboard:', e);
    } finally {
      setTimeout(() => {
        this.isUpdatingFromRemote = false;
      }, 300);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = ClipboardService;
