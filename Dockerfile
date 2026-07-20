# Imagem única para o app Next.js e o worker de envio (comandos diferentes
# no compose). Mantém o código-fonte + node_modules completos porque o worker
# roda TypeScript direto via tsx e o mjml precisa de node_modules real
# (serverExternalPackages).
FROM node:22-slim

WORKDIR /app

# Dependências primeiro (camada cacheável entre builds).
COPY package.json package-lock.json ./
RUN npm ci

# Código e build de produção. O getDb() é lazy, então o build
# funciona sem DATABASE_URL (nenhum segredo entra na imagem —
# ver .dockerignore).
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Serviço "app" usa o CMD padrão; o "worker" sobrescreve com tsx.
CMD ["npm", "run", "start"]
