'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

interface PlayerData {
  id: string;
  userId: string;
  name: string;
  avatar: string;
}

interface MapTile {
  type: string;
  name: string;
  price?: number;
  color?: string;
}

interface MapInfo {
  name: string;
  file: string;
  description: string;
  tileCount: number;
  tiles?: MapTile[];
}

interface GameState {
  room: {
    id: string;
    roomCode: string;
    hostId: string;
    status: string;
    mapName: string;
    maxPlayers: number;
    isPrivate: boolean;
    startingCash: number;
    doubleRentFullSet: boolean;
    mortgageEnabled: boolean;
    noRentInJail: boolean;
    vacationCashEnabled: boolean;
    randomizeOrder: boolean;
    evenBuildRule: boolean;
    auctionEnabled: boolean;
  };
  players: PlayerData[];
}

const STARTING_CASH_OPTIONS = [1000, 1500, 2000, 2500, 3000];

function tileClass(tile?: MapTile) {
  if (!tile) return 'neutral';
  switch (tile.type) {
    case 'PROPERTY':
      return 'property';
    case 'RAILWAY':
    case 'UTILITY':
      return 'utility';
    case 'START':
    case 'FREE_PARKING':
      return 'special';
    case 'LUCK':
    case 'CHEST':
      return 'chance';
    case 'GO_TO_JAIL':
    case 'JAIL':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function LobbyPage() {
  const router = useRouter();
  const params = useParams();
  const roomCode = (params?.code ?? '') as string;

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewMap, setPreviewMap] = useState<MapInfo | null>(null);

  const isHost = gameState?.room.hostId === userId;

  useEffect(() => {
    const storedUserId = sessionStorage.getItem('userId');
    const storedRoomId = sessionStorage.getItem('roomId');

    if (!storedUserId || !storedRoomId) {
      router.push('/');
      return;
    }

    setUserId(storedUserId);

    fetch('/api/maps?detail=true')
      .then((r) => r.json())
      .then(setMaps)
      .catch(() => {});

    const socket = getSocket();

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

  const selectedMap = useMemo(
    () => maps.find((map) => map.file === gameState?.room.mapName),
    [maps, gameState?.room.mapName],
  );

  const updateRoomSettings = useCallback((patch: Record<string, unknown>) => {
    if (!isHost) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('update_room_settings', { roomId, ...patch }, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error || 'Failed to update room settings');
    });
  }, [isHost]);

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

  const handleCopyLink = useCallback(async () => {
    const link = `${window.location.origin}/lobby/${roomCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [roomCode]);

  if (!gameState) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const previewTiles = previewMap?.tiles || selectedMap?.tiles || [];
  const cellMap = new Map<number, MapTile>();
  for (let col = 0; col < 11; col++) {
    if (previewTiles[col]) cellMap.set(col, previewTiles[col]);
  }
  for (let row = 1; row <= 9; row++) {
    const tile = previewTiles[10 + (row - 1)];
    if (tile) cellMap.set(row * 11 + 10, tile);
  }
  for (let col = 10; col >= 0; col--) {
    const tile = previewTiles[20 + (10 - col)];
    if (tile) cellMap.set(110 + col, tile);
  }
  for (let row = 9; row >= 1; row--) {
    const tile = previewTiles[31 + (9 - row)];
    if (tile) cellMap.set(row * 11, tile);
  }

  return (
    <div className="lobby-container lobby-modern-page">
      <div className="lobby-topbar">
        <button className="rooms-back-btn" onClick={() => router.push('/rooms')}>← Back</button>
        <div className="lobby-title-wrap">
          <h1>Room {roomCode}</h1>
          <p>{isHost ? 'Configure your match and invite players.' : 'Waiting for the host to finish setup.'}</p>
        </div>
        <div className="lobby-status-pill">{gameState.players.length}/{gameState.room.maxPlayers} players</div>
      </div>

      {error && <p className="error-text" style={{ textAlign: 'center', marginBottom: '1rem' }}>{error}</p>}

      <div className="lobby-modern-grid lobby-content">
        <div className="lobby-side-stack">
          <section className="lobby-section lobby-card share-card">
            <h3>Share this room</h3>
            <div className="room-code-display compact">
              <p>Room Code</p>
              <span>{roomCode}</span>
            </div>
            <div className="share-row">
              <input className="input-field share-input" value={`${typeof window !== 'undefined' ? window.location.origin : ''}/lobby/${roomCode}`} readOnly />
              <button className="btn-primary copy-btn" onClick={handleCopyLink}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <p className="share-note">{gameState.room.isPrivate ? 'Private room: only invited players can join.' : 'Public room: also visible in the room browser.'}</p>
          </section>

          <section className="lobby-section lobby-card">
            <h3>Players ({gameState.players.length}/{gameState.room.maxPlayers})</h3>
            <ul className="player-list">
              {gameState.players.map((player) => (
                <li key={player.id} className="player-item game-player-item">
                  <span className="player-avatar">{player.avatar}</span>
                  <span className="player-name">{player.name}</span>
                  {player.userId === gameState.room.hostId && <span className="host-badge">HOST</span>}
                  {isHost && player.userId !== userId && (
                    <button className="btn-danger btn-small" onClick={() => handleKick(player.userId)}>Kick</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="lobby-section lobby-card lobby-preview-panel">
          <div className="preview-header">
            <div>
              <h3>Board Preview</h3>
              <p>{selectedMap?.description || 'Select the map you want to play.'}</p>
            </div>
            <button className="btn-secondary preview-open-btn" onClick={() => setPreviewMap(selectedMap || null)}>
              Preview board
            </button>
          </div>

          <div className="map-hero-card">
            <div className="map-hero-badge">{selectedMap?.name || 'Map'}</div>
            <div className="map-hero-stats">
              <span>{selectedMap?.tileCount || 0} tiles</span>
              <span>{gameState.room.isPrivate ? 'Private room' : 'Public room'}</span>
              <span>${gameState.room.startingCash} start</span>
            </div>
          </div>

          <div className="map-selector modern-map-grid">
            {maps.map((map) => (
              <div key={map.file} className="modern-map-wrap">
                <button
                  className={`map-option modern-map-card ${gameState.room.mapName === map.file ? 'selected' : ''}`}
                  onClick={() => handleSelectMap(map.file)}
                  disabled={!isHost}
                >
                  <div>
                    <h4>{map.name}</h4>
                    <p>{map.description}</p>
                  </div>
                  <div className="map-card-footer">
                    <span>{map.tileCount} tiles</span>
                    <span>{gameState.room.mapName === map.file ? 'Selected' : isHost ? 'Click to select' : 'Host only'}</span>
                  </div>
                </button>
                <div className="map-card-actions below">
                  <button className="btn-secondary btn-small" onClick={() => setPreviewMap(map)}>Preview</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lobby-section lobby-card settings-panel">
          <h3>Game settings {isHost ? '' : '(Host only)'}</h3>

          <div className="setting-block">
            <label>Maximum players</label>
            <div className="max-players-selector">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  className={`max-player-btn ${gameState.room.maxPlayers === n ? 'selected' : ''}`}
                  onClick={() => handleSetMaxPlayers(n)}
                  disabled={!isHost || n < gameState.players.length}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block">
            <label>Starting cash</label>
            <div className="chip-row">
              {STARTING_CASH_OPTIONS.map((cash) => (
                <button
                  key={cash}
                  className={`settings-chip ${gameState.room.startingCash === cash ? 'active' : ''}`}
                  onClick={() => updateRoomSettings({ startingCash: cash })}
                  disabled={!isHost}
                >
                  ${cash}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-list">
            <button className={`settings-toggle ${gameState.room.isPrivate ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ isPrivate: !gameState.room.isPrivate })} disabled={!isHost}>
              <span>Private room</span>
              <strong>{gameState.room.isPrivate ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.randomizeOrder ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ randomizeOrder: !gameState.room.randomizeOrder })} disabled={!isHost}>
              <span>Randomize player order</span>
              <strong>{gameState.room.randomizeOrder ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.doubleRentFullSet ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ doubleRentFullSet: !gameState.room.doubleRentFullSet })} disabled={!isHost}>
              <span>Double rent on full set</span>
              <strong>{gameState.room.doubleRentFullSet ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.mortgageEnabled ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ mortgageEnabled: !gameState.room.mortgageEnabled })} disabled={!isHost}>
              <span>Allow mortgages</span>
              <strong>{gameState.room.mortgageEnabled ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.vacationCashEnabled ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ vacationCashEnabled: !gameState.room.vacationCashEnabled })} disabled={!isHost}>
              <span>Vacation cash on free parking</span>
              <strong>{gameState.room.vacationCashEnabled ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.noRentInJail ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ noRentInJail: !gameState.room.noRentInJail })} disabled={!isHost}>
              <span>No rent while owner is in jail</span>
              <strong>{gameState.room.noRentInJail ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.evenBuildRule ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ evenBuildRule: !gameState.room.evenBuildRule })} disabled={!isHost}>
              <span>Even build across set</span>
              <strong>{gameState.room.evenBuildRule ? 'ON' : 'OFF'}</strong>
            </button>
            <button className={`settings-toggle ${gameState.room.auctionEnabled ? 'enabled' : ''}`} onClick={() => updateRoomSettings({ auctionEnabled: !gameState.room.auctionEnabled })} disabled={!isHost}>
              <span>Auction if buyer skips</span>
              <strong>{gameState.room.auctionEnabled ? 'ON' : 'OFF'}</strong>
            </button>
          </div>

          <div className="lobby-actions">
            {isHost ? (
              <button className="btn-success" onClick={handleStartGame} disabled={gameState.players.length < 2}>
                {gameState.players.length < 2 ? 'Need at least 2 players' : 'Start Game'}
              </button>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>Waiting for host to start the game...</p>
            )}
          </div>
        </section>
      </div>

      {previewMap && (
        <div className="modal-overlay" onClick={() => setPreviewMap(null)}>
          <div className="modal-content map-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-head">
              <div>
                <p className="map-preview-eyebrow">Board Preview</p>
                <h3>{previewMap.name}</h3>
              </div>
              <button className="btn-secondary btn-small" onClick={() => setPreviewMap(null)}>Close preview</button>
            </div>

            <div className="board-preview-grid">
              {Array.from({ length: 121 }, (_, index) => {
                if (index === 60) {
                  return (
                    <div key={index} className="board-preview-center">
                      <div>{previewMap.name}</div>
                      <span>{previewMap.description}</span>
                    </div>
                  );
                }

                const tile = cellMap.get(index);
                return tile ? (
                  <div key={index} className={`preview-tile ${tileClass(tile)}`} title={tile.name}>
                    <span className="preview-tile-name">{tile.name}</span>
                    {tile.price ? <span className="preview-tile-price">${tile.price}</span> : null}
                  </div>
                ) : (
                  <div key={index} className="board-preview-empty" />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
