# Use official Node.js LTS image
FROM node:20-alpine

# Install dependencies for better-sqlite3 (native module)
RUN apk add --no-cache python3 make g++ libc6-compat

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Copy Prisma schema before install (needed for prisma generate)
COPY prisma ./prisma

# Install all dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy rest of app
COPY . .

# Build Next.js app
RUN npm run build

# Create /data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/database.sqlite

# Run Prisma migrations then start app
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
