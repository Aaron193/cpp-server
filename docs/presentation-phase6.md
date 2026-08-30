# Phase 6 presentation contract

Phase 6 keeps simulation and authority unchanged while replacing placeholder character,
viewmodel, sound, effects, HUD, and replay presentation. The current wire contract is protocol v9.

## Authority boundary

- `SimulationAim` mirrors input yaw/pitch and is the only presentation service allowed to
  derive a command/shot direction. `CameraRigController` adds correction residual, step and
  crouch easing, bob, landing, damage shake, recoil punch, and FOV easing to rendering only.
- Fire and reload use generated nonzero `actionId` values distinct from input ordering.
  The server validates cadence, ammo, life/match/reload state, sends owner-only
  `ActionResult`, and includes the action ID in `ShotConfirmed`. Rejection/timeout removes
  correlated tracer/muzzle cosmetics; it never changes authoritative ammo or health.
- Remote actor roots are interpolated capsule feet/body yaw. Every authored alignment and
  animation transform is below a calibration child. Wall tuck is a presentation weight.

## Fixed budgets

| Family | Capacity/policy |
|---|---|
| Muzzle flashes | 12, lowest-priority/oldest replacement |
| Impacts | 40, lowest-priority/oldest replacement |
| Tracers | 28, lowest-priority/oldest replacement |
| Transient lights | 3 shared slots |
| Decals | 96 total, 6 per 8 m cell/material |
| Audio voices | 24 total plus per-cue limits; priority/age voice stealing |
| Combat presentation events | 128 ring entries; 64 pending actions |
| Killcam poses/events | 7,680 poses and 256 events by default |
| Radar rumors | 16, 2.4 second fade |

No family grows with match duration. WebAudio source nodes are one-shot by platform design,
but active references are capped and stolen deterministically.

## Original assets and calibration

The operator, hands, and weapons are original code-authored Babylon geometry. Socket and
hit-capsule calibration values live in `ActorPresentation.ts` and
`ViewmodelController.ts`; automated audits cover torso/head alignment, hand-to-muzzle
ordering and separation, and optic centering. The eight WAV files are deterministic output
from `scripts/generate-phase6-audio.mjs`. No reference-game source or media was copied.

## Information policy and replay

Radar is north-up and uses manifest world bounds, north yaw, and the packaged radar image
without square distortion. FFA never consumes live enemy poses. It displays only the local
cone and bounded, fading last-gunfire rumors. `KillcamBuffer` records rendered poses and
shot/impact/death events in fixed tapes, samples the three seconds before local death, and
uses attacker framing with a first-person fallback when a camera collision probe fails.
After 3.6 seconds the HUD transitions from killcam to spectator until authoritative respawn.

## Verification and remaining visual risk

The pure stepped-clock suite covers locomotion, rig/socket audits, one-way camera/reset/FOV,
action accept/reject/timeout, FX/audio replacement, radar privacy/aspect, all HUD state
combinations, and killcam capacity/playback/collision fallback. Generated TS/C++ goldens,
malformed protocol tests, full native suites, client typecheck/tests/build, fixture lock, and
map reproducibility checks are required gates.

Headless captures validate mesh visibility and combat feedback, but artistic gait quality,
camera comfort, positional mix balance, and wall-tuck clipping still need a human review on
WebGPU and WebGL2 at 16:9, 4:3, and ultrawide. Tune only presentation constants; do not move
capsule, shot ray, or authoritative timing to make a capture look better.
