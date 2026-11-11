# Same base image as other OffLab tools; already in Harbor, so no Docker Hub pull is needed.
FROM harbor.rama.mahidol.ac.th/library/node-alpine:lts-alpine3.24
WORKDIR /app
COPY server.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
# root on purpose: it needs /var/run/docker.sock to scale the service
CMD ["node", "server.mjs"]
