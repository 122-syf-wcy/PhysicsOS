ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
USER root
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git openssh-client python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/physicsos
ENTRYPOINT ["node"]
