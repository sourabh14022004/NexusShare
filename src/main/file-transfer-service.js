const fs = require('fs');
const path = require('path');
const { app, shell, Notification } = require('electron');
const EventEmitter = require('events');
const crypto = require('crypto');

class FileTransferService extends EventEmitter {
  constructor(peerService) {
    super();
    this.peerService = peerService;
    const baseDownloads = app ? app.getPath('downloads') : path.join(__dirname, '../../');
    this.saveDir = path.join(baseDownloads, 'NexusShare');

    this.ensureSaveDir();

    // Active incoming transfers: transferId -> { name, size, bytesReceived, writeStream, filePath, startTime }
    this.incomingTransfers = new Map();

    // Active outgoing transfers: transferId -> { name, size, bytesSent, isCancelled }
    this.outgoingTransfers = new Map();

    // Recent transfer history
    this.transferHistory = [];
  }

  ensureSaveDir() {
    try {
      if (!fs.existsSync(this.saveDir)) {
        fs.mkdirSync(this.saveDir, { recursive: true });
      }
    } catch (e) {
      console.warn('Failed to create NexusShare downloads folder:', e.message);
    }
  }

  getSaveDir() {
    return this.saveDir;
  }

  // Handle incoming messages from peer
  handlePeerMessage(msg) {
    switch (msg.type) {
      case 'file_start':
        this.handleFileStart(msg);
        break;

      case 'file_chunk':
        this.handleFileChunk(msg);
        break;

      case 'file_complete':
        this.handleFileComplete(msg);
        break;

      case 'file_cancel':
        this.handleFileCancel(msg);
        break;

      default:
        break;
    }
  }

  handleFileStart(msg) {
    const { transferId, name, size } = msg;
    this.ensureSaveDir();

    // Avoid overwriting existing files with same name
    let finalPath = path.join(this.saveDir, name);
    let counter = 1;
    const ext = path.extname(name);
    const base = path.basename(name, ext);

    while (fs.existsSync(finalPath)) {
      finalPath = path.join(this.saveDir, `${base}_(${counter})${ext}`);
      counter++;
    }

    try {
      const writeStream = fs.createWriteStream(finalPath);
      this.incomingTransfers.set(transferId, {
        transferId,
        name,
        size,
        bytesReceived: 0,
        filePath: finalPath,
        writeStream,
        startTime: Date.now()
      });

      this.emit('transfer-progress', {
        transferId,
        name,
        size,
        bytesTransferred: 0,
        progress: 0,
        direction: 'incoming',
        status: 'receiving'
      });
    } catch (e) {
      console.error('Failed to create file write stream:', e);
      if (this.peerService) {
        this.peerService.sendRaw({ type: 'file_cancel', transferId, reason: e.message });
      }
    }
  }

  handleFileChunk(msg) {
    const { transferId, chunk } = msg;
    const transfer = this.incomingTransfers.get(transferId);
    if (!transfer) return;

    try {
      const buffer = Buffer.from(chunk, 'base64');
      transfer.writeStream.write(buffer);
      transfer.bytesReceived += buffer.length;

      const progress = transfer.size > 0 ? Math.round((transfer.bytesReceived / transfer.size) * 100) : 0;

      this.emit('transfer-progress', {
        transferId,
        name: transfer.name,
        size: transfer.size,
        bytesTransferred: transfer.bytesReceived,
        progress,
        direction: 'incoming',
        status: 'receiving'
      });
    } catch (e) {
      console.error('Error writing file chunk:', e);
    }
  }

