# Source, asset, and attribution inventory

Status date: 2026-08-28. This is an engineering provenance control, not legal
advice. The repository is distributed under GPL-3.0 via `LICENSE`; the empty
`author` and `ISC` fields in the two npm package manifests are historical
package metadata and must not be treated as a separate grant for project code.

## Independent-reimplementation policy

The reference captures under `.internal/example-games/` are design evidence
only. Do not copy source, generated data, maps, meshes, textures, audio, fonts,
or other assets from them unless ownership, license text, compatibility, and
required attribution have first been recorded here and approved. Implement
ideas independently against this project's Babylon/Jolt architecture. In
particular:

- the voxel-game capture has no root license in the captured root; package
  metadata and its limited skybox credit are not permission to copy the whole;
- the kong-game capture has no located code license; its page attributes a
  Dust2 mesh to vrchris under CC-BY-4.0, but that mesh and generated Dust2 data
  are not approved inputs for this project;
- no Phase 0 source or asset was copied from either reference capture.

## Repository and runtime inputs

| Input | Where used/distributed | Recorded terms/provenance | Status/action |
|---|---|---|---|
| Project TypeScript, C++, scripts, and authored graybox source | Repository and production builds | Root `LICENSE`, GPL-3.0 | Approved project input. |
| `graybox-arena.gltf` and generated `scene.glb`, `collision.bin`, manifest/debug report | Client/server images | Generated deterministically from the checked-in project graybox source; hashes are frozen in `protocol/fixtures/phase0-fixture-lock.json` | Approved project input; no external map or texture is embedded. |
| Babylon.js `@babylonjs/core`, `@babylonjs/loaders` 9.22.1 | Browser production bundle | Apache-2.0 per locked npm package metadata | Retain upstream notices/license in release compliance output. |
| `jolt-physics` 1.1.0 / JoltPhysics.js | Browser WASM production bundle | MIT per locked npm package metadata | Retain upstream notice. |
| Jolt Physics 5.6.0 | Native server | MIT; pinned through vcpkg commit `9e593bb18ea69cc5095e012465dcd675a822ed0d` | Retain upstream notice. |
| uWebSockets, EnTT, GLM, cpp-httplib, nlohmann/json | Native server | Direct vcpkg inputs in `server/vcpkg.json`; upstream terms are respectively Apache-2.0, MIT, MIT, MIT, and MIT | Preserve vcpkg-generated copyright/SPDX data in release compliance output. |
| Fastify and plugins, argon2, dotenv, Drizzle ORM, fastify-type-provider-zod, jsonwebtoken, pg, zod | Web production image | Direct versions and declared licenses are locked in `web/package-lock.json` (MIT, BSD-2-Clause, or Apache-2.0 as recorded there) | Lockfile is the complete npm package/version inventory; ship collected package notices. |
| Vite build/runtime dependencies and test/dev tools | Build/test environments; some Vite runtime helpers enter browser bundle | Complete versions and declared licenses in `client/package-lock.json` | Treat lockfile/SBOM as authoritative transitive inventory; MPL-2.0 Lightning CSS binaries require their notices/source-offer obligations to remain intact where distributed. |
| Orbitron and Inter web fonts | Fetched at runtime from Google Fonts by `client/index.html`; not stored in this repository | Both font families are offered under SIL Open Font License 1.1 by Google Fonts | External runtime dependency. For self-hosting, add exact font files/hashes and OFL text here first. |
| Phase 6 articulated operator and viewmodel | Browser production bundle in `EntityViewsModule.ts`, `ActorPresentation.ts`, and `ViewmodelController.ts` | Original code-authored geometry, rig calibration, sockets, and animation created for this repository; no external mesh, rig, animation, or texture input | Approved project input under root GPL-3.0. Source code is the reproducible asset source. |
| Phase 6 WAV registry (`client/public/audio/*.wav`) | Browser production audio | Original deterministic PCM synthesis authored for this repository by `scripts/generate-phase6-audio.mjs`; no samples, recordings, model outputs, or external media | Approved project input under root GPL-3.0. Regenerate with the checked-in script; runtime oscillator synthesis is not used. |
| `node:20.19.5-alpine`, `node:20.19.5-bullseye[-slim]`, `nginx:1.27.5-alpine`, `ubuntu:22.04`, `postgres:16-alpine` | Builder/production/container deployment | Pinned image tags in Dockerfiles/Compose; each image is an aggregate with multiple licenses | Generate and archive an image SBOM/notices at release time; digest-pin for release reproducibility. |

The npm lockfiles and vcpkg-generated SPDX/copyright records enumerate
transitive code inputs; this document deliberately does not restate hundreds
of transitive rows where the machine-readable inventory is already complete.

## Binary media audit

These repository files have no provenance or license record in the checked-in
history available to this audit. They are not referenced by the current 3D
production source, but repository distribution still conveys them. Do not add
them to a production bundle or derive new assets from them until ownership is
resolved. Remove them in a separately authorized cleanup if they are obsolete.

| Files | SHA-256 | Status |
|---|---|---|
| `client/src/assets/img/bush.png` | `0b832ba755599fb167432adc1d03d812684a410074346966e1163abdb9dc7901` | Unknown provenance; quarantined/unreferenced. |
| `client/src/assets/img/bush_1.png` | `86ef57b2827b990355939a731ca795cd5dbd43a5fb5c577a9b652cdf3748a4c2` | Unknown provenance; quarantined/unreferenced. |
| `client/src/assets/img/bush_2.png` | `21b44044e1df1aae14e7bb00661e884ce81b0cf5b3ae6643429dcc27ab7e6d6a` | Unknown provenance; quarantined/unreferenced. |
| `client/src/assets/img/rock.png` | `b662010b8e590256201d3b372e468758f8be45c2232a78b344c79776ff33a7a8` | Unknown provenance; quarantined/unreferenced. |
| `client/src/assets/img/rock_1.png` | `191c7d1df87452652537d372c10b90ce2a22f834f9f5f7b0b9ca208c66e6af16` | Unknown provenance; quarantined/unreferenced. |
| `client/src/assets/img/rock_2.png` | `e66387e4ec461e546cd3a2fe9ae07797d3fa0b3c1d2a8985ac0c858973e070c9` | Unknown provenance; quarantined/unreferenced. |
| `cpp_game.gif` | `fa6fcb5a32e6130be93e83edac0c2e7e32ea6557893adbe3314037e8982e6d39` | Unknown provenance; documentation-only/unreferenced by runtime. |

## Required update rule

Every new copied or distributed third-party input must add: origin URL or
supplier, author/owner, exact version or content hash, license identifier and
license text location, required attribution, modified/unmodified status, and
the production surfaces that distribute it. Unknown-license inputs remain
quarantined and cannot enter runtime packages.
