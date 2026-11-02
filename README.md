# No Brakes

An endless highway driving game for the browser, built with Three.js. It's a fork of Downhill Challenge (Just Ski): you drive a sports car up an eight-lane highway, it keeps getting faster, and there are no brakes. Every hit damages the car, and when the damage meter runs out it conks out, so weave through traffic, dodge roadworks and rock slides, and jump the collapsed bridges. There is no build step.

## Run

ES modules need a local server; opening `index.html` directly from disk won't work. Use the bundled dev server, which turns off caching so your edits show up on reload:

```bash
python3 tools/serve.py
```

Then open http://localhost:5175. (It uses 5175 so it can run alongside the ski game on 5174.)

## Install on a phone (PWA)

`manifest.json` makes the game installable with its own icon and fullscreen launch, and `sw.js` caches it so it plays offline.

Service workers only run on `https://` or `localhost`. On your local network (`http://<your-mac-ip>:5175`) the game still plays, and iOS can still "Add to Home Screen", but it won't work offline and Android won't offer a real install. For the full PWA, serve it over HTTPS (any static host works).

If you add a file under `src/`, add it to `SHELL` in `sw.js`, and bump `CACHE` on every change so phones pick it up. Icons are drawn by `tools/make_icons.py` (needs Pillow).

## How it plays

- **Steer:** drag left and right, or use ←/→ or A/D. Let go and the wheel straightens itself.
- **Nitro:** keep a finger on the screen for a moment (you keep steering), or hold ↑, W, Space or Shift. Your top speed goes up by a third and every metre on nitro scores double, but the steering gets twitchier. A full tank lasts 5 seconds of burn; blue nitro bottles floating over the road (about one every 250 m) each refill half a tank, and only show up when the tank isn't full. The Nitro meter is under the HUD.
- **No brakes:** the car always pulls toward its cruising speed, which climbs from about 54 mph to about 125 mph over the first 7 km. ↓ just squeaks.
- **Damage:** the Car meter starts full and every hit takes a bite out of it: how much depends on how fast you were closing on the thing you hit (in the direction you hit it) and how hard it is. Clipping a car you're passing or the guardrail costs a little; rear-ending a slow semi costs a lot; a concrete barrier head-on at speed can finish you in one go. Barrels, hay bales, crates and lost tyres you smash straight through; barriers, machinery, broken-down cars, rocks and traffic you bounce off, with the nose knocked aside so you can slide clear. Very hard landings dent it a little too. Chrome wrenches floating over the road (about one every 600 m) each repair 35 points, and only show up once the car is damaged. Below half it starts smoking, the paint dulls, the bumper sags and the spoiler works loose, and below a quarter the engine misfires.
- **Conking out:** when the meter hits zero the run is over. If the last hit was a small one the engine just dies and the car rolls to a stop in a cloud of steam; if it was a big one, it's a full tumbling wreck. Driving off a collapsed bridge is always the end.
- **Traffic** all goes your way and is always slower than you. It follows the car in front, signals and changes lanes to get round slow vehicles and anything blocking the road, and merges out of closed lanes. It sees your car too: crash or get slowed right down and it brakes behind you and steers round. At least three lanes are always left open where it spawns.
- **Things roll across the road** now and then, whatever the landscape has loose: round hay bales in farm country, tumbleweeds in the desert (harmless), logs in the forest, cable spools in the city and boulders in the canyon and mountains. Time it, swerve round it, or jump it. If one reaches a car first, it smashes into it and leaves it wrecked in the road with its hazards on.
- **Collapsed bridges** ("BRIDGE OUT") cut the road over a river canyon. Hit a ramp at the edge to jump it; barricades mark where there's no ramp.
- **Oil slicks** make the tyres slide. **Turbo pads** fire you forward. **Cones** and warning triangles just go flying (5 points each).
- **Scenery** changes every 1.5 km: farm country, desert, red rock canyon, forest, a mountain pass, then the city, and round again. In the canyon and on the mountain pass the road runs through a cut between steep banks, and only there do rock slides block lanes and boulders roll across the road. Day turns to night and rain showers come and go; after dark every car's tail lights glow and its headlights throw a pool of light on the road ahead (faked with additive glow quads, not real lights, so night costs next to nothing).
- **Settings:** pick your car (Coupe, Muscle, Hot Hatch, Pickup, Supercar or Roadster), its paint, stripes and rims, and how sharply touch steering responds. The styles are only skin deep: every car has the same size hitbox and handles the same.
- **Score:** 1 point per metre (2 on nitro), 25 per close call (passing a vehicle with less than 0.9 m to spare), 50 for flying right over one, 100 per bridge jumped, 5 per cone, plus an airtime bonus. Your best score and furthest distance are saved.

## Layout

