export interface MapTile {
  type: string;
  name: string;
  description?: string;
  price?: number;
  rent?: number;
  color?: string;
  group?: string;
  amount?: number;
}

export interface CardData {
  text: string;
  action: string;
  value?: number;
}

export interface GameMap {
  name: string;
  description: string;
  tiles: MapTile[];
  luckCards: CardData[];
  chestCards: CardData[];
}

export function getTileAction(tile: MapTile): string {
  switch (tile.type) {
    case 'START':
      return 'collect_go';
    case 'PROPERTY':
    case 'RAILWAY':
    case 'UTILITY':
      return 'property_action';
    case 'TAX':
      return 'pay_tax';
    case 'LUCK':
      return 'draw_luck';
    case 'CHEST':
      return 'draw_chest';
    case 'JAIL':
      return 'visiting_jail';
    case 'GO_TO_JAIL':
      return 'go_to_jail';
    case 'FREE_PARKING':
      return 'free_parking';
    default:
      return 'none';
  }
}

export function calculateRent(
  baseRent: number,
  level: number,
  tileType: string,
  ownedInGroup?: number,
  totalInGroup?: number,
  diceTotal?: number
): number {
  if (tileType === 'RAILWAY') {
    const railroadRents = [25, 50, 100, 200];
    return railroadRents[Math.min((ownedInGroup || 1) - 1, 3)];
  }

  if (tileType === 'UTILITY') {
    const multiplier = (ownedInGroup || 1) >= 2 ? 10 : 4;
    return (diceTotal || 7) * multiplier;
  }

  // Property rent with upgrades
  const multipliers = [1, 5, 15, 45, 80, 125]; // base, 1-4 houses, hotel
  const rent = baseRent * multipliers[Math.min(level, 5)];

  // Double rent if owns all in group
  if (level === 0 && ownedInGroup === totalInGroup && totalInGroup && totalInGroup > 0) {
    return rent * 2;
  }

  return rent;
}
