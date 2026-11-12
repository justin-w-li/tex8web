# The tools that build a page, for documents whose source is not trusted:
# CI's TeX Live image with Node, for prerendering. tex8web itself is
# mounted at run time by test/lib/contain.mjs, which tags the image by a
# hash of this file.
# To update Node, pick a 22.x.y release at least two weeks old from
# https://nodejs.org/dist/index.json, and copy the SHA256 of its
# linux-arm64 and linux-x64 .tar.gz files from its SHASUMS256.txt.
FROM texlive/texlive@sha256:07e8062637249c4f780ca59f42cc2ed592bc2dc1db4320769406aee3f98aa70e
ARG TARGETARCH
ARG NODE=22.23.4
RUN case $TARGETARCH in \
      arm64) arch=arm64 sum=f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9 ;; \
      amd64) arch=x64 sum=b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406 ;; \
      *) echo "no Node for $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL -o /tmp/node.tar.gz https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$arch.tar.gz \
  && echo "$sum  /tmp/node.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --no-same-owner \
  && rm /tmp/node.tar.gz \
  && node --version
