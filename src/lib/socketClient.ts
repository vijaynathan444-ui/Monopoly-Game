'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // Trigger Socket.IO server initialization (non-blocking)
    fetch('/api/socketio').catch(() => {});
    socket = io({
      path: '/api/socketio',
      addTrailingSlash: false,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
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
