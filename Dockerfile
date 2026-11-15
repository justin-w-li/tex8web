# The tools that build a page, for documents whose source is not trusted:
# CI's TeX Live image with Node, for prerendering, and Poppler. tex8web
# itself is mounted at run time by test/lib/contain.mjs, which tags the
# image by a hash of this file.
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
# (pdftoppm and pdftotext, for the PDF's pages beside the page's screens:
# a PDF built from a source that is not trusted is not trusted either)
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/* \
  && pdftoppm -v
# (latexminted 0.7.0 deletes its old message files in LaTeX's working
# directory on each run, and catches only PermissionError, so the read-only
# source of a contained build fails every minted document with "Read-only
# file system". The step fails when latexminted's code differs, so a new
# release is checked and the step removed once fixed upstream)
RUN python3 - <<'PATCH'
import glob, os, shutil, zipfile
wheel, = glob.glob('/usr/local/texlive/*/texmf-dist/scripts/minted/latexminted-*.whl')
name = 'latexminted/command_clean.py'
caught = 'except (PermissionError, PathSecurityError):'
debug = caught + '\n                continue\n            except FileNotFoundError:\n                break\n'
with zipfile.ZipFile(wheel) as old:
    code = old.read(name).decode()
    assert code.count(caught) == 3 and code.count(debug) == 1, 'latexminted changed: check the patch'
    # (FileNotFoundError first, as OSError would catch it)
    code = code.replace(debug, 'except FileNotFoundError:\n                break\n            '
                        + caught + '\n                continue\n').replace(caught, 'except (OSError, PathSecurityError):')
    with zipfile.ZipFile('/tmp/patched.whl', 'w', zipfile.ZIP_DEFLATED) as new:
        for entry in old.infolist():
            new.writestr(entry, code if entry.filename == name else old.read(entry))
shutil.copymode(wheel, '/tmp/patched.whl')
os.replace('/tmp/patched.whl', wheel)
PATCH
