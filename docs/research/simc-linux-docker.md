# Getting, running and versioning SimC on Linux and in Docker

Resolves [#2](https://github.com/payouri/simbot/issues/2). Researched 2026-09-28 against the
`simulationcraft/simc` repo (default branch `midnight`, HEAD `4c7c736`), its wiki, Docker Hub
`simulationcraftorg/simc`, and the GitHub REST docs. Claims marked **(verified)** were checked by
running things on this machine (16 threads, Arch Linux) that day.

## TL;DR / recommendation

- **Use the official Docker Hub image `simulationcraftorg/simc` as the SimC source.** It is a nightly
  build of the default branch, published by the SimC org from the repo's own `Dockerfile`. Each
  build is tagged `<SC_MAJOR_VERSION>-<YYYY-MM-DD>-<short sha>` (e.g. `1210-2026-09-28-4c7c736`),
  so you can pin an exact commit and move to a newer one on the user's say-so. That fits the **SimC Update** flow.
- There are **no official Linux binaries**. The README says "There is no Linux release since it is so
  ridiculously easy to build it yourself". The GitHub repo has 0 releases.
- **Building from source is the fallback.** Use it for a SimC commit that has no nightly tag, or for a
  host-native `-march=native` build. It is a plain `make` or CMake build. A 16-thread GCC
  build takes about **2 min** (127 s, clean `make release -j16`). That plain build sims ~27% slower than the
  official PGO binary, and it must be built from a git clone, or the version fields are missing (see [Build from source](#3-build-from-source)).
- **The active retail branch is `midnight`.** It is the repo's `default_branch`, and CI runs on it. Branch
  names follow expansions (`thewarwithin`, `dragonflight`, ...), so **read `default_branch` from
  the API instead of hardcoding it.**
- **Version of the running SimC:** the `json2` report's top level carries `version`, `git_revision`
  and `git_branch`, plus `sim.options.dbc.Live.wow_version`. The console banner carries the same
  data **(verified)**.
- **Latest commit on the branch:** send an unauthenticated `GET /repos/simulationcraft/simc/commits/midnight`
  with `Accept: application/vnd.github.sha`, which returns just the 40-char SHA. The unauthenticated
  limit is 60 req/h per IP, and **304s still count when unauthenticated (verified)**, so poll at most
  every few minutes. An hourly check is plenty.
- **Key CLI options:** `threads`, `iterations`, `target_error`, `json2=<file>`, `profileset.*`,
  `profileset_work_threads`, `single_actor_batch`, `report_details`, `process_priority`.

## 1. Official binaries

- The downloads page and README offer Windows and macOS packages only. The README: "There is no Linux release
  since it is so ridiculously easy to build it yourself on that platform." ([README](https://github.com/simulationcraft/simc/blob/midnight/README.md))
- `GET /repos/simulationcraft/simc/releases` returns an empty list. The only tags are old
  (`release-830-01`, ...), so GitHub Releases is not a distribution channel. (GitHub API, queried 2026-09-28.)
- **Conclusion:** there is no official Linux binary to download. Use Docker or build from source.

## 2. Docker Hub image `simulationcraftorg/simc`

Facts from the Docker Hub API (`hub.docker.com/v2/repositories/simulationcraftorg/simc/`) and the
registry manifest/config of `:latest`:

| Fact | Value |
|---|---|
| Description | "Simulationcraft CLI nightly builds" |
| Pulls | ~363k; active, last pushed 2026-09-28 03:55 UTC |
| Tags | `latest`, plus one tag per nightly: `1210-2026-09-28-4c7c736`, `1210-2026-09-27-7ffaabf`, ... (1,766 tags in total; older prefixes `1205`, `1207`) |
| Cadence | About daily at ~03:30–04:00 UTC. Days with no new commit are skipped (e.g. no 2026-09-25 tag). |
| Arch | **linux/amd64 only** (no arm64 manifest) |
| Size | ~31 MB compressed; the `simc` binary is ~159 MB uncompressed |
| Base | `alpine` (musl), runtime deps `libcurl libgcc libstdc++` |
| Entrypoint / workdir | `ENTRYPOINT ["./simc"]`, `WORKDIR /app/SimulationCraft`, profiles under `./profiles/` |
| Default CMD | `TWW1_Raid.simc`. This file is **stale**: it no longer exists in `profiles/` (now `MID1_Raid.simc`, `MID2_Raid.simc`). Always pass your own args. |

- The image's layer history matches the repo [`Dockerfile`](https://github.com/simulationcraft/simc/blob/midnight/Dockerfile).
  That file is a two-stage Alpine build: clang, ThinLTO, then an LLVM PGO pass trained on `CI.simc`, then a rebuild with `-Os -mtune=generic`.
  So the image is a well-optimised, generic x86-64 build.
- The tag's short SHA matches the branch HEAD. `latest` = `1210-2026-09-28-4c7c736` = the
  `midnight` HEAD commit `4c7c73621e59…` **(verified)**.
- The publishing pipeline is **not** in the repo's `.github/workflows` (none of them mention docker).
  It is run by the SimC org outside the repo. We don't control its cadence.
- The binary reports its git data **(verified)**. It was extracted from the image and run via its musl loader:
  `SimulationCraft 1210-01 for World of Warcraft 12.1.0.69933 Live (hotfix 2026-09-24/69933, git build midnight 4c7c736)`.
- **Usage for us:**
  `docker run --rm -v "$PWD/work:/work" simulationcraftorg/simc:1210-2026-09-28-4c7c736 /work/input.simc json2=/work/out.json threads=16`.
  Inside a container, `threads=0` uses every host CPU the container can see, so pass an explicit
  value if the container is CPU-limited.
- **How the app could run it:**
  - (a) The app container runs sims by talking to a Docker daemon (socket mount). Heavy and couples us to Docker.
  - (b) Recommended: our own image copies the binary out of the official one, e.g.
    `COPY --from=simulationcraftorg/simc:<tag> /app/SimulationCraft/simc /opt/simc/simc`.
    That binary is musl-linked, so our image must be Alpine-based, e.g. `oven/bun:alpine`, with `libcurl libgcc libstdc++`.
  - (c) On a glibc base, build from source in a builder stage instead.

  Updating SimC in (b) or (c) means a new image or binary. See the open questions.

## 3. Build from source

- Official instructions ([wiki: HowToBuild](https://github.com/simulationcraft/simc/wiki/HowToBuild)):
  - Packages: `build-essential libcurl-dev` (+ `cmake pkg-config` for CMake).
  - Classic CLI build: `cd engine && make optimized` (or `release`).
  - CMake: `cmake -B build . -DCMAKE_BUILD_TYPE=Release -DBUILD_GUI=OFF && cmake --build build`.
  - Parallelise with `-j N`.
  - `SC_NO_NETWORKING=1` (make) / `-DSC_NO_NETWORKING=ON` (cmake) drops the libcurl dependency. We don't need
    networking: we sim from an Addon String, not the Armory.
  - The wiki warns that g++ + LTO + curl can fail at link time. The suggested workarounds are clang or `SC_NO_NETWORKING`.
- [`engine/Makefile`](https://github.com/simulationcraft/simc/blob/midnight/engine/Makefile) knobs:
  - `release` (adds `-DNDEBUG`) and `optimized` (adds native arch).
  - `MARCH_NATIVE`, `LTO`/`LTO_THIN`, `LLVM_PGO_GENERATE`/`LLVM_PGO_USE`, `OPTS`, `CXX`.
- **Git data is baked in only if the tree is a git checkout.** The Makefile sets
  `GIT = $(shell [ -d ../.git ] && which git)` and passes `-DSC_GIT_REV` (`git rev-parse --short HEAD`) and
  `-DSC_GIT_BRANCH` (`git rev-parse --abbrev-ref HEAD`) only when that is non-empty.
  A tarball or a `.git`-less Docker context therefore produces a binary with no git data **(verified)**: I built from the
  GitHub tarball of `4c7c736`. Its banner has no `git build …` suffix, and the `json2` report has **no `git_revision`/`git_branch` keys at all**.
  Build from a real clone (a shallow `--depth 1 --branch midnight` clone is enough), or we lose version detection.
  ([`engine/util/git_info.cpp`](https://github.com/simulationcraft/simc/blob/midnight/engine/util/git_info.cpp))
  The repo's `.dockerignore` does not exclude `.git`, so `docker build` from a clone keeps it.
- **Measured build time (verified):**
  - Setup: 16 threads, GCC 16.2.1, `make -C engine release -j16` (with libcurl), clean tree: **127 s wall clock**.
    It links fine and produces a 157 MB `simc`.
  - The official Dockerfile's PGO flow compiles twice plus a training sim, so expect roughly 2–3× longer.
    It also defaults to `THREADS=1`; pass `--build-arg THREADS=16`.
- **Speed: the official binary is faster (verified).** Same sim (MID2 Frost DK, `iterations=20000 threads=16`):
  - Official Docker Hub binary (clang + ThinLTO + PGO, musl): **14.0 s**.
  - Plain GCC `-O3` release build: **19.2 s**.
  - So the official image is ~27% faster. A source build should copy the Dockerfile's clang+LTO+PGO recipe
    (or at least `MARCH_NATIVE=1 LTO_THIN=1`) to be competitive.
- **Toolchain notes:** a C++17 compiler (C++20 optional) and GNU make. There is no other dependency when networking is off.

## 4. Which branch is the active retail branch

- `GET /repos/simulationcraft/simc` → `"default_branch": "midnight"`.
- [`.github/workflows/main.yml`](https://github.com/simulationcraft/simc/blob/midnight/.github/workflows/main.yml)
  runs CI on `push`/`pull_request` to `branches: [midnight]`.
- Branch list: `midnight`, `thewarwithin`, `dragonflight`, `shadowlands`, `bfa-dev`, `legion-dev`, `wod`, `mop`, `tbc`, ... The
  active branch is renamed per expansion.
- **PTR/Live:** the single `midnight` build carries both Live and PTR data (`SC_USE_PTR 1` in
  [`engine/config.hpp`](https://github.com/simulationcraft/simc/blob/midnight/engine/config.hpp)).
  The report shows `dbc.Live` 12.1.0.69933 and `dbc.PTR` 12.1.5.69952, with `version_used: Live` by default. `ptr=1` switches an actor to PTR data.
- **Recommendation:** resolve the branch at runtime with `GET /repos/simulationcraft/simc` → `default_branch`.
  It is one extra request and can be cached for a day. Also prefer, as the default target, the branch the pinned Docker tag was built from (`git_branch` in the report).

## 5. Reading the running SimC's version/commit

- `json2` report top level ([`engine/report/json/report_json.cpp`](https://github.com/simulationcraft/simc/blob/midnight/engine/report/json/report_json.cpp)).
  Actual output **(verified)**:
  ```json
  { "version": "1210-01", "report_version": "2.0.0", "ptr_enabled": 1, "beta_enabled": 0,
    "build_date": "Sep 28 2026", "build_time": "03:51:37", "timestamp": 1790617193,
    "git_revision": "4c7c736", "git_branch": "midnight", ... }
  ```
  - `sim.options.dbc.Live.wow_version` = `"12.1.0.69933"`, with a `hotfix_date` alongside.
  - `version` is `SC_MAJOR_VERSION "-" SC_MINOR_VERSION` from `engine/config.hpp`.
- Console banner:
  `SimulationCraft 1210-01 for World of Warcraft 12.1.0.69933 Live (hotfix 2026-09-24/69933, git build midnight 4c7c736)`.
  - The `git build` suffix appears when a sim actually runs.
  - Running `simc` with no arguments prints `Nothing to sim! …` **without** the git suffix **(verified)**.
  - So to probe the version cheaply, parse the Docker tag we pinned, or run a trivial sim and read `json2`.
- `git_revision` is a **short** SHA (7 chars). To compare it with the GitHub HEAD, prefix-match against the 40-char SHA,
  or use the compare endpoint below.

## 6. Asking GitHub for the latest commit (no auth)

- Endpoints (all work unauthenticated on this public repo, **verified**):
  - `GET https://api.github.com/repos/simulationcraft/simc/commits/midnight` with header
    `Accept: application/vnd.github.sha`. The body is just the 40-char SHA, the lightest option.
  - `GET /repos/simulationcraft/simc/branches/midnight` returns `commit.sha` and `commit.commit.committer.date`
    ([docs](https://docs.github.com/en/rest/branches/branches#get-a-branch)).
  - `GET /repos/simulationcraft/simc/compare/<our short sha>...midnight` returns `status: "ahead"` and `ahead_by: 10`
    (verified with `7ffaabf...midnight`), plus a `commits[]` list. It gives the "N commits behind" figure and a changelog for the SimC Update prompt.
  - Alternative with no GitHub API at all: list Docker Hub tags (`/v2/repositories/simulationcraftorg/simc/tags?ordering=last_updated`).
    The newest tag's name encodes the date and SHA, and it is exactly what we could actually switch to.
- Rate limits ([docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)):
  - Unauthenticated: **60 requests/hour per IP**. Authenticated PAT: 5,000/hour.
  - Headers: `x-ratelimit-limit`, `-remaining`, `-used`, `-reset` (epoch seconds), `-resource`.
  - Conditional requests (`If-None-Match` with the `etag`) do not count **only when authenticated**.
    The [best-practices doc](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) says so, and it was
    **verified**: an unauthenticated 304 still decremented `x-ratelimit-remaining` (59 → 58).
  - So unauthenticated polling costs 1 request per check. Hourly or on-app-open checks are nowhere near the limit.
  - An optional user-supplied token could raise the limit, but it isn't needed.

## 7. CLI options that matter

Options are `key=value` args or lines in a `.simc` file. They are parsed sequentially and the last one wins; `input=file.simc` or
just `file.simc` includes a file ([wiki: TextualConfigurationInterface](https://github.com/simulationcraft/simc/wiki/TextualConfigurationInterface)).
We can write the Addon String plus options to a temp `.simc` file and pass that path.

| Option | Meaning / default | Source |
|---|---|---|
| `threads=N` | Worker threads; default 0 = all CPU threads | [Options](https://github.com/simulationcraft/simc/wiki/Options) |
| `iterations=N` | Number of fights. Default 1,000,000 as a cap when `target_error` is set. An explicit `iterations` with no `target_error` runs exactly N. | [StatisticalBehaviour](https://github.com/simulationcraft/simc/wiki/StatisticalBehaviour) |
| `target_error=X` | Stop once the DPS error (in %) reaches X. Wiki default 0.2. The banner shows `target_error=0.000` when unset. | same |
| `json2=path` | Write the JSON report (`report_version` 2.0.0). `json=` is deprecated. | [Output](https://github.com/simulationcraft/simc/wiki/Output) |
| `html=path` | HTML report (optional, e.g. for a "full report" link) | same |
| `output=path` | Redirect most stdout/logs to a file | same |
| `report_details=0/1` | Extra ability detail in the HTML report | same |
| `profileset."name"=opt` / `+=opt` | One variant of the baseline actor per set; `.` not allowed in names | [ProfileSet](https://github.com/simulationcraft/simc/wiki/ProfileSet) |
| `profileset_work_threads=N` | Threads per profileset worker. Workers = `floor(threads / profileset_work_threads)`. | same |
| `profileset_metric=dps` | Metric collected per profileset | same |
| `single_actor_batch=1` | Sim each actor separately (used by the official PGO training run) | Dockerfile |
| `process_priority=` | Default `below_normal`; keeps the box responsive | [Options](https://github.com/simulationcraft/simc/wiki/Options) |
| `max_time`, `fight_style`, `desired_targets` | Fight shape (default 300 s, Patchwerk-like) | [Options](https://github.com/simulationcraft/simc/wiki/Options) |

**Profilesets = the Top Gear mechanism.** One baseline actor is kept in memory, and each profileset is simmed in its own
environment against it. Memory stays at about 2 actors no matter how many sets there are.

- Limits: a single baseline actor only, no scale factors or plots, and `report_details=0` is forced.
- Verified run: baseline MID2 Frost DK plus 2 profilesets, `target_error=0.5 threads=16`, 216–231 iterations each, a few seconds total.
- `json2` shape: `sim.profilesets = { metric, results: [ { name, mean, median, min, max, stddev, mean_stddev, mean_error, first_quartile, third_quartile, iterations } ] }`.
  The baseline's DPS is in `sim.players[0].collected_data.dps.mean`.

## Open questions surfaced

1. **How is the SimC binary delivered at runtime?** Pinned-tag `COPY --from` at image build (update = rebuild or pull a new app
   image) vs. a runtime `docker pull` via the socket vs. the app building SimC itself into a volume. This decides what "apply
   SimC Update" physically does.
2. **Alpine/musl base for the app image?** Only needed if we reuse the official binary. Bun has `oven/bun:alpine`; check Bun + musl is fine.
3. **Can a SimC Update target a commit with no nightly tag?** Nightly granularity (≈1/day) is probably fine. Otherwise we need an in-app source build (≈2 min on 16 threads, plus a clone).
4. **Top Gear sim settings:** the `target_error`/`iterations`/`profileset_work_threads` values that balance speed against ranking stability.
   Raidbots-style staged elimination (a coarse pass, then a fine one) needs benchmarking with real gear sets.
5. **arm64** is not published. It is irrelevant for this 16-thread x86 box, but it limits portability (e.g. Apple Silicon Docker would need emulation or a source build).
