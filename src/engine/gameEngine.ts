import prisma from '@/lib/prisma';
import { rollDice, DiceResult } from './diceEngine';
import { GameMap, MapTile, calculateRent, CardData } from './tileEngine';
import { shuffleCards, drawCard } from './cardEngine';
import fs from 'fs';
import path from 'path';

// In-memory state per room for card decks
const roomDecks: Map<string, { luck: CardData[]; chest: CardData[] }> = new Map();

export function loadMap(mapName: string): GameMap {
  const mapPath = path.join(process.cwd(), 'src', 'maps', `${mapName}.json`);
  const data = fs.readFileSync(mapPath, 'utf-8');
  return JSON.parse(data) as GameMap;
}

export function getAvailableMaps(): { name: string; file: string; description: string }[] {
  const mapsDir = path.join(process.cwd(), 'src', 'maps');
  const files = fs.readdirSync(mapsDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(mapsDir, f), 'utf-8'));
    return { name: data.name, file: f.replace('.json', ''), description: data.description };
  });
}

function getOrInitDecks(roomId: string, map: GameMap) {
  if (!roomDecks.has(roomId)) {
    roomDecks.set(roomId, {
      luck: shuffleCards(map.luckCards),
      chest: shuffleCards(map.chestCards),
    });
  }
  return roomDecks.get(roomId)!;
}

export function cleanupRoom(roomId: string) {
  roomDecks.delete(roomId);
}

export interface GameAction {
  type: string;
  playerId: string;
  data: Record<string, unknown>;
}

