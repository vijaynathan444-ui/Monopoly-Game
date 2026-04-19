'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

interface PlayerData {
  id: string;
  userId: string;
  name: string;
  avatar: string;
}

interface MapInfo {
  name: string;
  file: string;
  description: string;
}

interface GameState {
  room: {
    id: string;
    roomCode: string;
    hostId: string;
    status: string;
    mapName: string;
    maxPlayers: number;
  };
  players: PlayerData[];
}

export default function LobbyPage() {
  const router = useRouter();
  const params = useParams();
  const roomCode = (params?.code ?? '') as string;

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  const isHost = gameState?.room.hostId === userId;

  useEffect(() => {
    const storedUserId = sessionStorage.getItem('userId');
    const storedRoomId = sessionStorage.getItem('roomId');

    if (!storedUserId || !storedRoomId) {
      router.push('/');
      return;
    }

    setUserId(storedUserId);

    // Load available maps
    fetch('/api/maps')
      .then((r) => r.json())
      .then(setMaps)
      .catch(() => {});

    const socket = getSocket();

    // If we already have a connection, try to reconnect
    socket.emit('reconnect_player', {
      roomId: storedRoomId,
      userId: storedUserId,
    }, (res: { success: boolean; state?: GameState; error?: string }) => {
      if (res.success && res.state) {
        setGameState(res.state);
      } else {
        setError(res.error || 'Room not found or session expired');
        sessionStorage.clear();
        setTimeout(() => router.push('/'), 2000);
      }
    });

    socket.on('game_state_update', (state: GameState) => {
      setGameState(state);
      if (state.room.status === 'playing') {
        router.push(`/game/${roomCode}`);
      }
    });

    socket.on('game_started', () => {
      router.push(`/game/${roomCode}`);
    });

    socket.on('player_kicked', () => {
      sessionStorage.clear();
      router.push('/');
    });

    return () => {
      socket.off('game_state_update');
      socket.off('game_started');
      socket.off('player_kicked');
    };
  }, [router, roomCode]);

  const handleSelectMap = useCallback((mapFile: string) => {
    if (!isHost) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('select_map', { roomId, mapName: mapFile }, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error || 'Failed to select map');
    });
  }, [isHost]);

  const handleSetMaxPlayers = useCallback((count: number) => {
    if (!isHost) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('set_max_players', { roomId, maxPlayers: count }, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error || 'Failed to set max players');
    });
  }, [isHost]);

  const handleStartGame = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('start_game', { roomId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error || 'Failed to start game');
    });
  }, []);

  const handleKick = useCallback((targetUserId: string) => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('kick_player', { roomId, targetUserId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error || 'Failed to kick player');
    });
  }, []);

  if (!gameState) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <div className="lobby-header">
        <h1>Game Lobby</h1>
        <div className="room-code-display">
          <p>Room Code</p>
          <span>{roomCode}</span>
          <p>Share this code with friends</p>
        </div>
      </div>

      {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}

      <div className="lobby-content">
        <div className="lobby-section">
          <h3>Players ({gameState.players.length}/{gameState.room.maxPlayers})</h3>
          <ul className="player-list">
            {gameState.players.map((player) => (
              <li key={player.id} className="player-item">
                <span className="player-avatar">{player.avatar}</span>
                <span className="player-name">{player.name}</span>
                {player.userId === gameState.room.hostId && (
                  <span className="host-badge">HOST</span>
                )}
                {isHost && player.userId !== userId && (
                  <button
                    className="btn-danger btn-small"
                    onClick={() => handleKick(player.userId)}
                  >
                    Kick
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="lobby-section">
          <h3>Select Map {!isHost && '(Host only)'}</h3>
          <div className="map-selector">
            {maps.map((map) => (
              <button
                key={map.file}
                className={`map-option ${gameState.room.mapName === map.file ? 'selected' : ''}`}
                onClick={() => handleSelectMap(map.file)}
                disabled={!isHost}
              >
                <h4>{map.name}</h4>
                <p>{map.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-section">
          <h3>Max Players {!isHost && '(Host only)'}</h3>
          <div className="max-players-selector">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button
                key={n}
                className={`max-player-btn ${gameState.room.maxPlayers === n ? 'selected' : ''}`}
                onClick={() => handleSetMaxPlayers(n)}
                disabled={!isHost || n < gameState.players.length}
                title={n < gameState.players.length ? `Cannot set below current ${gameState.players.length} players` : `Set max to ${n} players`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lobby-actions">
        {isHost && (
          <button
            className="btn-success"
            onClick={handleStartGame}
            disabled={gameState.players.length < 2}
          >
            {gameState.players.length < 2 ? 'Need at least 2 players' : 'Start Game'}
          </button>
        )}
        {!isHost && (
          <p style={{ color: 'var(--text-secondary)' }}>Waiting for host to start the game...</p>
        )}
      </div>
    </div>
  );
}
