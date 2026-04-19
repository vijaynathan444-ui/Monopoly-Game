import crypto from 'crypto';

export interface DiceResult {
  dice1: number;
  dice2: number;
  total: number;
  isDouble: boolean;
}

export function rollDice(): DiceResult {
  const bytes = crypto.randomBytes(2);
  const dice1 = (bytes[0] % 6) + 1;
  const dice2 = (bytes[1] % 6) + 1;
  return {
    dice1,
    dice2,
    total: dice1 + dice2,
    isDouble: dice1 === dice2,
  };
}
