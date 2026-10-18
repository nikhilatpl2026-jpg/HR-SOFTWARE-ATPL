# Cloud Run container for the existing Node/Express ERP backend.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
