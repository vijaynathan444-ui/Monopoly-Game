'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';

interface TileData {
  type: string;
  name: string;
  price?: number;
  rent?: number;
  color?: string;
  group?: string;
  amount?: number;
}

interface PropertyData {
  id: string;
  tileIndex: number;
  name: string;
  price: number;
  rent: number;
  ownerId: string | null;
  level: number;
  mortgaged: boolean;
}

interface PlayerData {
  id: string;
  userId: string;
  name: string;
  position: number;
  money: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
  avatar: string;
  turnOrder: number;
}

interface GameStateData {
  currentTurn: string;
  diceValues: number[];
  phase: string;
  doublesCount: number;
}

interface FullState {
  room: {
    id: string;
    roomCode: string;
    hostId: string;
    status: string;
    mapName: string;
  };
  players: PlayerData[];
  gameState: GameStateData | null;
  properties: PropertyData[];
  map: {
    name: string;
    tiles: TileData[];
  } | null;
}

interface ChatMsg {
  sender: string;
  message: string;
  timestamp: string;
  isSystem?: boolean;
}

interface CardInfo {
  text: string;
  action: string;
  value?: number;
}

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

const TILE_ICONS: Record<string, string> = {
  START: '🏁',
  JAIL: '🔒',
  FREE_PARKING: '🅿️',
  GO_TO_JAIL: '👮',
  TAX: '💰',
  LUCK: '🍀',
  CHEST: '📦',
  RAILWAY: '🚂',
  UTILITY: '💡',
};

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const roomCode = (params?.code ?? '') as string;

  const [state, setState] = useState<FullState | null>(null);
  const [userId, setUserId] = useState('');
  const [diceRolling, setDiceRolling] = useState(false);
  const [notification, setNotification] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [cardModal, setCardModal] = useState<{ type: string; card: CardInfo } | null>(null);
  const [gameOver, setGameOver] = useState<PlayerData | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const myPlayer = state?.players.find((p) => p.userId === userId);
  const isMyTurn = state?.gameState?.currentTurn === myPlayer?.id;
  const isHost = state?.room.hostId === userId;
  const tiles = state?.map?.tiles || [];
  const boardSize = tiles.length;

  // Notification helper
  const showNotify = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3500);
  }, []);

  useEffect(() => {
    const storedUserId = sessionStorage.getItem('userId');
    const storedRoomId = sessionStorage.getItem('roomId');

    if (!storedUserId || !storedRoomId) {
      router.push('/');
      return;
    }
    setUserId(storedUserId);

    const socket = getSocket();

    socket.emit('reconnect_player', {
      roomId: storedRoomId,
      userId: storedUserId,
    }, (res: { success: boolean; state?: FullState; error?: string }) => {
      if (res.success && res.state) {
        setState(res.state);
        // Restore game-over state if game already ended
        if (res.state.gameState?.phase === 'ended') {
          const activePlayers = res.state.players.filter(p => !p.bankrupt);
          if (activePlayers.length === 1) {
            setGameOver(activePlayers[0]);
          }
        }
      } else {
        sessionStorage.clear();
        router.push('/');
      }
    });

    socket.on('game_state_update', (newState: FullState) => {
      setState(newState);
    });

    socket.on('dice_rolled', (data: {
      playerId: string;
      dice: { dice1: number; dice2: number; total: number; isDouble: boolean };
      tileAction: string;
      tile: TileData;
      passedGo: boolean;
    }) => {
      setDiceRolling(true);
      setTimeout(() => setDiceRolling(false), 600);

      if (data.passedGo) {
        showNotify('Passed GO! Collected $200');
      }
      if (data.dice.isDouble) {
        showNotify('Doubles! Roll again!');
      }
      if (data.tileAction === 'go_to_jail') {
        showNotify('Go to Jail!');
      }
    });

    socket.on('property_bought', (data: { playerId: string; property: string; cost: number }) => {
      showNotify(`Property "${data.property}" bought for $${data.cost}`);
    });

    socket.on('rent_paid', (data: { payerId: string; rent: number; ownerId: string }) => {
      showNotify(`Rent of $${data.rent} paid`);
    });

    socket.on('card_drawn', (data: { playerId: string; cardType: string; card: CardInfo }) => {
      setCardModal({ type: data.cardType, card: data.card });
    });

    socket.on('game_ended', (data: { winner: PlayerData }) => {
      setGameOver(data.winner);
    });

    socket.on('chat_message', (msg: ChatMsg) => {
      setChatMessages((prev) => [...prev.slice(-100), msg]);
    });

    socket.on('player_kicked', () => {
      sessionStorage.clear();
      router.push('/');
    });

    socket.on('player_disconnected', (data: { userId: string }) => {
      showNotify('A player disconnected');
    });

    socket.on('player_reconnected', (data: { userId: string }) => {
      showNotify('A player reconnected');
    });

    return () => {
      socket.off('game_state_update');
      socket.off('dice_rolled');
      socket.off('property_bought');
      socket.off('rent_paid');
      socket.off('card_drawn');
      socket.off('game_ended');
      socket.off('chat_message');
      socket.off('player_kicked');
      socket.off('player_disconnected');
      socket.off('player_reconnected');
    };
  }, [router, showNotify]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Build board grid positions
  const getTileGridPosition = useCallback((index: number, total: number) => {
    const perSide = Math.floor(total / 4); // 10 for 40 tiles

    // Bottom row (right to left): indices 0 to perSide (inclusive)
    if (index <= perSide) {
      return { row: 11, col: 11 - index, edge: 'bottom' };
    }
    // Left column (bottom to top): indices perSide+1 to 2*perSide
    if (index <= 2 * perSide) {
      return { row: 11 - (index - perSide), col: 1, edge: 'left' };
    }
    // Top row (left to right): indices 2*perSide+1 to 3*perSide
    if (index <= 3 * perSide) {
      return { row: 1, col: 1 + (index - 2 * perSide), edge: 'top' };
    }
    // Right column (top to bottom): indices 3*perSide+1 to total-1
    return { row: 1 + (index - 3 * perSide), col: 11, edge: 'right' };
  }, []);

  const handleRollDice = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('roll_dice', { roomId }, (res: { success: boolean; tileAction?: string; error?: string }) => {
      if (!res.success) {
        showNotify(res.error || 'Cannot roll');
      } else if (res.tileAction === 'draw_luck') {
        socket.emit('draw_card', { roomId, cardType: 'luck' }, () => {});
      } else if (res.tileAction === 'draw_chest') {
        socket.emit('draw_card', { roomId, cardType: 'chest' }, () => {});
      }
    });
  }, [showNotify]);

  const handleBuyProperty = useCallback(() => {
    if (!myPlayer) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('buy_property', { roomId, tileIndex: myPlayer.position }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot buy');
    });
  }, [myPlayer, showNotify]);

  const handlePayRent = useCallback(() => {
    if (!myPlayer || !state?.gameState) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    const diceTotal = state.gameState.diceValues.reduce((a, b) => a + b, 0);
    socket.emit('pay_rent', { roomId, tileIndex: myPlayer.position, diceTotal }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot pay rent');
    });
  }, [myPlayer, state, showNotify]);

  const handleEndTurn = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('end_turn', { roomId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot end turn');
    });
  }, [showNotify]);

  const handlePayJailFine = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('pay_jail_fine', { roomId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot pay fine');
    });
  }, [showNotify]);

  const handleUseJailCard = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('use_jail_card', { roomId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'No jail cards');
    });
  }, [showNotify]);

  const handleUpgrade = useCallback((tileIndex: number) => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('upgrade_property', { roomId, tileIndex }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot upgrade');
      else showNotify('Property upgraded!');
    });
  }, [showNotify]);

  const handleMortgage = useCallback((tileIndex: number) => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('mortgage_property', { roomId, tileIndex }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot mortgage');
    });
  }, [showNotify]);

  const handleChat = useCallback(() => {
    if (!chatInput.trim()) return;
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('chat_message', { roomId, message: chatInput.trim() });
    setChatInput('');
  }, [chatInput]);

  if (!state || !state.map) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  // Determine current tile data for action buttons
  const currentTile = myPlayer ? tiles[myPlayer.position] : null;
  const currentProperty = myPlayer
    ? state.properties.find((p) => p.tileIndex === myPlayer.position)
    : null;
  const canBuy =
    isMyTurn &&
    currentTile &&
    ['PROPERTY', 'RAILWAY', 'UTILITY'].includes(currentTile.type) &&
    currentProperty &&
    !currentProperty.ownerId &&
    myPlayer &&
    myPlayer.money >= (currentTile.price || 0) &&
    state.gameState?.phase === 'action';
  const mustPayRent =
    isMyTurn &&
    currentProperty?.ownerId &&
    currentProperty.ownerId !== myPlayer?.id &&
    !currentProperty.mortgaged &&
    state.gameState?.phase === 'action';
  const canRoll = isMyTurn && state.gameState?.phase === 'rolling' && !myPlayer?.bankrupt && !myPlayer?.inJail;
  const canEndTurn = isMyTurn && ['action', 'ended_turn'].includes(state.gameState?.phase || '');

  return (
    <div className="game-container">
      {/* Board Area */}
      <div className="board-area">
        <div className="board">
          {tiles.map((tile, index) => {
            const pos = getTileGridPosition(index, boardSize);
            const isCorner =
              index === 0 ||
              index === Math.floor(boardSize / 4) ||
              index === Math.floor(boardSize / 2) ||
              index === Math.floor((3 * boardSize) / 4);

            const prop = state.properties.find((p) => p.tileIndex === index);
            const ownerPlayer = prop?.ownerId
              ? state.players.find((p) => p.id === prop.ownerId)
              : null;
            const ownerColor = ownerPlayer
              ? PLAYER_COLORS[state.players.indexOf(ownerPlayer) % PLAYER_COLORS.length]
              : null;

            const playersOnTile = state.players.filter(
              (p) => p.position === index && !p.bankrupt
            );

            return (
              <div
                key={index}
                className={`tile tile-${pos.edge} ${isCorner ? 'tile-corner' : ''}`}
                style={{
                  gridRow: pos.row,
                  gridColumn: pos.col,
                }}
                onClick={() => setSelectedTile(index)}
              >
                {tile.color && (
                  <div
                    className="tile-color-bar"
                    style={{ background: tile.color }}
                  />
                )}
                <span className="tile-icon">
                  {TILE_ICONS[tile.type] || (tile.type === 'PROPERTY' ? '' : '')}
                </span>
                <span className="tile-name">{tile.name}</span>
                {tile.price && <span className="tile-price">${tile.price}</span>}

                {ownerColor && (
                  <div
                    className="tile-owner-bar"
                    style={{ background: ownerColor }}
                  />
                )}

                {playersOnTile.length > 0 && (
                  <div className="tile-players">
                    {playersOnTile.map((p) => {
                      const pIdx = state.players.indexOf(p);
                      return (
                        <div
                          key={p.id}
                          className="player-token"
                          style={{ background: PLAYER_COLORS[pIdx % PLAYER_COLORS.length] }}
                          title={p.name}
                        >
                          {p.avatar}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Board center */}
          <div className="board-center">
            <h2>{state.map.name}</h2>
            <p>MONOPOLY</p>
          </div>
        </div>
      </div>

      {/* Side Panel */}
      <div className="side-panel">
        {/* Dice Area */}
        <div className="panel-section dice-area">
          <h3>Dice</h3>
          <div className="dice-display">
            <div className={`die ${diceRolling ? 'rolling' : ''}`}>
              {state.gameState?.diceValues[0] || '?'}
            </div>
            <div className={`die ${diceRolling ? 'rolling' : ''}`}>
              {state.gameState?.diceValues[1] || '?'}
            </div>
          </div>
          {state.gameState?.diceValues.length === 2 && (
            <div className="dice-total">
              Total: {state.gameState.diceValues[0] + state.gameState.diceValues[1]}
            </div>
          )}
        </div>

        {/* Game Controls */}
        <div className="panel-section">
          <h3>Actions</h3>
          <div className="game-controls">
            {canRoll && (
              <button className="btn-primary" onClick={handleRollDice}>
                🎲 Roll Dice
              </button>
            )}
            {isMyTurn && myPlayer?.inJail && state.gameState?.phase === 'rolling' && (
              <>
                <button className="btn-primary" onClick={handleRollDice}>
                  🎲 Roll for Doubles
                </button>
                <button className="btn-secondary" onClick={handlePayJailFine}>
                  💰 Pay $50 Fine
                </button>
                {myPlayer.jailCards > 0 && (
                  <button className="btn-secondary" onClick={handleUseJailCard}>
                    🃏 Use Jail Card
                  </button>
                )}
              </>
            )}
            {canBuy && (
              <button className="btn-success" onClick={handleBuyProperty}>
                🏠 Buy ({currentTile?.name} - ${currentTile?.price})
              </button>
            )}
            {mustPayRent && (
              <button className="btn-danger" onClick={handlePayRent} style={{ width: '100%' }}>
                💸 Pay Rent
              </button>
            )}
            {canEndTurn && (
              <button className="btn-secondary" onClick={handleEndTurn}>
                ⏩ End Turn
              </button>
            )}
            {!isMyTurn && !myPlayer?.bankrupt && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                Waiting for other player...
              </p>
            )}
          </div>
        </div>

        {/* Players */}
        <div className="panel-section">
          <h3>Players</h3>
          <div className="game-player-list">
            {state.players.map((player, idx) => (
              <div
                key={player.id}
                className={`game-player-item ${
                  state.gameState?.currentTurn === player.id ? 'current-turn' : ''
                } ${player.bankrupt ? 'bankrupt' : ''}`}
              >
                <span
                  className="game-player-avatar"
                  style={{ color: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}
                >
                  {player.avatar}
                </span>
                <div className="game-player-info">
                  <div className="game-player-name">
                    {player.name}
                    {player.userId === state.room.hostId && ' 👑'}
                    {player.userId === userId && ' (You)'}
                  </div>
                  <div className="game-player-money">
                    ${player.money}
                    {player.inJail && <span className="jail-indicator"> 🔒 Jail</span>}
                    {player.bankrupt && <span style={{ color: 'var(--danger)' }}> 💀 Bankrupt</span>}
                  </div>
                </div>
                {isHost && player.userId !== userId && !player.bankrupt && (
                  <button
                    className="btn-danger btn-small"
                    onClick={() => {
                      const socket = getSocket();
                      const roomId = sessionStorage.getItem('roomId');
                      socket.emit('kick_player', { roomId, targetUserId: player.userId }, () => {});
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Chat */}
        <div className="panel-section chat-panel">
          <h3>Chat</h3>
          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.isSystem ? 'system-msg' : ''}`}>
                {msg.isSystem ? (
                  msg.message
                ) : (
                  <>
                    <span className="chat-sender">{msg.sender}: </span>
                    {msg.message}
                  </>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input-area">
            <input
              type="text"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              maxLength={200}
            />
            <button onClick={handleChat}>Send</button>
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className="notification">{notification}</div>
      )}

      {/* Card Modal */}
      {cardModal && (
        <div className="modal-overlay" onClick={() => setCardModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="card-display">
              <div className="card-type">
                {cardModal.type === 'luck' ? '🍀 Chance' : '📦 Community Chest'}
              </div>
              <div className="card-text">{cardModal.card.text}</div>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setCardModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tile Detail Modal */}
      {selectedTile !== null && tiles[selectedTile] && (
        <div className="modal-overlay" onClick={() => setSelectedTile(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              {tiles[selectedTile].color && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: tiles[selectedTile].color,
                    marginRight: 8,
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {tiles[selectedTile].name}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {tiles[selectedTile].type}
            </p>

            {(() => {
              const prop = state.properties.find((p) => p.tileIndex === selectedTile);
              if (!prop) return null;
              const owner = prop.ownerId
                ? state.players.find((p) => p.id === prop.ownerId)
                : null;
              return (
                <div className="property-details">
                  <div className="property-detail-row">
                    <span>Price</span><span>${prop.price}</span>
                  </div>
                  <div className="property-detail-row">
                    <span>Base Rent</span><span>${prop.rent}</span>
                  </div>
                  <div className="property-detail-row">
                    <span>Owner</span>
                    <span>{owner ? owner.name : 'Unowned'}</span>
                  </div>
                  <div className="property-detail-row">
                    <span>Level</span>
                    <span>{prop.level === 5 ? 'Hotel' : `${prop.level} house(s)`}</span>
                  </div>
                  <div className="property-level-dots">
                    {[1, 2, 3, 4].map((l) => (
                      <div key={l} className={`level-dot ${prop.level >= l ? 'active' : ''}`} />
                    ))}
                    <div className={`level-dot ${prop.level >= 5 ? 'hotel active' : ''}`} />
                  </div>
                  {prop.mortgaged && (
                    <p style={{ color: 'var(--warning)', textAlign: 'center' }}>MORTGAGED</p>
                  )}

                  {/* Action buttons for own properties */}
                  {prop.ownerId === myPlayer?.id && (
                    <div className="modal-actions">
                      {prop.level < 5 && !prop.mortgaged && (
                        <button
                          className="btn-success btn-small"
                          onClick={() => {
                            handleUpgrade(selectedTile);
                            setSelectedTile(null);
                          }}
                        >
                          Upgrade (${Math.floor(prop.price / 2)})
                        </button>
                      )}
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => {
                          handleMortgage(selectedTile);
                          setSelectedTile(null);
                        }}
                      >
                        {prop.mortgaged ? 'Unmortgage' : 'Mortgage'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={() => setSelectedTile(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over */}
      {gameOver && (
        <div className="game-over">
          <div className="game-over-content">
            <h1>🏆 Game Over!</h1>
            <p>{gameOver.name} wins with ${gameOver.money}!</p>
            <button
              className="btn-primary"
              onClick={() => {
                sessionStorage.clear();
                router.push('/');
              }}
            >
              Back to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
