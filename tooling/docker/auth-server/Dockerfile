FROM node:22-alpine

WORKDIR /app
COPY auth-core.mjs server.mjs ./

# Skapa data-dir + sätt rätt permissions så bind-mount funkar
RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3001

CMD ["node", "server.mjs"]
