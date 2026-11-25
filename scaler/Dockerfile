# run-local.ps1 passes the base image of this PC's site (sites\<name>.json): Docker Hub by default, Harbor in the hospital.
ARG BASE=node:lts-alpine
FROM ${BASE}
WORKDIR /app
COPY server.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
# root on purpose: it needs /var/run/docker.sock to scale the service
CMD ["node", "server.mjs"]
