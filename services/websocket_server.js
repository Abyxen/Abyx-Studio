/**
 * Real-Time WebSocket & Event Stream Server
 * Bridges client connections with real-time model streaming, action events, tool outputs,
 * ordered event delivery, and reconnection event replay.
 */

const { WebSocketServer } = require('ws');
const { EventService } = require('./event_service');

class AbyxWebSocketServer {
  constructor(httpServer, eventService = null) {
    this.httpServer = httpServer;
    this.events = eventService || new EventService();
    this.wss = null;
    this.clients = new Set();
    this.clientCursors = new Map();
  }

  start() {
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws/events' });

    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.clientCursors.set(ws, 0);

      // Send initial connection handshake
      ws.send(JSON.stringify({
        type: 'handshake_ack',
        clientId,
        timestamp: new Date().toISOString(),
        totalBufferedEvents: this.events.eventLog.length
      }));

      ws.on('message', (messageRaw) => {
        try {
          const msg = JSON.parse(messageRaw.toString());
          // Handle client replay request: { type: 'replay', fromOffset: 0 }
          if (msg.type === 'replay') {
            const offset = Number(msg.fromOffset) || 0;
            const history = this.events.eventLog.slice(offset);
            ws.send(JSON.stringify({
              type: 'replay_batch',
              count: history.length,
              events: history
            }));
          }
        } catch (_) {}
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.clientCursors.delete(ws);
      });
    });

    // Subscribe to EventService and broadcast to all connected WebSocket clients
    this.events.subscribe((evt) => {
      const payload = JSON.stringify(evt);
      for (const client of this.clients) {
        if (client.readyState === 1 /* OPEN */) {
          client.send(payload);
        }
      }
    });
  }

  broadcast(type, data = {}) {
    return this.events.publish({ type, ...data });
  }

  stop() {
    if (this.wss) {
      for (const client of this.clients) {
        try { client.close(); } catch (_) {}
      }
      this.wss.close();
      this.wss = null;
    }
  }
}

module.exports = { AbyxWebSocketServer };
