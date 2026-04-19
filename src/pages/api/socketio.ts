import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import type { NextApiRequest, NextApiResponse } from 'next';

import prisma from '@/lib/prisma';
import { generateRoomCode, AVATARS } from '@/lib/utils';
import {
  handleRollDice,
  handleBuyProperty,
  handlePayRent,
  handleDrawCard,
  handlePayJailFine,
  handleUseJailCard,
  handleEndTurn,
  handleUpgradeProperty,
  handleDowngradeProperty,
  handleMortgage,
  handleFileBankruptcy,
  getFullGameState,
  loadMap,
} from '@/engine/gameEngine';

const SOCKET_PORT = 3001;

type TradeOffer = {
  id: string;
  roomId: string;
  fromUserId: string;
  toUserId: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromName: string;
  toName: string;
  offeredCash: number;
  requestedCash: number;
  offeredTileIndexes: number[];
  requestedTileIndexes: number[];
};

const pendingTrades = new Map<string, TradeOffer>();

// Persist across HMR using globalThis (same pattern as Prisma)
const g = globalThis as unknown as {
  __socketIO?: SocketIOServer;
  __socketHttpServer?: ReturnType<typeof createServer>;
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (g.__socketIO) {
    try {
      const engine = (g.__socketIO as any).engine;
      if (engine && typeof engine.clientsCount === 'number') {
        res.status(200).json({ message: 'Socket.IO already running', port: SOCKET_PORT });
        return;
      }
    } catch {}
    // Engine is dead/stale, clean up and reinitialize
    try { g.__socketIO.close(); } catch {}
    g.__socketIO = undefined;
    // Also close the HTTP server so we can re-listen
    try { g.__socketHttpServer?.close(); } catch {}
    g.__socketHttpServer = undefined;
  }

  console.log('Initializing Socket.IO on standalone port', SOCKET_PORT, '...');
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  g.__socketIO = io;
  g.__socketHttpServer = httpServer;

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('create_room', async (data: {
      playerName: string;
      isPrivate?: boolean;
      mapName?: string;
      maxPlayers?: number;
      startingCash?: number;
      doubleRentFullSet?: boolean;
      mortgageEnabled?: boolean;
      noRentInJail?: boolean;
      randomizeOrder?: boolean;
      vacationCashEnabled?: boolean;
    }, callback) => {
      console.log('[create_room] received from', socket.id, 'data:', data);
      try {
        const playerName = (data.playerName || '').trim();
        if (!playerName) { callback({ success: false, error: 'Name is required' }); return; }

        let roomCode = generateRoomCode();
        while (await prisma.room.findUnique({ where: { roomCode } })) {
          roomCode = generateRoomCode();
        }

        const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(data.maxPlayers ?? 6))));
        const startingCash = [1000, 1500, 2000, 2500, 3000].includes(Number(data.startingCash))
          ? Number(data.startingCash)
          : 1500;
        const mapName = typeof data.mapName === 'string' ? data.mapName : 'classic';
        loadMap(mapName);

        const user = await prisma.user.create({
          data: { name: playerName, socketId: socket.id },
        });

        const room = await prisma.room.create({
          data: {
            roomCode,
            hostId: user.id,
            status: 'waiting',
            mapName,
            maxPlayers,
            isPrivate: Boolean(data.isPrivate),
            startingCash,
            doubleRentFullSet: data.doubleRentFullSet !== false,
            mortgageEnabled: data.mortgageEnabled !== false,
            noRentInJail: Boolean(data.noRentInJail),
            vacationCashEnabled: Boolean(data.vacationCashEnabled),
            randomizeOrder: data.randomizeOrder !== false,
          },
        });

        await prisma.player.create({
          data: {
            roomId: room.id,
            userId: user.id,
            avatar: AVATARS[0],
            turnOrder: 0,
            money: startingCash,
          },
        });

        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.userId = user.id;

        const state = await getFullGameState(room.id);
        callback({ success: true, roomCode, roomId: room.id, userId: user.id, state });
        console.log('[create_room] success, roomCode:', roomCode);
      } catch (err) {
        console.error('[create_room] error:', err);
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('join_room', async (data: { playerName: string; roomCode: string }, callback) => {
      try {
        const playerName = (data.playerName || '').trim();
        if (!playerName) { callback({ success: false, error: 'Name is required' }); return; }
        if (!data.roomCode || !data.roomCode.trim()) { callback({ success: false, error: 'Room code is required' }); return; }

        const room = await prisma.room.findUnique({
          where: { roomCode: data.roomCode.toUpperCase() },
          include: { players: true },
        });

        if (!room) { callback({ success: false, error: 'Room not found' }); return; }
        if (room.status !== 'waiting') { callback({ success: false, error: 'Game already started' }); return; }
        if (room.players.length >= room.maxPlayers) { callback({ success: false, error: 'Room is full' }); return; }

        const user = await prisma.user.create({
          data: { name: playerName, socketId: socket.id },
        });

        const roomStartingCash = Number((room as { startingCash?: number }).startingCash ?? 1500);

        await prisma.player.create({
          data: {
            roomId: room.id,
            userId: user.id,
            avatar: AVATARS[room.players.length % AVATARS.length],
            turnOrder: room.players.length,
            money: roomStartingCash,
          },
        });

        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.userId = user.id;

        const state = await getFullGameState(room.id);
        io.to(room.id).emit('game_state_update', state);
        callback({ success: true, roomId: room.id, userId: user.id, state });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('select_map', async (data: { roomId: string; mapName: string }, callback) => {
      try {
        const sd = socket.data;
        const room = await prisma.room.findUnique({ where: { id: data.roomId } });
        if (!room || room.hostId !== sd.userId) {
          callback({ success: false, error: 'Only host can select map' }); return;
        }
        if (room.status !== 'waiting') {
          callback({ success: false, error: 'Map can only be changed before the game starts' }); return;
        }
        loadMap(data.mapName); // validate
        await prisma.room.update({ where: { id: data.roomId }, data: { mapName: data.mapName } });
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('set_max_players', async (data: { roomId: string; maxPlayers: number }, callback) => {
      try {
        const sd = socket.data;
        const room = await prisma.room.findUnique({ where: { id: data.roomId }, include: { players: true } });
        if (!room || room.hostId !== sd.userId) {
          callback({ success: false, error: 'Only host can change settings' }); return;
        }
        if (room.status !== 'waiting') {
          callback({ success: false, error: 'Player count can only be changed before the game starts' }); return;
        }
        const max = Math.floor(data.maxPlayers);
        if (max < 2 || max > 8) {
          callback({ success: false, error: 'Players must be between 2 and 8' }); return;
        }
        if (max < room.players.length) {
          callback({ success: false, error: `Cannot set below current player count (${room.players.length})` }); return;
        }
        await prisma.room.update({ where: { id: data.roomId }, data: { maxPlayers: max } });
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('update_room_settings', async (data: {
      roomId: string;
      isPrivate?: boolean;
      startingCash?: number;
      doubleRentFullSet?: boolean;
      mortgageEnabled?: boolean;
      noRentInJail?: boolean;
      vacationCashEnabled?: boolean;
      randomizeOrder?: boolean;
      evenBuildRule?: boolean;
      auctionEnabled?: boolean;
    }, callback) => {
      try {
        const sd = socket.data;
        const room = await prisma.room.findUnique({ where: { id: data.roomId } });
        if (!room || room.hostId !== sd.userId) {
          callback({ success: false, error: 'Only host can change settings' }); return;
        }
        if (room.status !== 'waiting') {
          callback({ success: false, error: 'Room settings can only be changed before the game starts' }); return;
        }

        const updateData: Record<string, unknown> = {};
        if (typeof data.isPrivate === 'boolean') updateData.isPrivate = data.isPrivate;
        if (typeof data.doubleRentFullSet === 'boolean') updateData.doubleRentFullSet = data.doubleRentFullSet;
        if (typeof data.mortgageEnabled === 'boolean') updateData.mortgageEnabled = data.mortgageEnabled;
        if (typeof data.noRentInJail === 'boolean') updateData.noRentInJail = data.noRentInJail;
        if (typeof data.vacationCashEnabled === 'boolean') updateData.vacationCashEnabled = data.vacationCashEnabled;
        if (typeof data.randomizeOrder === 'boolean') updateData.randomizeOrder = data.randomizeOrder;
        if (typeof data.evenBuildRule === 'boolean') updateData.evenBuildRule = data.evenBuildRule;
        if (typeof data.auctionEnabled === 'boolean') updateData.auctionEnabled = data.auctionEnabled;
        if (typeof data.startingCash === 'number' && [1000, 1500, 2000, 2500, 3000].includes(data.startingCash)) {
          updateData.startingCash = data.startingCash;
          await prisma.player.updateMany({ where: { roomId: data.roomId }, data: { money: data.startingCash } });
        }

        await prisma.room.update({ where: { id: data.roomId }, data: updateData });
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('start_game', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const room = await prisma.room.findUnique({
          where: { id: data.roomId },
          include: { players: true },
        });
        if (!room) { callback({ success: false, error: 'Room not found' }); return; }
        if (room.hostId !== sd.userId) { callback({ success: false, error: 'Only host can start' }); return; }
        if (room.players.length < 2) { callback({ success: false, error: 'Need at least 2 players' }); return; }

        const map = loadMap(room.mapName);
        for (let i = 0; i < map.tiles.length; i++) {
          const tile = map.tiles[i];
          if (['PROPERTY', 'RAILWAY', 'UTILITY'].includes(tile.type) && tile.price) {
            await prisma.property.create({
              data: { tileIndex: i, name: tile.name, price: tile.price, rent: tile.rent || 0, roomId: room.id },
            });
          }
        }

        const roomStartingCash = Number((room as { startingCash?: number }).startingCash ?? 1500);
        const shouldRandomizeOrder = Boolean((room as { randomizeOrder?: boolean }).randomizeOrder);

        await prisma.player.updateMany({ where: { roomId: room.id }, data: { money: roomStartingCash } });

        let orderedPlayers = [...room.players].sort((a, b) => a.turnOrder - b.turnOrder);
        if (shouldRandomizeOrder) {
          orderedPlayers = [...orderedPlayers].sort(() => Math.random() - 0.5);
          await Promise.all(
            orderedPlayers.map((player, index) =>
              prisma.player.update({ where: { id: player.id }, data: { turnOrder: index } })
            )
          );
        }

        const firstPlayer = orderedPlayers[0];
        await prisma.gameState.create({
          data: { roomId: room.id, currentTurn: firstPlayer.id, phase: 'rolling', freeParkingPot: 0 },
        });
        await prisma.room.update({ where: { id: data.roomId }, data: { status: 'playing' } });

        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_started', state);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('roll_dice', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }

        const result = await handleRollDice(data.roomId, player.id);
        const state = await getFullGameState(data.roomId);

        io.to(data.roomId).emit('dice_rolled', {
          playerId: player.id,
          dice: result.dice,
          newPosition: result.newPosition,
          tileAction: result.tileAction,
          tile: result.tile,
          passedGo: result.passedGo,
        });
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('buy_property', async (data: { roomId: string; tileIndex: number }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }

        const result = await handleBuyProperty(data.roomId, player.id, data.tileIndex);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('property_bought', { playerId: player.id, ...result });
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('pay_rent', async (data: { roomId: string; tileIndex: number; diceTotal?: number }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }

        // Compute diceTotal server-side from stored game state
        const gameState = await prisma.gameState.findUnique({ where: { roomId: data.roomId } });
        let diceTotal = 0;
        if (gameState?.diceValues) {
          try {
            const dv = JSON.parse(gameState.diceValues);
            if (Array.isArray(dv)) diceTotal = dv.reduce((a: number, b: number) => a + b, 0);
          } catch { /* use 0 */ }
        }

        const result = await handlePayRent(data.roomId, player.id, data.tileIndex, diceTotal);
        const state = await getFullGameState(data.roomId);
        if (result.rent > 0) {
          io.to(data.roomId).emit('rent_paid', { payerId: player.id, ...result });
        }
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('draw_card', async (data: { roomId: string; cardType: 'luck' | 'chest' }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }

        const result = await handleDrawCard(data.roomId, player.id, data.cardType);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('card_drawn', { playerId: player.id, cardType: data.cardType, ...result });
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('pay_jail_fine', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        await handlePayJailFine(data.roomId, player.id);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('use_jail_card', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        await handleUseJailCard(data.roomId, player.id);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('upgrade_property', async (data: { roomId: string; tileIndex: number }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        const result = await handleUpgradeProperty(data.roomId, player.id, data.tileIndex);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('mortgage_property', async (data: { roomId: string; tileIndex: number }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        const result = await handleMortgage(data.roomId, player.id, data.tileIndex);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('downgrade_property', async (data: { roomId: string; tileIndex: number }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        const result = await handleDowngradeProperty(data.roomId, player.id, data.tileIndex);
        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('create_trade_offer', async (data: {
      roomId: string;
      targetUserId: string;
      offeredCash?: number;
      requestedCash?: number;
      offeredTileIndexes?: number[];
      requestedTileIndexes?: number[];
    }, callback) => {
      try {
        const sd = socket.data;
        const fromPlayer = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
          include: { user: true },
        });
        const toPlayer = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: data.targetUserId },
          include: { user: true },
        });
        if (!fromPlayer || !toPlayer) { callback({ success: false, error: 'Players not found' }); return; }
        if (fromPlayer.userId === toPlayer.userId) { callback({ success: false, error: 'Choose another player' }); return; }

        const offeredCash = Math.max(0, Math.floor(Number(data.offeredCash ?? 0)));
        const requestedCash = Math.max(0, Math.floor(Number(data.requestedCash ?? 0)));
        const offeredTileIndexes = Array.isArray(data.offeredTileIndexes) ? data.offeredTileIndexes : [];
        const requestedTileIndexes = Array.isArray(data.requestedTileIndexes) ? data.requestedTileIndexes : [];

        if (fromPlayer.money < offeredCash) { callback({ success: false, error: 'Not enough cash to offer' }); return; }

        const offeredProps = await prisma.property.findMany({
          where: { roomId: data.roomId, tileIndex: { in: offeredTileIndexes }, ownerId: fromPlayer.id },
        });
        const requestedProps = await prisma.property.findMany({
          where: { roomId: data.roomId, tileIndex: { in: requestedTileIndexes }, ownerId: toPlayer.id },
        });
        if (offeredProps.length !== offeredTileIndexes.length || requestedProps.length !== requestedTileIndexes.length) {
          callback({ success: false, error: 'Trade includes invalid properties' }); return;
        }

        const offer: TradeOffer = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId: data.roomId,
          fromUserId: fromPlayer.userId,
          toUserId: toPlayer.userId,
          fromPlayerId: fromPlayer.id,
          toPlayerId: toPlayer.id,
          fromName: fromPlayer.user.name,
          toName: toPlayer.user.name,
          offeredCash,
          requestedCash,
          offeredTileIndexes,
          requestedTileIndexes,
        };

        pendingTrades.set(offer.id, offer);
        io.to(data.roomId).emit('chat_message', {
          sender: 'System',
          message: `${offer.fromName} sent a trade offer to ${offer.toName}`,
          timestamp: new Date().toISOString(),
          isSystem: true,
        });

        const targetUser = await prisma.user.findUnique({ where: { id: data.targetUserId } });
        if (targetUser?.socketId) {
          io.to(targetUser.socketId).emit('trade_offer_received', offer);
        }

        callback({ success: true, offer });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('respond_trade_offer', async (data: { offerId: string; accept: boolean }, callback) => {
      try {
        const offer = pendingTrades.get(data.offerId);
        if (!offer) { callback({ success: false, error: 'Trade offer expired' }); return; }
        if (socket.data.userId !== offer.toUserId) { callback({ success: false, error: 'Only the target player can respond' }); return; }

        if (!data.accept) {
          pendingTrades.delete(offer.id);
          io.to(offer.roomId).emit('chat_message', {
            sender: 'System',
            message: `${offer.toName} declined the trade offer from ${offer.fromName}`,
            timestamp: new Date().toISOString(),
            isSystem: true,
          });
          io.to(offer.roomId).emit('trade_declined', offer);
          callback({ success: true });
          return;
        }

        const fromPlayer = await prisma.player.findUnique({ where: { id: offer.fromPlayerId } });
        const toPlayer = await prisma.player.findUnique({ where: { id: offer.toPlayerId } });
        if (!fromPlayer || !toPlayer) { callback({ success: false, error: 'Players unavailable' }); return; }
        if (fromPlayer.money < offer.offeredCash || toPlayer.money < offer.requestedCash) {
          callback({ success: false, error: 'One player no longer has enough cash' }); return;
        }

        const offeredProps = await prisma.property.findMany({
          where: { roomId: offer.roomId, tileIndex: { in: offer.offeredTileIndexes }, ownerId: offer.fromPlayerId },
        });
        const requestedProps = await prisma.property.findMany({
          where: { roomId: offer.roomId, tileIndex: { in: offer.requestedTileIndexes }, ownerId: offer.toPlayerId },
        });
        if (offeredProps.length !== offer.offeredTileIndexes.length || requestedProps.length !== offer.requestedTileIndexes.length) {
          callback({ success: false, error: 'Trade ownership changed' }); return;
        }

        if (offer.offeredCash > 0) {
          await prisma.player.update({ where: { id: offer.fromPlayerId }, data: { money: { decrement: offer.offeredCash } } });
          await prisma.player.update({ where: { id: offer.toPlayerId }, data: { money: { increment: offer.offeredCash } } });
        }
        if (offer.requestedCash > 0) {
          await prisma.player.update({ where: { id: offer.toPlayerId }, data: { money: { decrement: offer.requestedCash } } });
          await prisma.player.update({ where: { id: offer.fromPlayerId }, data: { money: { increment: offer.requestedCash } } });
        }

        if (offer.offeredTileIndexes.length > 0) {
          await prisma.property.updateMany({
            where: { roomId: offer.roomId, tileIndex: { in: offer.offeredTileIndexes }, ownerId: offer.fromPlayerId },
            data: { ownerId: offer.toPlayerId },
          });
        }
        if (offer.requestedTileIndexes.length > 0) {
          await prisma.property.updateMany({
            where: { roomId: offer.roomId, tileIndex: { in: offer.requestedTileIndexes }, ownerId: offer.toPlayerId },
            data: { ownerId: offer.fromPlayerId },
          });
        }

        pendingTrades.delete(offer.id);
        const state = await getFullGameState(offer.roomId);
        io.to(offer.roomId).emit('trade_completed', offer);
        io.to(offer.roomId).emit('chat_message', {
          sender: 'System',
          message: `Trade completed between ${offer.fromName} and ${offer.toName}`,
          timestamp: new Date().toISOString(),
          isSystem: true,
        });
        io.to(offer.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('file_bankruptcy', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }

        const result = await handleFileBankruptcy(data.roomId, player.id);
        const state = await getFullGameState(data.roomId);
        if (result.gameEnded && result.winner) {
          io.to(data.roomId).emit('game_ended', { winner: result.winner });
        }
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('end_turn', async (data: { roomId: string }, callback) => {
      try {
        const sd = socket.data;
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: sd.userId as string },
        });
        if (!player) { callback({ success: false, error: 'Player not found' }); return; }
        const result = await handleEndTurn(data.roomId, player.id);
        const state = await getFullGameState(data.roomId);
        if (result.gameEnded) {
          io.to(data.roomId).emit('game_ended', { winner: result.winner });
        }
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true, ...result });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('kick_player', async (data: { roomId: string; targetUserId: string }, callback) => {
      try {
        const sd = socket.data;
        const room = await prisma.room.findUnique({ where: { id: data.roomId } });
        if (!room || room.hostId !== sd.userId) {
          callback({ success: false, error: 'Only host can kick players' }); return;
        }
        if (data.targetUserId === sd.userId) {
          callback({ success: false, error: 'Cannot kick yourself' }); return;
        }

        const targetPlayer = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: data.targetUserId },
        });
        if (!targetPlayer) { callback({ success: false, error: 'Player not found' }); return; }

        // If kicked player has the active turn, advance to next player
        const gameState = await prisma.gameState.findUnique({ where: { roomId: data.roomId } });
        if (gameState && gameState.currentTurn === targetPlayer.id) {
          const activePlayers = await prisma.player.findMany({
            where: { roomId: data.roomId, bankrupt: false, id: { not: targetPlayer.id } },
            orderBy: { turnOrder: 'asc' },
          });
          if (activePlayers.length > 0) {
            const kickedOrder = targetPlayer.turnOrder;
            const nextPlayer = activePlayers.find(p => p.turnOrder > kickedOrder) || activePlayers[0];
            await prisma.gameState.update({
              where: { roomId: data.roomId },
              data: { currentTurn: nextPlayer.id, phase: 'rolling', doublesCount: 0, diceValues: '[]' },
            });
          }
        }

        await prisma.property.updateMany({
          where: { ownerId: targetPlayer.id, roomId: data.roomId },
          data: { ownerId: null, level: 0, mortgaged: false },
        });
        await prisma.player.delete({ where: { id: targetPlayer.id } });

        const targetUser = await prisma.user.findUnique({ where: { id: data.targetUserId } });
        if (targetUser?.socketId) {
          io.to(targetUser.socketId).emit('player_kicked', { reason: 'Kicked by host' });
        }

        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('game_state_update', state);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    socket.on('chat_message', async (data: { roomId: string; message: string }) => {
      try {
        const sd = socket.data;
        const user = await prisma.user.findUnique({ where: { id: sd.userId as string } });
        if (!user) return;
        const safeMessage = data.message.slice(0, 200);
        await prisma.chatMessage.create({
          data: { roomId: data.roomId, sender: user.name, message: safeMessage },
        });
        io.to(data.roomId).emit('chat_message', {
          sender: user.name,
          message: safeMessage,
          timestamp: new Date().toISOString(),
        });
      } catch { /* silent */ }
    });

    socket.on('disconnect', async () => {
      try {
        const sd = socket.data;
        if (sd.userId) {
          await prisma.user.update({
            where: { id: sd.userId as string },
            data: { socketId: null },
          });
          if (sd.roomId) {
            io.to(sd.roomId as string).emit('player_disconnected', { userId: sd.userId });
          }
        }
      } catch { /* ignore */ }
    });

    socket.on('reconnect_player', async (data: { roomId: string; userId: string }, callback) => {
      try {
        const player = await prisma.player.findFirst({
          where: { roomId: data.roomId, userId: data.userId },
        });
        if (!player) { callback({ success: false, error: 'Player not in room' }); return; }

        await prisma.user.update({
          where: { id: data.userId },
          data: { socketId: socket.id },
        });
        socket.join(data.roomId);
        socket.data.roomId = data.roomId;
        socket.data.userId = data.userId;

        const state = await getFullGameState(data.roomId);
        io.to(data.roomId).emit('player_reconnected', { userId: data.userId });
        callback({ success: true, state });
      } catch (err) {
        callback({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });
  });

  httpServer.listen(SOCKET_PORT, '0.0.0.0', () => {
    console.log(`Socket.IO server listening on port ${SOCKET_PORT}`);
  });

  res.status(200).json({ message: 'Socket.IO initialized', port: SOCKET_PORT });
}
