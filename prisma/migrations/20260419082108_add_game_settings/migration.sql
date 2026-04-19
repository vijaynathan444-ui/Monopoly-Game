-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomCode" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "mapName" TEXT NOT NULL DEFAULT 'classic',
    "maxPlayers" INTEGER NOT NULL DEFAULT 6,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "startingCash" INTEGER NOT NULL DEFAULT 1500,
    "doubleRentFullSet" BOOLEAN NOT NULL DEFAULT true,
    "auctionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mortgageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "evenBuildRule" BOOLEAN NOT NULL DEFAULT true,
    "noRentInJail" BOOLEAN NOT NULL DEFAULT false,
    "randomizeOrder" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("createdAt", "hostId", "id", "mapName", "maxPlayers", "roomCode", "status") SELECT "createdAt", "hostId", "id", "mapName", "maxPlayers", "roomCode", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_roomCode_key" ON "Room"("roomCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
