# Rendering quality and performance budget

Phase 5 keeps `RenderingModule` as the Babylon engine/scene owner. Quality,
environment/lighting, post-processing, asset sampling, and world presentation
are separate services. Tier selection occurs after engine creation so it can use
the selected backend and measured engine limits.

## Quality ladder

| Tier | DPR cap | Resolution scale | Directional shadow map | Shadow casters | Anisotropy cap | Decorative budget |
|---|---:|---:|---:|---:|---:|---:|
| high | 2.0 | 1.00 | 2048 | 64 | 16x | 32 |
| medium | 1.5 | 1.00 | 1024 | 32 | 8x | 20 |
| low | 1.0 | 0.80 | off | 0 | 4x | 8 |
| software | 0.75 | 0.65 | off | 0 | 1x | 2 |

The effective DPR is reevaluated on window, visual viewport, monitor, and zoom
changes. It is always capped at 2. `renderTier=low` and
`renderTier=software` captures request a non-multisampled framebuffer; if the
actual sample count is one, Babylon uses one FXAA post-process and ordinary
alpha test. A multisampled target uses its actual sample count and
alpha-to-coverage. There is no separate final grade pass: ACES tone mapping,
map exposure, contrast, and canvas sRGB output stay in Babylon image
processing.

## Provisional browser budgets

These are Phase 5 capture gates, not claims about every GPU. Revisit them only
from representative distributions; do not infer a hardware tier from the Node
proxy or SwiftShader.

| Metric after a 10 s warm-up | high/medium target | low target | software target |
|---|---:|---:|---:|
| frame p50 | <= 16.8 ms | <= 16.8 ms | <= 33.4 ms |
| frame p95 | <= 25 ms | <= 33.4 ms | <= 50 ms |
| shader readiness | ready | ready | ready |
| shadow casters | <= tier budget | 0 | 0 |
| final grade passes | 0 | 0 | 0 |
| effect utilization | <= fixed capacity | <= fixed capacity | <= fixed capacity |

Draw calls, active meshes, and triangles are recorded as characterization
facts because their useful thresholds depend on the selected map and actor/effect
load. Texture facts record imported texture count, compressed-source count,
trilinear policy, applied anisotropy, and preserved PBR material count.

## Current representative captures

Captured on 2026-08-28 in this workspace:

- `npm run smoke:performance` under Node 22 headless: p50 `0.001213 ms`,
  p95 `0.018044 ms` for the existing 1,200,000-operation allocation proxy.
  WebGPU, WebGL2, draw calls, active meshes, and GPU timing were unavailable
  and remain `null`; this is not a GPU result.
- `npm run test:e2e -- e2e/rendering-quality.e2e.ts` in headless Google Chrome
  using SwiftShader, forced WebGL2/software tier, 1280x720 CSS pixels, DPR 1:
  60 reported FPS, frame p50 `16.7 ms`, frame p95 `33.3 ms`, 23 draw calls,
  22 active meshes, 312 active triangles, shaders ready, 22 preserved PBR
  materials, no texture assets in the graybox package, one bounded decorative
  instance, FXAA with one input sample, shadows off, and zero final grade
  passes. The short smoke includes startup/warm-up frames, so it is a current
  characterization rather than proof of the 10-second steady-state gate.
- No native hardware-GPU WebGPU or WebGL2 capture was made. WebGPU selection is
  policy-tested and exposed for capture, but unsupported GPU numbers are not
  reported here.

## Capture hooks

Development builds expose `window.__arenaProfile()` and include rendering facts
in `window.__gameDebug().rendering`. Use query parameters for deterministic
browser matrices:

```text
?renderBackend=webgl2&renderTier=software
?renderBackend=webgl2&renderTier=low
?renderBackend=webgpu&renderTier=medium
?renderBackend=webgpu&renderTier=high
```

An explicitly requested WebGPU backend fails visibly if unavailable instead of
silently contaminating the capture with WebGL2. Record the browser, OS, GPU and
driver, map hash, viewport, DPR, warm-up interval, backend, tier, and full
profile payload with every manual hardware capture.