export async function handleRollDice(roomId: string, playerId: string): Promise<{
  dice: DiceResult;
  newPosition: number;
  passedGo: boolean;
  tileAction: string;
  tile: MapTile;
  actions: GameAction[];
}> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new Error('Room not found');

  const gameState = await prisma.gameState.findUnique({ where: { roomId } });
  if (!gameState) throw new Error('Game not started');
  if (gameState.currentTurn !== playerId) throw new Error('Not your turn');
  if (gameState.phase !== 'rolling') throw new Error('Cannot roll now');

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw new Error('Player not found');
  if (player.bankrupt) throw new Error('You are bankrupt');

  const map = loadMap(room.mapName);
  const boardSize = map.tiles.length;

  // If in jail
  if (player.inJail) {
    const dice = rollDice();
    const actions: GameAction[] = [];

    if (dice.isDouble) {
      // Escape jail with doubles
      await prisma.player.update({
        where: { id: playerId },
        data: { inJail: false, jailTurns: 0 },
      });
      const newPosition = (player.position + dice.total) % boardSize;
      const passedGo = player.position + dice.total >= boardSize;
      if (passedGo) {
        await prisma.player.update({
          where: { id: playerId },
          data: { position: newPosition, money: { increment: 200 } },
        });
      } else {
        await prisma.player.update({
          where: { id: playerId },
          data: { position: newPosition },
        });
      }

      await prisma.gameState.update({
        where: { roomId },
        data: { diceValues: JSON.stringify([dice.dice1, dice.dice2]), phase: 'action', doublesCount: 0 },
      });

      const tile = map.tiles[newPosition];
      return { dice, newPosition, passedGo, tileAction: 'escaped_jail', tile, actions };
    } else {
      const newJailTurns = player.jailTurns + 1;
      if (newJailTurns >= 3) {
        // Must pay and leave
        await prisma.player.update({
          where: { id: playerId },
          data: { inJail: false, jailTurns: 0, money: { decrement: 50 } },
        });
        const newPosition = (player.position + dice.total) % boardSize;
        await prisma.player.update({
          where: { id: playerId },
          data: { position: newPosition },
        });
        await prisma.gameState.update({
          where: { roomId },
          data: { diceValues: JSON.stringify([dice.dice1, dice.dice2]), phase: 'action', doublesCount: 0 },
        });
        const tile = map.tiles[newPosition];
        return { dice, newPosition, passedGo: false, tileAction: 'forced_jail_exit', tile, actions };
      } else {
        await prisma.player.update({
          where: { id: playerId },
          data: { jailTurns: newJailTurns },
        });
        await prisma.gameState.update({
          where: { roomId },
          data: { diceValues: JSON.stringify([dice.dice1, dice.dice2]), phase: 'ended_turn', doublesCount: 0 },
        });
        const tile = map.tiles[player.position];
        return { dice, newPosition: player.position, passedGo: false, tileAction: 'still_in_jail', tile, actions };
      }
    }
  }

  // Normal roll
  const dice = rollDice();
  const doublesCount = dice.isDouble ? (gameState.doublesCount + 1) : 0;
  const actions: GameAction[] = [];

  // Three doubles = go to jail
  if (doublesCount >= 3) {
    const jailIndex = map.tiles.findIndex((t) => t.type === 'JAIL');
    await prisma.player.update({
      where: { id: playerId },
      data: { inJail: true, jailTurns: 0, position: jailIndex >= 0 ? jailIndex : 10 },
    });
    await prisma.gameState.update({
      where: { roomId },
      data: {
        diceValues: JSON.stringify([dice.dice1, dice.dice2]),
        phase: 'ended_turn',
        doublesCount: 0,
      },
    });
    const tile = map.tiles[jailIndex >= 0 ? jailIndex : 10];
    return { dice, newPosition: jailIndex >= 0 ? jailIndex : 10, passedGo: false, tileAction: 'go_to_jail', tile, actions };
  }

  const newPosition = (player.position + dice.total) % boardSize;
  const passedGo = player.position + dice.total >= boardSize;

  let moneyChange = 0;
  if (passedGo) {
    moneyChange = 200;
  }

  await prisma.player.update({
    where: { id: playerId },
    data: {
      position: newPosition,
      money: { increment: moneyChange },
    },
  });

  const tile = map.tiles[newPosition];
  let tileAction = '';

  switch (tile.type) {
    case 'GO_TO_JAIL': {
      const jailIndex = map.tiles.findIndex((t) => t.type === 'JAIL');
      await prisma.player.update({
        where: { id: playerId },
        data: { inJail: true, jailTurns: 0, position: jailIndex >= 0 ? jailIndex : 10 },
      });
      tileAction = 'go_to_jail';
      await prisma.gameState.update({
        where: { roomId },
        data: {
          diceValues: JSON.stringify([dice.dice1, dice.dice2]),
          phase: 'ended_turn',
          doublesCount: 0,
        },
      });
      return { dice, newPosition: jailIndex >= 0 ? jailIndex : 10, passedGo, tileAction, tile, actions };
    }
    case 'TAX': {
      const amount = tile.amount || 200;
      await prisma.player.update({
        where: { id: playerId },
        data: { money: { decrement: amount } },
      });
      tileAction = 'pay_tax';
      actions.push({ type: 'tax_paid', playerId, data: { amount } });
      break;
    }
    case 'PROPERTY':
    case 'RAILWAY':
    case 'UTILITY': {
      tileAction = 'property_action';
      break;
    }
    case 'LUCK': {
      tileAction = 'draw_luck';
      break;
    }
    case 'CHEST': {
      tileAction = 'draw_chest';
      break;
    }
    default:
      tileAction = 'none';
  }

  const phase = dice.isDouble ? 'rolling' : 'action';
  await prisma.gameState.update({
    where: { roomId },
    data: {
      diceValues: JSON.stringify([dice.dice1, dice.dice2]),
      phase,
      doublesCount,
    },
  });

  return { dice, newPosition, passedGo, tileAction, tile, actions };
}

