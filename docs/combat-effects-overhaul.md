# Combat effects overhaul — 2026-09-06

The client now draws velocity-based ballistic exposures with a tapered warm core,
soft edges, and a small view-facing tip. Tracer width follows the physical render
resolution so the core stays visible against bright sky at distance. World effects use rendering group 0 and
retain world depth. Local muzzle flames share the viewmodel group. Effects are
compiled during startup so shader compilation does not consume the first flash.

## Projectile corrections

- Confirmed shots use the server origin and launch vector. A short muzzle offset
  blends out over the first eight meters instead of bending the entire flight.
- Local confirmation preserves elapsed flight time; expired predicted rifle shots
  are not replayed. Action rejection affects only the local shooter's effects.
- Remote flights account for wrapped server ticks with 50 ms of presentation slack.
  Initial cosmetic age is capped at 20 ms / 15% of the flight so delayed events
  cannot expire before drawing. Impacts still clip the authoritative endpoint.
- Gravity applies once. Impact time is recovered from ballistic displacement,
  including impacts inside the launch tick. The clipped head disappears while
  the exposure tail advances into the impact; there is no parked endpoint glow.
- Confirmed future impacts are presented when the visual flight arrives. Late
  impacts present immediately. Pool replacement retains pending impact feedback.
- Offline practice sweeps the rendered flight against map surfaces for impacts.
  Online damage, hits and collisions remain server-authoritative.

## Rendering and HUD

Muzzle effects combine a variable flame sprite, axial jet, short light pulse and
drifting smoke. Impacts combine dust or a brief player hit puff with small moving
fragments. Bullet holes are actual triangle-clipped decals projected onto the
render mesh using impact normals. Non-pickable static map meshes are included in
these explicit cosmetic queries; grass and effects are excluded. Holes are visual
surface marks, not changes to geometry, cover or penetration rules.

The fixed budgets are 96 flights (two meshes each), 16 muzzle flashes, 96 particles,
3 transient lights and 512 decals. Each admitted decal fades over its final five
seconds and expires after 45 seconds. New shots never evict existing holes; if the
emergency global capacity is reached, new decals are skipped until slots expire.
There is no per-area replacement limit. Bullet holes use a simple round recess
and rim without the earlier spiral/crack pattern.
Round changes, respawn and session reset clear presentation. Materials and textures
are shared and disposed with the owning module.

Hit confirmation uses a compact animated white marker and a distinct red kill
confirmation. Rounded damage totals accumulate for the same target within one
second; changing targets resets the total. Markers last 230 ms, while numbers stay
readable for 1.1 seconds (1.4 seconds on kills). Incoming damage arcs retain their
world bearing as the camera turns. Health drives a smoothed peripheral blood
overlay (softened and desaturated to reduce explicit detail), vignette and desaturation, with a subtle critical-health pulse that
respects reduced-motion preferences. The aiming area remains clear.

## Reference research

- EA's [Battlefield 2042 update 6.0 notes](https://www.ea.com/games/battlefield/news/battlefield-2042-update-notes-6-0)
  discuss preserving attacker direction in incoming hit indicators.
- EA's [Battlefield 6 update 1.4.1.0 notes](https://www.ea.com/games/battlefield/redsec/news/battlefield-6-game-update-1-4-1-0)
  describe reducing incoming-hit blur near the center. This informed the choice
  to concentrate trauma at the screen edges.
- Epic's [Set Fade Out documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Rendering/Components/Decal/SetFadeOut)
  describes independently setting decal fade delay and duration. This informed the
  lifetime-first policy rather than replacing nearby holes on each shot.
- Babylon's [decal documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/decals)
  and the installed 9.22.1 decal builder define projection, normal, clipping and
  culling behavior. The installed rendering-group and StandardMaterial code were
  used to check transparency, depth writing and shader preparation.

These are independently implemented effects inspired by military shooters; no
Battlefield textures, models or proprietary shaders were imported. Pixel-for-pixel
equivalence to a particular Battlefield release is not established.

## Validation

- Client typecheck and production build.
- 140 unit tests, including camera pass-by, future impact delivery, action-ID
  isolation, 30/60/144 FPS exposure drainage, tick rollover, launch-tick and
  uphill/downhill impact timing, real decal geometry, density and expiration.
- Four focused Chrome/SwiftShader browser checks: deterministic VFX/HUD capture,
  offline shooting, online shooting, and remote gunfire between two clients.
- The deterministic browser fixture reads rendered pixels: a tracer behind a
  concrete wall leaves the sampled pixel unchanged; moving it in front changes
  the pixel. It also checks target-specific damage totals, kill feedback,
  indicator rotation, and independent marker/number expiration. A separate bright-sky
  pixel check exercises delayed side-on gunfire at 120 m without any hit event.
- The broader existing movement/stance browser scenario failed before reaching
  its shooting section (remote slide/prone state assertions). This pass does not
  establish that unrelated scenario as passing. Native hardware GPU performance
  and full-server sustained-fire budgets have not been measured.

Run the focused browser checks with:

```sh
cd client
npm run test:e2e -- combat-effects.e2e.ts game-visibility.e2e.ts --grep 'renders muzzle|receives remote|offline localhost|online quick'
```

Captures are written to `client/test-results/`; the fixture imports the production
effects and HUD without adding any debug controls to gameplay.

## Generated texture provenance and prompt

Saved asset: `client/public/effects/trauma.png`, 1672 × 941 RGBA PNG, 614 KiB.
SHA-256: `571d9dc867a3a62c43e03d6bc2f327acfa68332222be8caa6cb88b07c8c5d4a4`.
Generated using the built-in imagegen tool on 2026-09-06, with no reference image;
copied unchanged into the project and consumed by `military.css`. The alpha
channel was inspected: extrema 0–255; central 40% region alpha is 0–1/255.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: production game VFX texture, fullscreen first-person low-health blood-on-lens overlay, landscape 16:9, 1536x864 or similar. Primary request: create an original ultra-realistic photographic transparent PNG of a VERY SPARSE peripheral blood splatter and smears on invisible camera glass. This is ONLY an overlay texture, no scene or UI. Actual transparent alpha background, not black, white or checkerboard. At least the central 75 percent width and 65 percent height is COMPLETELY TRANSPARENT and unobstructed; all marks cling to the extreme outer corners and edges. A few asymmetric dark burgundy semitransparent fluid smears in top-left and bottom-right corners, scattered tiny irregular droplets and watery fine spray along the outside 8 percent perimeter. Natural varied droplet scales, broken uneven feathery translucent edges, organic clumping and liquid surface tension. Dark wine-red, subtle warm highlights, soft out-of-focus transparent wisps. Cinematic military FPS realism. No solid red frame, no thick continuous border, no cartoon vector blobs, no repeating patterns, no people, no injuries, no text, no lettering, no logos, no watermark. Preserve a clean fully transparent center for aiming; absolutely no paint or haze across center.