| File | What it does |
| --- | --- |
| `src/main.js` | Renderer, game states (menu → ready → run → crash → results), countdown, camera, scoring, close calls, nitro and wrench pickups |
| `src/terrain.js` | Endless procedural highway: road, guardrails, biomes and scenery, collapsed bridges and their ramps, roadworks, lane merges, broken-down cars, debris, rock slides, oil, pads, crossers, nitro and wrench pickups (coins are switched off) |
| `src/traffic.js` | Same-direction traffic: spawning, lane following, lane changes, stopping, getting hit |
| `src/vehicles.js` | Low-poly traffic models (sedan, hatchback, SUV, pickup, van, box truck, bus, semi) and broken-down cars |
| `src/car.js` | The player's car in six body styles, and its animation (steering, roll, nitro flames, visible damage, wreck tumble) |
| `src/physics.js` | Car physics: gravity, the always-on engine and nitro tank, steering and grip, guardrails, collisions and damage |
| `src/input.js` | Keyboard and touch: dragging steers, a finger held down fires the nitro |
| `src/ui.js` | HUD (with the Car and Nitro meters), start hint and results |
| `src/scenery.js` | Distant mountains, clouds, tyre smoke, damage smoke and steam, guardrail sparks |
| `src/effects.js` | Coin pickup animation, crash debris, knocked cones |
| `src/environment.js` | Day/night cycle and rain |
| `src/nightlights.js` | Headlights after dark: glowing lamps, tail-light halos and light pools on the road |
| `src/audio.js` | Synthesized sound (Web Audio): engine, road, squeal, nitro, crashes, horns, mute setting |
| `src/save.js` | `localStorage` best scores and the car's style and colours |

## Tuning knobs

- **Speed:** `CRUISE_START`, `CRUISE_END` and `CRUISE_RAMP` in `src/main.js`; `BOOST` (nitro multiplier), `ACCEL` and `COAST` in `src/physics.js`.
- **Repairs:** `REPAIR` (health per wrench) in `src/main.js`; `WRENCH_CHANCE` (how often wrenches appear) in `src/terrain.js`.
- **Collisions:** the car, obstacles and traffic are rotated boxes (`boxOverlap()` in `src/physics.js`), sized by each obstacle's `hw`/`hl` in `layoutFor()` and each vehicle's `W`/`L` in `src/vehicles.js`.
- **Nitro tank:** `NITRO_TIME` (seconds in a full tank) in `src/physics.js`; `NITRO_REFILL` (share of a tank per bottle) in `src/main.js`; `NITRO_TANK_CHANCE` (how often bottles appear) in `src/terrain.js`.
- **Damage:** in `src/physics.js`: `HIT_DAMAGE` and `HIT_FREE` (the formula), `HARDNESS` per obstacle, `VEHICLE_MASS` per traffic type, `SMASH_KEEP` (speed kept smashing through light things), `RAIL_HARDNESS`, `LANDING_FREE` and `LANDING_DAMAGE`, `CROSSER`, `WRECK_HIT` (a finishing blow this big is a tumbling wreck rather than a conk-out), `CONK_DECEL` and `KNOCK_TIME`.
- **Car styles:** `STYLES` in `src/car.js` (each one's side profile, wheels, lights, spoiler and extras); `STYLE_IDS` in `src/save.js` sets the order in Settings.
- **Steering:** `TURN_RATE`, `TURN_FALLOFF`, `BOOST_TURN`, `CENTER` (self-centering), `LAT_MAX` (most sideways speed), `GRIP` and `OIL_GRIP` in `src/physics.js`. Touch sensitivity is the slider in Settings; `STEER_PX` in `src/input.js` is the drag for full lock at 100%.
- **Traffic:** `density()` and `speedFor()` in `src/traffic.js` (vehicles per 100 m and cruising speeds), `pickType()` for the mix, `FOLLOW`, `LOOK`, `CHANGE_TIME` and `SIGNAL` for driving behaviour, `EXIT_AHEAD` and `EXIT_SEEN` for how traffic leaves before a collapsed bridge.
- **Roadworks and merges:** `planZone()` in `src/terrain.js` (how many lanes close, taper and closure lengths, machinery); how often in `layoutFor()`.
- **Hazards:** broken-down cars, debris and rock slides in `layoutFor()`, `spill()` and `rockSlide()`; rolling crossers in `crossersFor()` (what rolls where: `CROSSER_KIND` in `src/terrain.js`; what each does to you: `CROSSER` in `src/physics.js`); oil in `oilFor()`; pads in `padsFor()`; ramps in `rampsFor()`.
- **Collapsed bridges:** `gapFor()` in `src/terrain.js` (how often, how wide), `rampsFor()` for their ramps, and `GAP_DEPTH`, `GAP_RUNUP`, `GAP_CLEAR` and `GAP_STOP`.
- **Biomes:** `BIOMES`, `BIOME_LEN`, `BIOME_BLEND` and `BIOME` (ground colours, hills, the height of the road cut and the snow line) in `src/terrain.js`; `ROCKY` (which biomes get rock slides and boulders); what grows where in `buildScenery()`.
- **Coins:** `COINS_ENABLED` in `src/terrain.js` (off for now, since there's nothing to spend them on).
- **Scoring:** the `*_POINTS` constants and `CLOSE_GAP` in `src/main.js`, and the airtime bonus in `onLanding()`.
- **Day/night and weather:** `src/environment.js`.
