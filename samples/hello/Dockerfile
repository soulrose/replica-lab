# Sample app for a first look at Replica Lab; built on the PC from the same base image as the Replica Lab page.
ARG BASE=node:lts-alpine
FROM ${BASE}
WORKDIR /app
COPY server.mjs ./
EXPOSE 8080
USER node
LABEL rama.lab.kind="http" rama.lab.port="8080" rama.lab.health="/health" rama.lab.test="http"
CMD ["node", "server.mjs"]
