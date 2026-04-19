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
  freeParkingPot: number;
}

interface TradeOffer {
  id: string;
  roomId: string;
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  offeredCash: number;
  requestedCash: number;
  offeredTileIndexes: number[];
  requestedTileIndexes: number[];
}

interface FullState {
  room: {
    id: string;
    roomCode: string;
    hostId: string;
    status: string;
    mapName: string;
    maxPlayers: number;
    isPrivate?: boolean;
    startingCash?: number;
    doubleRentFullSet?: boolean;
    auctionEnabled?: boolean;
    mortgageEnabled?: boolean;
    evenBuildRule?: boolean;
    noRentInJail?: boolean;
    vacationCashEnabled?: boolean;
    randomizeOrder?: boolean;
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
  const [showSettings, setShowSettings] = useState(false);
  const [showTradeComposer, setShowTradeComposer] = useState(false);
  const [incomingTrade, setIncomingTrade] = useState<TradeOffer | null>(null);
  const [bankruptConfirm, setBankruptConfirm] = useState(false);
  const [tradeTargetUserId, setTradeTargetUserId] = useState('');
  const [offeredCash, setOfferedCash] = useState(0);
  const [requestedCash, setRequestedCash] = useState(0);
  const [offeredTiles, setOfferedTiles] = useState<number[]>([]);
  const [requestedTiles, setRequestedTiles] = useState<number[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const myPlayer = state?.players.find((p) => p.userId === userId);
  const isMyTurn = state?.gameState?.currentTurn === myPlayer?.id;
  const isHost = state?.room.hostId === userId;
  const tiles = state?.map?.tiles || [];
  const boardSize = tiles.length;
  const myProperties = state?.properties.filter((p) => p.ownerId === myPlayer?.id) || [];
  const otherPlayers = state?.players.filter((p) => p.userId !== userId && !p.bankrupt) || [];
  const tradeTargetPlayer = otherPlayers.find((p) => p.userId === tradeTargetUserId);
  const tradeTargetProperties = state?.properties.filter((p) => p.ownerId === tradeTargetPlayer?.id) || [];
  const currentTurnPlayer = state?.players.find((p) => p.id === state.gameState?.currentTurn) || null;
  const selectedProperty = selectedTile !== null ? state?.properties.find((p) => p.tileIndex === selectedTile) || null : null;
  const selectedPlayers = selectedTile !== null ? state?.players.filter((p) => p.position === selectedTile && !p.bankrupt) || [] : [];

  const getPlayerColor = useCallback((playerId: string) => {
    const idx = state?.players.findIndex((p) => p.id === playerId) ?? -1;
    return PLAYER_COLORS[(idx >= 0 ? idx : 0) % PLAYER_COLORS.length];
  }, [state?.players]);

  const getLevelLabel = (level: number) => {
    if (level <= 0) return 'No houses';
    if (level >= 5) return 'Hotel';
    return `${level} house${level > 1 ? 's' : ''}`;
  };

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

    socket.on('trade_offer_received', (offer: TradeOffer) => {
      setIncomingTrade(offer);
      showNotify(`Trade offer received from ${offer.fromName}`);
    });

    socket.on('trade_completed', (offer: TradeOffer) => {
      showNotify(`Trade completed: ${offer.fromName} ↔ ${offer.toName}`);
      setIncomingTrade(null);
    });

    socket.on('trade_declined', () => {
      showNotify('Trade offer declined');
      setIncomingTrade(null);
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
      socket.off('trade_offer_received');
      socket.off('trade_completed');
      socket.off('trade_declined');
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

  const handleDowngrade = useCallback((tileIndex: number) => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('downgrade_property', { roomId, tileIndex }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot downgrade');
      else showNotify('Property downgraded');
    });
  }, [showNotify]);

  const handleFileBankruptcy = useCallback(() => {
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('file_bankruptcy', { roomId }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Cannot file bankruptcy');
      setBankruptConfirm(false);
    });
  }, [showNotify]);

  const toggleTradeSelection = useCallback((tileIndex: number, side: 'offered' | 'requested') => {
    const setter = side === 'offered' ? setOfferedTiles : setRequestedTiles;
    setter((prev) => prev.includes(tileIndex) ? prev.filter((t) => t !== tileIndex) : [...prev, tileIndex]);
  }, []);

  const handleCreateTrade = useCallback(() => {
    if (!tradeTargetUserId) {
      showNotify('Choose a player to trade with');
      return;
    }
    const socket = getSocket();
    const roomId = sessionStorage.getItem('roomId');
    socket.emit('create_trade_offer', {
      roomId,
      targetUserId: tradeTargetUserId,
      offeredCash,
      requestedCash,
      offeredTileIndexes: offeredTiles,
      requestedTileIndexes: requestedTiles,
    }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Failed to create trade');
      else {
        showNotify('Trade offer sent');
        setShowTradeComposer(false);
        setTradeTargetUserId('');
        setOfferedCash(0);
        setRequestedCash(0);
        setOfferedTiles([]);
        setRequestedTiles([]);
      }
    });
  }, [tradeTargetUserId, offeredCash, requestedCash, offeredTiles, requestedTiles, showNotify]);