  handleFileComplete(msg) {
    const { transferId } = msg;
    const transfer = this.incomingTransfers.get(transferId);
    if (!transfer) return;

    transfer.writeStream.end(() => {
      this.incomingTransfers.delete(transferId);

      const record = {
        id: transferId,
        name: transfer.name,
        size: transfer.size,
        filePath: transfer.filePath,
        direction: 'incoming',
        timestamp: Date.now(),
        status: 'completed'
      };

      this.transferHistory.unshift(record);
      if (this.transferHistory.length > 30) this.transferHistory.pop();

      this.emit('transfer-complete', record);

      // System Notification
      try {
        if (Notification.isSupported()) {
          const notif = new Notification({
            title: 'NexusShare: File Received',
            body: `${transfer.name} (${this.formatBytes(transfer.size)}) has been saved to Downloads/NexusShare.`
          });
          notif.on('click', () => {
            shell.showItemInFolder(transfer.filePath);
          });
          notif.show();
        }
      } catch (e) {}
    });
  }

  handleFileCancel(msg) {
    const { transferId, reason } = msg;
    if (this.incomingTransfers.has(transferId)) {
      const transfer = this.incomingTransfers.get(transferId);
      try {
        transfer.writeStream.close();
        if (fs.existsSync(transfer.filePath)) {
          fs.unlinkSync(transfer.filePath);
        }
      } catch (e) {}
      this.incomingTransfers.delete(transferId);
      this.emit('transfer-cancelled', { transferId, reason, direction: 'incoming' });
    }

    if (this.outgoingTransfers.has(transferId)) {
      this.outgoingTransfers.delete(transferId);
      this.emit('transfer-cancelled', { transferId, reason, direction: 'outgoing' });
    }
  }

  // Send a file to connected peer
  async sendFile(filePath) {
    if (!this.peerService || !this.peerService.isConnected()) {
      throw new Error('Not connected to any peer device.');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      throw new Error('Folder transfer is not supported directly. Please drop individual files or a zip archive.');
    }

    const transferId = crypto.randomBytes(8).toString('hex');
    const name = path.basename(filePath);
    const size = stat.size;

    this.outgoingTransfers.set(transferId, {
      transferId,
      name,
      size,
      filePath,
      bytesSent: 0,
      isCancelled: false
    });

    // Notify peer of transfer start
    this.peerService.sendRaw({
      type: 'file_start',
      transferId,
      name,
      size
    });

    this.emit('transfer-progress', {
      transferId,
      name,
      size,
      bytesTransferred: 0,
      progress: 0,
      direction: 'outgoing',
      status: 'sending'
    });

    // Stream file in 64KB chunks
    const CHUNK_SIZE = 64 * 1024;
    const readStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

    let bytesSent = 0;

    for await (const chunk of readStream) {
      const outTransfer = this.outgoingTransfers.get(transferId);
      if (!outTransfer || outTransfer.isCancelled) {
        readStream.destroy();
        return;
      }

      this.peerService.sendRaw({
        type: 'file_chunk',
        transferId,
        chunk: chunk.toString('base64')
      });

      bytesSent += chunk.length;
      outTransfer.bytesSent = bytesSent;

      const progress = size > 0 ? Math.round((bytesSent / size) * 100) : 100;

      this.emit('transfer-progress', {
        transferId,
        name,
        size,
        bytesTransferred: bytesSent,
        progress,
        direction: 'outgoing',
        status: 'sending'
      });
    }

    // Complete transfer
    this.peerService.sendRaw({
      type: 'file_complete',
      transferId
    });

    this.outgoingTransfers.delete(transferId);

    const record = {
      id: transferId,
      name,
      size,
      filePath,
      direction: 'outgoing',
      timestamp: Date.now(),
      status: 'completed'
    };

    this.transferHistory.unshift(record);
    if (this.transferHistory.length > 30) this.transferHistory.pop();

    this.emit('transfer-complete', record);
    return record;
  }

  getTransferHistory() {
    return this.transferHistory;
  }

  getReceivedFiles() {
    this.ensureSaveDir();
    try {
      const files = fs.readdirSync(this.saveDir);
      return files.map(file => {
        const fullPath = path.join(this.saveDir, file);
        try {
          const stat = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtime
          };
        } catch (e) {
          return { name: file, path: fullPath, size: 0, mtime: 0 };
        }
      });
    } catch (e) {
      return [];
    }
  }

  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

module.exports = FileTransferService;
