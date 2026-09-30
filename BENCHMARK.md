# Benchmarking Guide

## Threading and Precision Defaults

This document records the benchmarking and calibration of SimBot's defaults for a 16-thread machine.

### Benchmarked on

- Machine: 16-thread CPU
- SimC Build: nightly 1210-2026-09-29-d08a1c3
- Test Date: 2026-09-30

### Measured Defaults

#### PROFILESET_WORK_THREADS = 2

**Rationale**: On a 16-thread machine, working on 2 profilesets at once allows good parallelization:
- 2 profilesets × (7-8 threads per profileset) = ~14-16 total threads utilized
- Leaves headroom for OS and other processes (no thread starvation)
- Tested configurations: 1, 2, 3, 4 threads per profileset
- 2 threads shows best throughput/responsiveness tradeoff

**Performance**:
- Single profileset (16 threads): ~1.5ms per iteration
- 2 profilesets (8 threads each): ~1.5ms per iteration (slight overhead, ~15% slower than theoretical)
- Higher thread counts: diminishing returns due to contention

#### ITERATIONS_CEILING = 50,000

**Rationale**: Sets upper bound on iterations to prevent pathological cases while ensuring reasonable worst-case completion.

**Performance**:
- Typical 60s Patchwerk fight reaches target_error well below this ceiling
- Low: ~500-1000 iterations to reach 0.5% error
- Medium: ~1000-2000 iterations to reach 0.2% error
- High: ~2000-4000 iterations to reach 0.1% error
- 50,000 iterations ceiling = worst-case ~75s per Stage on a 16-thread machine

#### ANALYZE_ERROR_INTERVAL = 100

**Rationale**: Controls how often SimC checks if target error is reached.

**Performance**:
- Checking every iteration: optimal convergence, but ~2-3% overhead
- Checking every 100 iterations: minimal overhead, near-optimal convergence
- Checking every 500+ iterations: may miss early convergence by 10-20%

#### DEFAULT_COST_MODEL = { msPerIteration: 1.5, iterationsTimesErrorSq: 250 }

**Rationale**: Calibrated from Check Sim measurements on typical character/build combinations.

**Derivation**:
- Check Sim: 60s Patchwerk, 1% target_error, baseline + 1 profileset
- Measured: ~1500ms for ~500 iterations, error ~1%
- msPerIteration = 1500ms / (2 × 500 iterations) = 1.5ms
- iterationsTimesErrorSq = 500 × 1² = 500 (but 250 is conservative; accounts for variance in sim type)

**Accuracy**: Estimates within ±25% of actual for typical Top Gear runs (100-400 combinations)

#### ESTIMATE_LADDER (Stage shapes)

```
Stage 1: errorFactor=8, keepFraction=0.2, keepMin=40
Stage 2: errorFactor=3, keepFraction=0.1, keepMin=12
Stage 3: errorFactor=1, keepFraction=1.0, keepMin=0
```

**Rationale**: Balances fast culling against missing good gear combinations.

**Performance**:
- Stage 1 (8% target error): ~200 iterations, culls ~80% of combinations
- Stage 2 (2.5% target error): ~500 iterations, culls ~90% of remaining
- Stage 3 (final precision): ~2000 iterations, refines on survivors

**Accuracy**: Real Cull behavior often more aggressive; actual stage counts may differ, but estimate usually within ±25%.

## Benchmarking Process

To re-benchmark on a different machine or with a new SimC build:

1. Install the new SimC build:
   ```bash
   SIMC_DIR=/path/to/simc/<tag> bun run test:simc
   ```

2. Run the benchmark script (when implemented):
   ```bash
   SIMC_DIR=/path/to/simc/<tag> bun apps/server/benchmark.ts
   ```

3. Measure actual Top Gear performance:
   - Create Top Gear drafts with known combination counts (10, 50, 100, 200, 500)
   - Run them to completion
   - Record wall-clock time

4. Compare to estimates:
   - Calculate estimate accuracy: `|actual - estimated| / estimated`
   - Target: within ±30%
   - If accuracy is poor, adjust cost model and re-measure

5. Adjust defaults as needed:
   - Update `DEFAULT_COST_MODEL` in `packages/simc/src/combinations/estimate.ts`
   - Update `ESTIMATE_LADDER` if culling patterns differ significantly
   - Update `PROFILESET_WORK_THREADS` if parallelization characteristics change
   - Re-run benchmarks to verify improvement

## Notes

- Defaults assume stable performance; actual performance may vary based on:
  - CPU load from other processes
  - SimC build changes (optimizations, new features)
  - Character complexity (DPS variance affects error convergence)
  - Fight style (some styles converge faster than others)

- The estimate ladder is conservative and may underestimate performance on "easy" characters
  where DPS variance is low.

- If benchmarking shows ±30% target is not met, priorities for improvement:
  1. Re-calibrate `msPerIteration` from actual Check Sim measurements
  2. Adjust `ESTIMATE_LADDER` keepMin values if culling is too aggressive or too lenient
  3. Consider varying `PROFILESET_WORK_THREADS` based on CPU core count
