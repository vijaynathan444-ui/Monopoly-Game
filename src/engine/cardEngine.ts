import { CardData } from './tileEngine';

export function shuffleCards(cards: CardData[]): CardData[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface CardResult {
  card: CardData;
  remainingCards: CardData[];
}

export function drawCard(deck: CardData[]): CardResult {
  if (deck.length === 0) {
    throw new Error('No cards remaining in deck');
  }
  const [card, ...remaining] = deck;
  return { card, remainingCards: remaining };
}
