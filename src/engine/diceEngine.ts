import crypto from 'crypto';

export interface DiceResult {
  dice1: number;
  dice2: number;
  total: number;
  isDouble: boolean;
}

export function rollDice(): DiceResult {
  const dice1 = crypto.randomInt(1, 7);
  const dice2 = crypto.randomInt(1, 7);
  return {
    dice1,
    dice2,
    total: dice1 + dice2,
    isDouble: dice1 === dice2,
  };
}
