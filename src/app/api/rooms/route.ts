import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  const rooms = await prisma.room.findMany({
    where: { status: 'waiting', isPrivate: false },
    include: { players: { include: { user: true } }, host: true },
    orderBy: { createdAt: 'desc' },
  });

  const data = rooms.map((room) => ({
    roomCode: room.roomCode,
    hostName: room.host.name,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    mapName: room.mapName,
    createdAt: room.createdAt.toISOString(),
    players: room.players.map((p) => ({ name: p.user.name, avatar: p.avatar })),
  }));

  return NextResponse.json(data);
}
