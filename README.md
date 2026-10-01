# simbot

simbot is a self-hosted gear sim for World of Warcraft (retail), built on [SimulationCraft](https://github.com/simulationcraft/simc) (SimC). It follows the Raidbots workflow, but runs on your own machine with no paywall and no per-user caps.

Paste the Addon String from the in-game SimulationCraft addon, then run either:

- **Quick Sim**: sims the character exactly as the Addon String describes it.
- **Top Gear**: builds gear Combinations from the items you pick, sims them in stages and ranks them against your equipped set.

Every Sim is stored with its input and output, so you can reopen it later, copy it into a new Draft and re-run it when your gear or SimC changes. SimC Updates are shown in the app and applied only when you choose.

## Run with Docker

```sh
docker compose up
```

The app is then served on http://localhost:3000. Set `SIMBOT_PORT` to use another host port.

The container is a single service with one volume, `/data`. It holds the database, the SimC Builds and the item data, and the container has no access to the Docker socket.

The app runs as a non-root user, uid/gid 1000 by default. To match your host user, set `SIMBOT_UID` and `SIMBOT_GID` in the environment or in a `.env` file; files in `/data` are then created with that owner. If you use a bind mount instead of the named volume, `chown` the host directory to the same uid/gid.

### First start

The image ships a **Seed SimC Build**: the `simulationcraftorg/simc` tag pinned in the Dockerfile's `SIMC_TAG`, with its item data baked in at build time. This means the app works offline from the first start:

1. On an empty volume, the seed becomes the Current SimC Build straight away.
2. One SimC Update Job to the latest nightly is queued. If it fails (offline, for example), the app stays on the seed and the SimC page shows the error with a Retry button.
3. Later starts queue nothing. When a new app version ships a newer seed, it is offered as a SimC Update.

## Development

simbot is a [Bun](https://bun.sh) monorepo: a React client in `apps/client`, a Bun server in `apps/server` that runs SimC as a child process, and shared packages in `packages/`.

```sh
bun install
bun run dev     # server and client in watch mode
bun run check   # lint, typecheck and tests
```

Outside Docker the server keeps its data in `./data`. Set `SIMBOT_DATA_DIR` to put it somewhere else.

## Building and publishing the image

Building needs network access once, to fetch item data from GitHub and wago.tools. Pushing needs `docker login` as `yourikane`.

```sh
VERSION=0.1.0   # X.Y.Z
docker build -t yourikane/simbot:$VERSION -t yourikane/simbot:latest .
docker push yourikane/simbot:$VERSION
docker push yourikane/simbot:latest
```

To ship a newer seed, build with `--build-arg SIMC_TAG=<nightly tag>`, and change the default in the Dockerfile so the choice is recorded. Run a pushed image with `SIMBOT_VERSION=$VERSION docker compose up`.

## Licence

[MIT](LICENSE). The Docker image bundles SimulationCraft, which is licensed under the GPL-3.0.
