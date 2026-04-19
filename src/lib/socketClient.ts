'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let initPromise: Promise<void> | null = null;

const SOCKET_PORT = 3001;

function getSocketUrl(): string {
  if (typeof window === 'undefined') return `http://localhost:${SOCKET_PORT}`;
  return `http://${window.location.hostname}:${SOCKET_PORT}`;
}

function ensureServerInit(): Promise<void> {
  if (!initPromise) {
    initPromise = fetch('/api/socketio')
      .then(() => {})
      .catch(() => {})
      .finally(() => { initPromise = null; });
  }
  return initPromise;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketUrl(), {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: false,
    });

    // Initialize server then connect
    ensureServerInit().then(() => {
      socket?.connect();
    });

    // Re-trigger server init on connection errors (handles HMR/server restarts)
    socket.on('connect_error', () => {
      ensureServerInit();
    });

    // Re-associate with room after automatic socket reconnect
    socket.on('connect', () => {
      if (typeof window !== 'undefined') {
        const roomId = sessionStorage.getItem('roomId');
        const userId = sessionStorage.getItem('userId');
        if (roomId && userId && socket) {
          socket.emit('reconnect_player', { roomId, userId }, () => {});
        }
      }
    });

    // Re-trigger init on reconnect attempts (server may have restarted)
    socket.io.on('reconnect_attempt', () => {
      ensureServerInit();
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