export async function handleBuyProperty(roomId: string, playerId: string, tileIndex: number) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new Error('Room not found');

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw new Error('Player not found');

  const map = loadMap(room.mapName);
  const tile = map.tiles[tileIndex];

  if (!tile || !tile.price) throw new Error('Cannot buy this tile');

  // Check if already owned
  const existing = await prisma.property.findFirst({
    where: { roomId, tileIndex },
  });
  if (existing?.ownerId) throw new Error('Property already owned');

  if (player.money < tile.price) throw new Error('Not enough money');

  await prisma.player.update({
    where: { id: playerId },
    data: { money: { decrement: tile.price } },
  });

  if (existing) {
    await prisma.property.update({
      where: { id: existing.id },
      data: { ownerId: playerId },
    });
  } else {
    await prisma.property.create({
      data: {
        tileIndex,
        name: tile.name,
        price: tile.price,
        rent: tile.rent || 0,
        ownerId: playerId,
        roomId,
      },
    });
  }

  return { property: tile.name, cost: tile.price };
}

export async function handlePayRent(roomId: string, payerId: string, tileIndex: number, diceTotal: number) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new Error('Room not found');

  const property = await prisma.property.findFirst({
    where: { roomId, tileIndex },
  });
  if (!property || !property.ownerId) return { rent: 0 };
  if (property.ownerId === payerId) return { rent: 0 };
  if (property.mortgaged) return { rent: 0 };

  const map = loadMap(room.mapName);
  const tile = map.tiles[tileIndex];

  // Count owned in group for railways/utilities/monopoly
  let ownedInGroup = 1;
  let totalInGroup = 1;

  if (tile.group) {
    const groupTiles = map.tiles
      .map((t, i) => ({ ...t, index: i }))
      .filter((t) => t.group === tile.group);
    totalInGroup = groupTiles.length;

    const groupProperties = await prisma.property.findMany({
      where: {
        roomId,
        tileIndex: { in: groupTiles.map((t) => t.index) },
        ownerId: property.ownerId,
      },
    });
    ownedInGroup = groupProperties.length;
  } else if (tile.type === 'RAILWAY') {
    const railTiles = map.tiles
      .map((t, i) => ({ ...t, index: i }))
      .filter((t) => t.type === 'RAILWAY');
    const railProps = await prisma.property.findMany({
      where: {
        roomId,
        tileIndex: { in: railTiles.map((t) => t.index) },
        ownerId: property.ownerId,
      },
    });
    ownedInGroup = railProps.length;
  } else if (tile.type === 'UTILITY') {
    const utilTiles = map.tiles
      .map((t, i) => ({ ...t, index: i }))
      .filter((t) => t.type === 'UTILITY');
    const utilProps = await prisma.property.findMany({
      where: {
        roomId,
        tileIndex: { in: utilTiles.map((t) => t.index) },
        ownerId: property.ownerId,
      },
    });
    ownedInGroup = utilProps.length;
  }

  const rentAmount = calculateRent(
    property.rent,
    property.level,
    tile.type,
    ownedInGroup,
    totalInGroup,
    diceTotal
  );

  await prisma.player.update({
    where: { id: payerId },
    data: { money: { decrement: rentAmount } },
  });

  await prisma.player.update({
    where: { id: property.ownerId },
    data: { money: { increment: rentAmount } },
  });

  return { rent: rentAmount, ownerId: property.ownerId };
}

