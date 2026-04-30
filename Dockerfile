FROM node:24-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app source
COPY . .

# Railway injects PORT at runtime
EXPOSE 3000

CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
