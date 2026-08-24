# Fast live combat configuration

`fast_live_combat_game_config.json` is an opt-in fixture for local live
integration acceptance. It keeps the production movement and map-compatible
dimensions, but makes a rifle or shotgun hit lethal, removes initial spawn
protection, sets the score limit to one, respawns after 0.25 seconds, waits 1.5
seconds in intermission, and limits rounds to five seconds.

From the repository root, launch a built server explicitly with:

```sh
GAME_CONFIG_PATH="$PWD/server/tests/fixtures/fast_live_combat_game_config.json" \
WEB_API_URL="" SERVER_SHARED_SECRET="" \
./server/build/server
```

With two local clients, one accepted hit can therefore exercise `Damage`,
`Death`, `Ended`, and `Intermission`; the victim then receives `Respawn` before
the intermission ends, followed by `Reset` and `Started`. The fixture is never
selected by default. A server without `GAME_CONFIG_PATH` continues to load
`server/game_config.json`.
