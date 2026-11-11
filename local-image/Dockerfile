# ramaservice built from a local working copy (code not pushed yet), on top of the Harbor image so the
# base OS packages, user, HEALTHCHECK and ENTRYPOINT stay the same as the real build.
# Context = the exploded Spring Boot jar (BOOT-INF/, META-INF/), made by build-local.ps1.
ARG BASE=harbor.rama.mahidol.ac.th/newhis/ramaservice:master
FROM ${BASE}
USER root
# drop the base image's classes and libraries, or old jars (e.g. the previous starter) stay on the classpath
RUN find /app -mindepth 1 -maxdepth 1 ! -name logs -exec rm -rf {} +
COPY --chown=spring:spring BOOT-INF/lib /app/lib
COPY --chown=spring:spring META-INF /app/META-INF
COPY --chown=spring:spring BOOT-INF/classes /app
USER spring:spring
LABEL rama.local-build="true"
