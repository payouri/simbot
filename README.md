# simbot

Self-hosted Raidbots-style simulator (Top Gear + Quick Sim) on top of [SimulationCraft](https://github.com/simulationcraft/simc).

Planning lives in the `wayfinder:map` issue.

## Run with Docker

```sh
docker compose up
```

serves the app on http://localhost:3000 (`SIMBOT_PORT` changes the host port). The one service has no Docker socket and one volume, `/data`, which holds the database, SimC Builds and item data. Everything runs as a non-root user, uid/gid 1000 by default; set `SIMBOT_UID` and `SIMBOT_GID` (environment or `.env`) to match your host user, and files in `/data` are created with that owner. With a bind mount instead of the named volume, `chown` the host directory to the same uid/gid.

The image bundles a **Seed SimC Build** (the pinned `simulationcraftorg/simc` tag in the Dockerfile's `SIMC_TAG`) with its item data baked at build time. On the first start on an empty volume the seed becomes the Current SimC Build straight away, so the app works offline, and exactly one SimC Update Job to the latest nightly is queued. If it fails (for example offline) the app stays on the seed and the SimC page shows the error with Retry. Later starts queue nothing. When a new app version ships a newer seed, it is offered as a SimC Update.

### Build, tag and push

Building needs network once (item data is fetched from GitHub and wago.tools). Pushing needs `docker login` as `yourikane`.

```sh
VERSION=0.1.0   # X.Y.Z
docker build -t yourikane/simbot:$VERSION -t yourikane/simbot:latest .
docker push yourikane/simbot:$VERSION
docker push yourikane/simbot:latest
```

To ship a newer seed, build with `--build-arg SIMC_TAG=<nightly tag>` (and change the default in the Dockerfile so the choice is recorded). Run the pushed image with `SIMBOT_VERSION=$VERSION docker compose up`.