export async function handleDrawCard(roomId: string, playerId: string, cardType: 'luck' | 'chest') {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new Error('Room not found');

  const map = loadMap(room.mapName);
  const decks = getOrInitDecks(roomId, map);

  const deck = cardType === 'luck' ? decks.luck : decks.chest;
  if (deck.length === 0) {
    // Reshuffle
    const source = cardType === 'luck' ? map.luckCards : map.chestCards;
    const reshuffled = shuffleCards(source);
    if (cardType === 'luck') decks.luck = reshuffled;
    else decks.chest = reshuffled;
  }

  const { card, remainingCards } = drawCard(cardType === 'luck' ? decks.luck : decks.chest);
  if (cardType === 'luck') decks.luck = remainingCards;
  else decks.chest = remainingCards;

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw new Error('Player not found');

  let resultData: Record<string, unknown> = { card };

  switch (card.action) {
    case 'gain_money':
      await prisma.player.update({
        where: { id: playerId },
        data: { money: { increment: card.value || 0 } },
      });
      break;
    case 'lose_money':
      await prisma.player.update({
        where: { id: playerId },
        data: { money: { decrement: card.value || 0 } },
      });
      break;
    case 'move_to': {
      const targetPos = card.value || 0;
      const passedGo = targetPos < player.position;
      await prisma.player.update({
        where: { id: playerId },
        data: {
          position: targetPos,
          money: passedGo ? { increment: 200 } : undefined,
        },
      });
      resultData.newPosition = targetPos;
      resultData.passedGo = passedGo;
      break;
    }
    case 'move_back': {
      const boardSize = map.tiles.length;
      const newPos = (player.position - (card.value || 0) + boardSize) % boardSize;
      await prisma.player.update({
        where: { id: playerId },
        data: { position: newPos },
      });
      resultData.newPosition = newPos;
      break;
    }
    case 'go_to_jail': {
      const jailIndex = map.tiles.findIndex((t) => t.type === 'JAIL');
      await prisma.player.update({
        where: { id: playerId },
        data: { inJail: true, jailTurns: 0, position: jailIndex >= 0 ? jailIndex : 10 },
      });
      resultData.newPosition = jailIndex >= 0 ? jailIndex : 10;
      break;
    }
    case 'jail_card':
      await prisma.player.update({
        where: { id: playerId },
        data: { jailCards: { increment: 1 } },
      });
      break;
    case 'pay_each_player': {
      const otherPlayers = await prisma.player.findMany({
        where: { roomId, id: { not: playerId }, bankrupt: false },
      });
      const totalCost = (card.value || 0) * otherPlayers.length;
      await prisma.player.update({
        where: { id: playerId },
        data: { money: { decrement: totalCost } },
      });
      for (const other of otherPlayers) {
        await prisma.player.update({
          where: { id: other.id },
          data: { money: { increment: card.value || 0 } },
        });
      }
      break;
    }
  }

  return resultData;
}

export async function handlePayJailFine(roomId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || !player.inJail) throw new Error('Player is not in jail');
  if (player.money < 50) throw new Error('Not enough money');

  await prisma.player.update({
    where: { id: playerId },
    data: { inJail: false, jailTurns: 0, money: { decrement: 50 } },
  });

  return { paid: 50 };
}

export async function handleUseJailCard(roomId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || !player.inJail) throw new Error('Player is not in jail');
  if (player.jailCards <= 0) throw new Error('No jail cards');

  await prisma.player.update({
    where: { id: playerId },
    data: { inJail: false, jailTurns: 0, jailCards: { decrement: 1 } },
  });

  return { usedCard: true };
}

export async function handleUpgradeProperty(roomId: string, playerId: string, tileIndex: number) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new Error('Room not found');

  const property = await prisma.property.findFirst({
    where: { roomId, tileIndex, ownerId: playerId },
  });
  if (!property) throw new Error('You do not own this property');
  if (property.level >= 5) throw new Error('Already at max level');

  const map = loadMap(room.mapName);
  const tile = map.tiles[tileIndex];

  // Check if player owns all properties in group
  if (tile.group) {
    const groupTiles = map.tiles
      .map((t, i) => ({ ...t, index: i }))
      .filter((t) => t.group === tile.group);
    const ownedInGroup = await prisma.property.count({
      where: { roomId, tileIndex: { in: groupTiles.map((t) => t.index) }, ownerId: playerId },
    });
    if (ownedInGroup < groupTiles.length) {
      throw new Error('Must own all properties in group to upgrade');
    }
  }

  const upgradeCost = Math.floor((tile.price || 0) / 2);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.money < upgradeCost) throw new Error('Not enough money');

  await prisma.player.update({
    where: { id: playerId },
    data: { money: { decrement: upgradeCost } },
  });

  await prisma.property.update({
    where: { id: property.id },
    data: { level: property.level + 1 },
  });

  return { newLevel: property.level + 1, cost: upgradeCost };
}