  const respondToTrade = useCallback((accept: boolean) => {
    if (!incomingTrade) return;
    const socket = getSocket();
    socket.emit('respond_trade_offer', { offerId: incomingTrade.id, accept }, (res: { success: boolean; error?: string }) => {
      if (!res.success) showNotify(res.error || 'Could not respond to trade');
      else if (!accept) setIncomingTrade(null);
    });
  }, [incomingTrade, showNotify]);

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
    <div className="game-container glass-game-layout">
      <div className="left-game-panel side-panel left-panel">
        <div className="panel-section glass-card share-box">
          <h3>Share this game</h3>
          <div className="share-row compact">
            <input
              className="input-field share-input"
              readOnly
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/lobby/${roomCode}`}
            />
            <button className="btn-primary btn-small" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/lobby/${roomCode}`)}>
              Copy
            </button>
          </div>
          <button className="btn-secondary btn-small" onClick={() => setShowSettings(true)}>
            View room settings
          </button>
        </div>

        <div className="panel-section chat-panel glass-card">
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
              placeholder="Say something..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              maxLength={200}
            />
            <button onClick={handleChat}>➤</button>
          </div>
        </div>
      </div>

      <div className="board-area">
        <div className="board glass-board">
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

            const playersOnTile = state.players.filter((p) => p.position === index && !p.bankrupt);

            const isCurrentTurnTile = playersOnTile.some((p) => p.id === state.gameState?.currentTurn);
            const isMyTile = myPlayer?.position === index;

            return (
              <div
                key={index}
                className={`tile tile-${pos.edge} ${isCorner ? 'tile-corner' : ''} ${selectedTile === index ? 'tile-selected' : ''} ${isCurrentTurnTile ? 'tile-turn-focus' : ''} ${isMyTile ? 'tile-my-position' : ''}`}
                style={{ gridRow: pos.row, gridColumn: pos.col }}
                onClick={() => setSelectedTile(index)}
              >
                {tile.color && <div className="tile-color-bar" style={{ background: tile.color }} />}
                <span className="tile-icon">{TILE_ICONS[tile.type] || ''}</span>
                <span className="tile-name">{tile.name}</span>
                {tile.price && <span className="tile-price">${tile.price}</span>}
                {ownerColor && <div className="tile-owner-bar" style={{ background: ownerColor }} />}

                {playersOnTile.length > 0 && (
                  <div className="tile-players better-token-stack">
                    {playersOnTile.slice(0, 4).map((p) => (
                      <div
                        key={p.id}
                        className={`player-token ${state.gameState?.currentTurn === p.id ? 'current' : ''} ${p.userId === userId ? 'self' : ''}`}
                        style={{ background: getPlayerColor(p.id) }}
                        title={`${p.name} • ${tile.name}`}
                      >
                        <span className="token-avatar">{p.avatar}</span>
                        <span className="token-seat">{p.name.slice(0, 1).toUpperCase()}</span>
                      </div>
                    ))}
                    {playersOnTile.length > 4 && <div className="player-count-badge">+{playersOnTile.length - 4}</div>}
                  </div>
                )}
              </div>
            );
          })}

          <div className="board-center glass-center-panel">
            <div className="center-status-row">
              <span className="center-badge">{state.map.name}</span>
              <span className="center-badge">Vacation pot: ${state.gameState?.freeParkingPot ?? 0}</span>
            </div>

            <div className="dice-display center-dice-display">
              <div className={`die ${diceRolling ? 'rolling' : ''}`}>
                {state.gameState?.diceValues[0] || '?'}
              </div>
              <div className={`die ${diceRolling ? 'rolling' : ''}`}>
                {state.gameState?.diceValues[1] || '?'}
              </div>
            </div>

            <p className="center-turn-label">
              {myPlayer?.bankrupt
                ? 'You are bankrupt.'
                : isMyTurn
                  ? `Your turn • ${tiles[myPlayer?.position ?? 0]?.name || 'Move time'}`
                  : `Waiting for ${currentTurnPlayer?.name || 'player'} • ${tiles[currentTurnPlayer?.position ?? 0]?.name || 'On board'}`}
            </p>

            <div className="center-actions game-controls">
              {canRoll && <button className="btn-primary" onClick={handleRollDice}>🎲 Roll Dice</button>}
              {isMyTurn && myPlayer?.inJail && state.gameState?.phase === 'rolling' && (
                <>
                  <button className="btn-primary" onClick={handleRollDice}>🎲 Roll for Doubles</button>
                  <button className="btn-secondary" onClick={handlePayJailFine}>Pay $50 Fine</button>
                  {myPlayer.jailCards > 0 && <button className="btn-secondary" onClick={handleUseJailCard}>Use Jail Card</button>}
                </>
              )}
              {canBuy && <button className="btn-success" onClick={handleBuyProperty}>🏠 Buy for ${currentTile?.price}</button>}
              {mustPayRent && <button className="btn-danger" onClick={handlePayRent}>💸 Pay Rent</button>}
              {canEndTurn && <button className="btn-secondary" onClick={handleEndTurn}>⏩ End Turn</button>}
            </div>

            {selectedTile !== null && tiles[selectedTile] && (() => {
              const selectedProp = state.properties.find((p) => p.tileIndex === selectedTile);
              const selectedOwner = selectedProp?.ownerId ? state.players.find((p) => p.id === selectedProp.ownerId) : null;
              return (
                <div className="tile-glass-card property-popover-card">
                  <div className="tile-glass-head">
                    <div>
                      <h4>{tiles[selectedTile].name}</h4>
                      <p className="tile-popover-subtitle">
                        {tiles[selectedTile].type}
                        {tiles[selectedTile].group ? ` • ${tiles[selectedTile].group}` : ''}
                        {tiles[selectedTile].price ? ` • $${tiles[selectedTile].price}` : ''}
                      </p>
                    </div>
                    <button className="icon-close-btn" onClick={() => setSelectedTile(null)} aria-label="Close property details">✕</button>
                  </div>

                  <div className="occupant-chip-row">
                    {selectedPlayers.length > 0 ? selectedPlayers.map((player) => (
                      <span
                        key={player.id}
                        className="occupant-chip"
                        style={{ borderColor: getPlayerColor(player.id) }}
                      >
                        <span>{player.avatar}</span>
                        {player.name}
                      </span>
                    )) : <span className="muted-help">No player on this tile</span>}
                  </div>

                  {selectedProp ? (
                    <>
                      <div className="property-inline-grid">
                        <span>Owner</span><strong>{selectedOwner?.name || 'Unowned'}</strong>
                        <span>Base rent</span><strong>${selectedProp.rent}</strong>
                        <span>Level</span><strong>{getLevelLabel(selectedProp.level)}</strong>
                        <span>Upgrade cost</span><strong>${Math.floor(selectedProp.price / 2)}</strong>
                        <span>Status</span><strong>{selectedProp.mortgaged ? 'Mortgaged' : 'Active'}</strong>
                      </div>

                      <div className="property-level-dots popover-levels">
                        {[1, 2, 3, 4].map((l) => (
                          <div key={l} className={`level-dot ${selectedProp.level >= l ? 'active' : ''}`} />
                        ))}
                        <div className={`level-dot hotel ${selectedProp.level >= 5 ? 'active' : ''}`} />
                      </div>

                      {selectedProp.ownerId === myPlayer?.id && (
                        <div className="property-inline-actions">
                          {selectedProp.level < 5 && !selectedProp.mortgaged && <button className="btn-success btn-small" onClick={() => handleUpgrade(selectedTile)}>Upgrade</button>}
                          {selectedProp.level > 0 && !selectedProp.mortgaged && <button className="btn-secondary btn-small" onClick={() => handleDowngrade(selectedTile)}>Downgrade</button>}
                          <button className="btn-secondary btn-small" onClick={() => handleMortgage(selectedTile)}>{selectedProp.mortgaged ? 'Unmortgage' : 'Mortgage'}</button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted-help">This is a special tile. Click players on the right to quickly locate them here.</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="side-panel right-game-panel">
        <div className="panel-section glass-card">
          <div className="section-head-row">
            <h3>Players</h3>
            {!myPlayer?.bankrupt && <button className="btn-danger btn-small" onClick={() => setBankruptConfirm(true)}>Bankrupt</button>}
          </div>
          <div className="game-player-list">
            {state.players.map((player, idx) => (
              <div
                key={player.id}
                className={`game-player-item clickable-player-card ${state.gameState?.currentTurn === player.id ? 'current-turn' : ''} ${player.bankrupt ? 'bankrupt' : ''}`}
                onClick={() => setSelectedTile(player.position)}
              >
                <span className="game-player-avatar" style={{ color: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}>{player.avatar}</span>
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
                  <div className="player-position-text">
                    On {tiles[player.position]?.name || `Tile ${player.position}`}
                  </div>
                </div>
                <div className="player-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn-secondary btn-small" onClick={() => setSelectedTile(player.position)}>Locate</button>
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
              </div>
            ))}
          </div>
        </div>

        <div className="panel-section glass-card">
          <div className="section-head-row">
            <h3>Trades</h3>
            <button className="btn-primary btn-small" onClick={() => setShowTradeComposer(true)}>Create</button>
          </div>
          <p className="muted-help">Create property and cash offers with other active players.</p>
          {incomingTrade && (
            <div className="trade-alert-box">
              <p><strong>{incomingTrade.fromName}</strong> sent you a trade.</p>
              <div className="modal-actions">
                <button className="btn-success btn-small" onClick={() => respondToTrade(true)}>Accept</button>
                <button className="btn-secondary btn-small" onClick={() => respondToTrade(false)}>Decline</button>
              </div>
            </div>
          )}
        </div>

        <div className="panel-section glass-card properties-panel">
          <h3>My properties ({myProperties.length})</h3>
          <div className="property-card-list">
            {myProperties.length === 0 ? (
              <p className="muted-help">Buy properties to manage upgrades, downgrade houses, and mortgages here.</p>
            ) : myProperties.map((prop) => (
              <div key={prop.id} className="property-mini-card">
                <div className="property-mini-top">
                  <strong>{prop.name}</strong>
                  <span>{prop.mortgaged ? 'Mortgaged' : `Lv ${prop.level}`}</span>
                </div>
                <div className="property-mini-actions">
                  <button className="btn-success btn-small" onClick={() => handleUpgrade(prop.tileIndex)} disabled={prop.mortgaged || prop.level >= 5}>＋</button>
                  <button className="btn-secondary btn-small" onClick={() => handleDowngrade(prop.tileIndex)} disabled={prop.mortgaged || prop.level <= 0}>－</button>
                  <button className="btn-secondary btn-small" onClick={() => handleMortgage(prop.tileIndex)}>{prop.mortgaged ? 'Unmortgage' : 'Mortgage'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className="notification">{notification}</div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content settings-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="trade-modal-top settings-modal-top">
              <div>
                <h3>Room settings</h3>
                <p>Current rules and configuration for this match.</p>
              </div>
              <button className="icon-close-btn" onClick={() => setShowSettings(false)} aria-label="Close room settings">✕</button>
            </div>
            <div className="property-details">
              <div className="property-detail-row"><span>Map</span><span>{state.room.mapName}</span></div>
              <div className="property-detail-row"><span>Maximum players</span><span>{state.room.maxPlayers}</span></div>
              <div className="property-detail-row"><span>Private room</span><span>{state.room.isPrivate ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>Starting cash</span><span>${state.room.startingCash ?? 1500}</span></div>
              <div className="property-detail-row"><span>Vacation cash</span><span>{state.room.vacationCashEnabled ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>Double rent full set</span><span>{state.room.doubleRentFullSet ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>Even build rule</span><span>{state.room.evenBuildRule ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>No rent while in jail</span><span>{state.room.noRentInJail ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>Mortgages</span><span>{state.room.mortgageEnabled ? 'On' : 'Off'}</span></div>
              <div className="property-detail-row"><span>Random turn order</span><span>{state.room.randomizeOrder ? 'On' : 'Off'}</span></div>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showTradeComposer && (
        <div className="modal-overlay" onClick={() => setShowTradeComposer(false)}>
          <div className="modal-content trade-modal rich-trade-modal" onClick={(e) => e.stopPropagation()}>
            <div className="trade-modal-top">
              <div>
                <h3>Create Trade</h3>
                <p>Build an offer with cash and properties.</p>
              </div>
              <button className="icon-close-btn" onClick={() => setShowTradeComposer(false)} aria-label="Close trade dialog">✕</button>
            </div>

            <label className="trade-label">Trade with</label>
            <select className="input-field" value={tradeTargetUserId} onChange={(e) => setTradeTargetUserId(e.target.value)}>
              <option value="">Select player</option>
              {otherPlayers.map((player) => (
                <option key={player.userId} value={player.userId}>{player.name}</option>
              ))}
            </select>

            <div className="trade-hero-row">
              <div className="trade-user-pill">
                <span className="trade-user-avatar">{myPlayer?.avatar || '🙂'}</span>
                <div>
                  <strong>{myPlayer?.name || 'You'}</strong>
                  <div className="trade-user-money">${myPlayer?.money ?? 0}</div>
                </div>
              </div>
              <div className="trade-swap-pill">⇄</div>
              <div className="trade-user-pill target">
                <span className="trade-user-avatar">{tradeTargetPlayer?.avatar || '🎯'}</span>
                <div>
                  <strong>{tradeTargetPlayer?.name || 'Choose a player'}</strong>
                  <div className="trade-user-money">${tradeTargetPlayer?.money ?? 0}</div>
                </div>
              </div>
            </div>

            <div className="trade-form-grid">
              <div className="trade-column trade-side-card">
                <h4>You offer</h4>
                <label className="trade-label">Cash</label>
                <input className="input-field" type="number" min={0} max={myPlayer?.money ?? 0} value={offeredCash} onChange={(e) => setOfferedCash(Number(e.target.value || 0))} />
                <input className="trade-cash-range" type="range" min={0} max={Math.max(myPlayer?.money ?? 0, 0)} step={10} value={Math.min(offeredCash, myPlayer?.money ?? 0)} onChange={(e) => setOfferedCash(Number(e.target.value))} />

                <label className="trade-label">Your properties</label>
                <div className="trade-chip-list">
                  {myProperties.length === 0 ? <span className="muted-help">No owned properties yet</span> : myProperties.map((prop) => (
                    <button key={prop.id} type="button" className={`settings-chip trade-property-chip ${offeredTiles.includes(prop.tileIndex) ? 'active' : ''}`} onClick={() => toggleTradeSelection(prop.tileIndex, 'offered')}>
                      <strong>{prop.name}</strong>
                      <span>Lv {prop.level}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="trade-column trade-side-card">
                <h4>You request</h4>
                <label className="trade-label">Cash</label>
                <input className="input-field" type="number" min={0} max={tradeTargetPlayer?.money ?? 0} value={requestedCash} onChange={(e) => setRequestedCash(Number(e.target.value || 0))} />
                <input className="trade-cash-range" type="range" min={0} max={Math.max(tradeTargetPlayer?.money ?? 0, 0)} step={10} value={Math.min(requestedCash, tradeTargetPlayer?.money ?? 0)} onChange={(e) => setRequestedCash(Number(e.target.value))} />

                <label className="trade-label">Requested properties</label>
                <div className="trade-chip-list">
                  {tradeTargetProperties.length === 0 ? <span className="muted-help">Select a player to see their tradeable properties</span> : tradeTargetProperties.map((prop) => (
                    <button key={prop.id} type="button" className={`settings-chip trade-property-chip ${requestedTiles.includes(prop.tileIndex) ? 'active' : ''}`} onClick={() => toggleTradeSelection(prop.tileIndex, 'requested')}>
                      <strong>{prop.name}</strong>
                      <span>Lv {prop.level}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="trade-summary-strip">
              <span>You offer ${offeredCash}</span>
              <span>{offeredTiles.length} properties</span>
              <span>You request ${requestedCash}</span>
              <span>{requestedTiles.length} properties</span>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowTradeComposer(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateTrade}>Send trade</button>
            </div>
          </div>
        </div>
      )}

      {bankruptConfirm && (
        <div className="modal-overlay" onClick={() => setBankruptConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>File bankruptcy</h3>
            <p>You will lose all money and released properties. This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setBankruptConfirm(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleFileBankruptcy}>Bankrupt</button>
            </div>
          </div>
        </div>
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
