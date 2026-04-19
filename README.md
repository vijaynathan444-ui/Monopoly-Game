# 🎲 Monopoly Online — Multiplayer Board Game

A real-time multiplayer Monopoly-style web application built with **Next.js**, **Socket.IO**, **Prisma**, and **SQLite**. Create rooms, invite friends, and play the classic board game online.

> Inspired by [richup.io](https://richup.io)

---

## 📸 Screenshots

### Home Page — Create or Join a Room
![Home Page](screenshots/home.png)

### Lobby — Waiting for Players & Map Selection
![Lobby](screenshots/lobby.png)

### Game Board — Classic Map
![Game Board](screenshots/game-board.png)

### Dice Roll & Actions Panel
![Dice Roll](screenshots/dice-actions.png)

### Property Details & Upgrade
![Property Modal](screenshots/property-modal.png)

### Chance / Community Chest Card
![Card Draw](screenshots/card-draw.png)

### In-Game Chat
![Chat](screenshots/chat.png)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Multiplayer Rooms** | Create/join rooms with unique 6-character codes |
| **Host Controls** | Start game, kick players, select map |
| **Dynamic Board** | Board rendered from JSON map files — fully extensible |
| **3 Maps** | Classic, India, and World maps included |
| **Dice System** | Cryptographic random dice, doubles = extra turn, 3 doubles = jail |
| **Property System** | Buy, upgrade (houses/hotel), mortgage, pay rent |
| **Rent Calculation** | Monopoly rent doubling, railroad/utility scaling |
| **Jail System** | Roll doubles, pay fine, or use Get Out of Jail Free card |
| **Card System** | Chance & Community Chest with shuffled decks |
| **In-Game Chat** | Real-time chat between players |
| **Reconnection** | Rejoin game if disconnected |
| **Responsive UI** | Desktop, tablet, and mobile layouts |
| **Animations** | Dice roll, token bounce, card flip, turn glow |
| **Bankruptcy** | Auto-bankrupt when money < 0, properties released |
| **Game Over** | Last player standing wins |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Plain CSS |
| Backend | Next.js API Routes, Socket.IO |
| Database | SQLite via Prisma ORM + better-sqlite3 |
| Real-time | Socket.IO (WebSocket + polling) |
| Language | TypeScript |

**No UI frameworks** — all styles are hand-written CSS using CSS Grid, Flexbox, and CSS variables.

---

## 📁 Project Structure

```
monopoly-game/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # SQLite migrations
├── src/
│   ├── app/
│   │   ├── page.tsx           # Home — Create/Join room
│   │   ├── lobby/[code]/      # Lobby — Player list, map select
│   │   ├── game/[code]/       # Game — Board, dice, controls, chat
│   │   ├── api/maps/          # REST API for available maps
│   │   └── globals.css        # All styles
│   ├── engine/
│   │   ├── gameEngine.ts      # Core game logic (roll, buy, rent, jail, cards)
│   │   ├── diceEngine.ts      # Cryptographic dice rolling
│   │   ├── tileEngine.ts      # Tile types, rent calculation
│   │   └── cardEngine.ts      # Card deck shuffle/draw
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── socketClient.ts    # Client-side Socket.IO wrapper
│   │   └── utils.ts           # Room code generator, constants
│   ├── maps/
│   │   ├── classic.json       # Classic Monopoly board
│   │   ├── india.json         # India-themed board
│   │   └── world.json         # World cities board
│   └── pages/api/
│       └── socketio.ts        # Socket.IO server (all game events)
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **npm** or **yarn**

### Installation

```bash
# Clone the repo
git clone https://github.com/vijaynathan444-ui/Monopoly-Game.git
cd Monopoly-Game

# Install dependencies
npm install

# Create environment file
echo 'DATABASE_URL="file:./dev.db"' > .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🎮 How to Play

1. **Create a Room** — Enter your name and click "Create Room"
2. **Share the Code** — Give the 6-character room code to friends
3. **Friends Join** — They enter the code on the home page
4. **Host Starts** — Host selects a map and clicks "Start Game"
5. **Roll & Play** — Roll dice, buy properties, pay rent, draw cards
6. **Win** — Last player not bankrupt wins!

### Controls

| Action | When |
|--------|------|
| 🎲 Roll Dice | Your turn, rolling phase |
| 🏠 Buy Property | Landed on unowned property |
| 💸 Pay Rent | Landed on opponent's property |
| ⏩ End Turn | After your actions are done |
| 💰 Pay $50 Fine | In jail |
| 🃏 Use Jail Card | In jail with a card |

Click any tile on the board to view property details, upgrade, or mortgage.

---

## 🗺 Adding Custom Maps

Drop a JSON file in `src/maps/`:

```json
{
  "name": "My Custom Map",
  "description": "A custom board",
  "tiles": [
    { "type": "START", "name": "GO" },
    { "type": "PROPERTY", "name": "My City", "price": 100, "rent": 10, "color": "#FF0000", "group": "red" },
    { "type": "JAIL", "name": "Jail" },
    { "type": "GO_TO_JAIL", "name": "Go To Jail" }
  ],
  "luckCards": [
    { "text": "Collect $200!", "action": "gain_money", "value": 200 }
  ],
  "chestCards": [
    { "text": "Pay $50 tax.", "action": "lose_money", "value": 50 }
  ]
}
```

**Tile types:** `START`, `PROPERTY`, `RAILWAY`, `UTILITY`, `TAX`, `LUCK`, `CHEST`, `JAIL`, `GO_TO_JAIL`, `FREE_PARKING`

**Card actions:** `gain_money`, `lose_money`, `move_to`, `move_back`, `go_to_jail`, `jail_card`, `pay_each_player`

The board must have exactly **40 tiles** (10 per side) for correct rendering.

---

## 🔌 WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `create_room` | Client → Server | Create a new room |
| `join_room` | Client → Server | Join with room code |
| `start_game` | Client → Server | Host starts the game |
| `roll_dice` | Client → Server | Roll dice on your turn |
| `buy_property` | Client → Server | Buy current property |
| `pay_rent` | Client → Server | Pay rent to owner |
| `end_turn` | Client → Server | Pass turn to next player |
| `draw_card` | Client → Server | Draw chance/chest card |
| `kick_player` | Client → Server | Host kicks a player |
| `chat_message` | Bidirectional | In-game chat |
| `game_state_update` | Server → Client | Full state sync |
| `dice_rolled` | Server → Client | Dice result broadcast |
| `game_ended` | Server → Client | Winner announcement |

---

## 📊 Database Schema

```
User          Room           Player         Property       GameState      ChatMessage
─────         ─────          ─────          ─────          ─────          ─────
id            id             id             id             id             id
name          roomCode       roomId         tileIndex      roomId         roomId
socketId      hostId         userId         name           currentTurn    sender
createdAt     status         position       price          diceValues     message
              mapName        money          rent           doublesCount   isSystem
              maxPlayers     inJail         ownerId        phase          createdAt
              createdAt      jailTurns      roomId         lastUpdate
                             jailCards      level
                             bankrupt       mortgaged
                             avatar
                             turnOrder
```

---

## 📄 License

This project is for educational purposes.

---

## 👤 Author

**Vijay Nathan** — [@vijaynathan444-ui](https://github.com/vijaynathan444-ui)