export async function handleMortgage(roomId: string, playerId: string, tileIndex: number) {
  const property = await prisma.property.findFirst({
    where: { roomId, tileIndex, ownerId: playerId },
  });
  if (!property) throw new Error('You do not own this property');

  if (property.mortgaged) {
    // Unmortgage
    const cost = Math.floor(property.price * 0.55);
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player || player.money < cost) throw new Error('Not enough money to unmortgage');
    await prisma.player.update({
      where: { id: playerId },
      data: { money: { decrement: cost } },
    });
    await prisma.property.update({
      where: { id: property.id },
      data: { mortgaged: false },
    });
    return { mortgaged: false, cost };
  } else {
    const value = Math.floor(property.price / 2);
    await prisma.player.update({
      where: { id: playerId },
      data: { money: { increment: value } },
    });
    await prisma.property.update({
      where: { id: property.id },
      data: { mortgaged: true },
    });
    return { mortgaged: true, value };
  }
}

export async function handleEndTurn(roomId: string, playerId: string) {
  const gameState = await prisma.gameState.findUnique({ where: { roomId } });
  if (!gameState) throw new Error('Game not started');
  if (gameState.currentTurn !== playerId) throw new Error('Not your turn');

  const players = await prisma.player.findMany({
    where: { roomId, bankrupt: false },
    orderBy: { turnOrder: 'asc' },
  });

  if (players.length <= 1) {
    await prisma.gameState.update({
      where: { roomId },
      data: { phase: 'ended' },
    });
    return { nextPlayerId: null, gameEnded: true, winner: players[0] };
  }

  const currentIndex = players.findIndex((p) => p.id === playerId);
  const nextIndex = (currentIndex + 1) % players.length;
  const nextPlayer = players[nextIndex];

  await prisma.gameState.update({
    where: { roomId },
    data: {
      currentTurn: nextPlayer.id,
      phase: 'rolling',
      doublesCount: 0,
      diceValues: '[]',
    },
  });

  // Check for bankruptcy
  const activePlayer = await prisma.player.findUnique({ where: { id: playerId } });
  if (activePlayer && activePlayer.money < 0) {
    await prisma.player.update({
      where: { id: playerId },
      data: { bankrupt: true },
    });
    // Release properties
    await prisma.property.updateMany({
      where: { ownerId: playerId, roomId },
      data: { ownerId: null, level: 0, mortgaged: false },
    });
  }

  return { nextPlayerId: nextPlayer.id, gameEnded: false };
}

export async function getFullGameState(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      players: { include: { user: true }, orderBy: { turnOrder: 'asc' } },
      gameState: true,
      properties: true,
    },
  });

  if (!room) throw new Error('Room not found');

  let map: GameMap | null = null;
  try {
    map = loadMap(room.mapName);
  } catch {
    /* map might not exist yet */
  }

  return {
    room: {
      id: room.id,
      roomCode: room.roomCode,
      hostId: room.hostId,
      status: room.status,
      mapName: room.mapName,
      maxPlayers: room.maxPlayers,
    },
    players: room.players.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user.name,
      position: p.position,
      money: p.money,
      inJail: p.inJail,
      jailTurns: p.jailTurns,
      jailCards: p.jailCards,
      bankrupt: p.bankrupt,
      avatar: p.avatar,
      turnOrder: p.turnOrder,
    })),
    gameState: room.gameState
      ? {
          currentTurn: room.gameState.currentTurn,
          diceValues: JSON.parse(room.gameState.diceValues),
          phase: room.gameState.phase,
          doublesCount: room.gameState.doublesCount,
        }
      : null,
    properties: room.properties.map((p) => ({
      id: p.id,
      tileIndex: p.tileIndex,
      name: p.name,
      price: p.price,
      rent: p.rent,
      ownerId: p.ownerId,
      level: p.level,
      mortgaged: p.mortgaged,
    })),
    map: map
      ? {
          name: map.name,
          description: map.description,
          tiles: map.tiles,
        }
      : null,
  };
}
