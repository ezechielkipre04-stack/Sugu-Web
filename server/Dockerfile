# Node 24 est requis : le serveur utilise `node:sqlite` (DatabaseSync) sans drapeau.
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY index.mjs seed.mjs ./
COPY lib ./lib
COPY routes ./routes

# Volume persistant pour la base SQLite et les pièces KYC.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 4000

CMD ["node", "index.mjs"]
