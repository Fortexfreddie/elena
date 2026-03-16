FROM node:20-alpine

WORKDIR /app

# 1. Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# 2. Copy the prisma folder specifically for the postinstall script
COPY prisma ./prisma/

# 3. Install dependencies (this will now successfully run prisma generate)
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 4. Copy the rest of your code
COPY . .

# 5. Build the app
RUN pnpm build

EXPOSE 3000

CMD ["node", "dist/src/main.js"]