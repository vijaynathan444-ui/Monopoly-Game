'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

interface RoomInfo {
  roomCode: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  mapName: string;
  players: { name: string; avatar: string }[];
}

const MAP_ICONS: Record<string, string> = {
  classic: '🗽',
  india: '🇮🇳',
  world: '🌍',
};

export default function RoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState('');
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);

  const playerName = typeof window !== 'undefined' ? sessionStorage.getItem('playerName') : null;

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setRooms(data);
    } catch {
      setError('Failed to fetch rooms');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!playerName) { router.push('/'); return; }
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, [fetchRooms, playerName, router]);

  const emitWithRetry = (socket: ReturnType<typeof getSocket>, event: string, payload: Record<string, unknown>, onResult: (res: Record<string, unknown>) => void) => {
    const timeout = setTimeout(() => {
      setJoining('');
      setError('Connection timed out.');
    }, 15000);
    const doEmit = () => {
      socket.emit(event, payload, (res: Record<string, unknown>) => {
        clearTimeout(timeout);
        onResult(res);
      });
    };
    if (socket.connected) doEmit();
    else {
      fetch('/api/socketio').catch(() => {});
      if (socket.disconnected) socket.connect();
      socket.once('connect', doEmit);
    }
  };

  const handleJoinRoom = (code: string) => {
    if (!playerName) { router.push('/'); return; }
    setJoining(code);
    setError('');
    const socket = getSocket();
    emitWithRetry(socket, 'join_room', { playerName, roomCode: code }, (res) => {
      setJoining('');
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', code);
        router.push(`/lobby/${code}`);
      } else {
        setError((res.error as string) || 'Failed to join');
      }
    });
  };

  const handleCreateRoom = () => {
    if (!playerName) { router.push('/'); return; }
    setError('');
    const socket = getSocket();
    emitWithRetry(socket, 'create_room', { playerName, isPrivate: false }, (res) => {
      if (res.success) {
        sessionStorage.setItem('userId', res.userId as string);
        sessionStorage.setItem('roomId', res.roomId as string);
        sessionStorage.setItem('roomCode', res.roomCode as string);
        router.push(`/lobby/${res.roomCode}`);
      } else {
        setError((res.error as string) || 'Failed to create room');
      }
    });
  };

  const handleJoinByCode = () => {
    if (!joinCode.trim()) return;
    handleJoinRoom(joinCode.trim().toUpperCase());
    setShowJoinModal(false);
    setJoinCode('');
  };

  return (
    <div className="rooms-container">
      <div className="rooms-header">
        <button className="rooms-back-btn" onClick={() => router.push('/')}>
          ← Back
        </button>
        <div className="rooms-header-actions">
          <button className="rooms-refresh-btn" onClick={fetchRooms} title="Refresh">
            🔄
          </button>
          <button className="rooms-join-code-btn" onClick={() => setShowJoinModal(true)}>
            🔑 Join by code
          </button>
          <button className="rooms-new-btn" onClick={handleCreateRoom}>
            + New room
          </button>
        </div>
      </div>

      <p className="rooms-subtitle">Select the room you would like to join:</p>

      {error && <p className="error-text" style={{ textAlign: 'center', marginBottom: '1rem' }}>{error}</p>}

      {loading && rooms.length === 0 ? (
        <div className="rooms-loading"><div className="spinner"></div></div>
      ) : rooms.length === 0 ? (
        <div className="rooms-empty">
          <p>No rooms available</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Create a new room to get started!</p>
        </div>
      ) : (
        <div className="rooms-list">
          {rooms.map((room) => (
            <button
              key={room.roomCode}
              className="room-card"
              onClick={() => handleJoinRoom(room.roomCode)}
              disabled={joining === room.roomCode || room.playerCount >= room.maxPlayers}
            >
              <div className="room-card-left">
                <div className="room-card-code">{room.roomCode.toLowerCase()}</div>
                <div className="room-card-players">
                  {room.players.map((p, i) => (
                    <span key={i} className="room-player-avatar" title={p.name}>{p.avatar}</span>
                  ))}
                  {Array.from({ length: room.maxPlayers - room.playerCount }).map((_, i) => (
                    <span key={`empty-${i}`} className="room-player-avatar empty">•</span>
                  ))}
                </div>
              </div>
              <div className="room-card-right">
                <div className="room-card-map">
                  <span>{MAP_ICONS[room.mapName] || '🗺️'}</span>
                  <span>{room.mapName.charAt(0).toUpperCase() + room.mapName.slice(1)}</span>
                </div>
                <div className="room-card-count">
                  {room.playerCount}/{room.maxPlayers}
                </div>
              </div>
              {joining === room.roomCode && <div className="room-card-joining">Joining...</div>}
            </button>
          ))}
        </div>
      )}

      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Join by Room Code</h3>
            <p>Enter the room code shared by your friend</p>
            <input
              className="input-field"
              type="text"
              placeholder="Room Code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowJoinModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleJoinByCode}>Join</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
