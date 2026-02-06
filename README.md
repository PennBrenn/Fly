# Glider Tycoon - 3D Flight Simulator

A browser-based 3D glider flight simulator/tycoon game built with Three.js. Fly thermals, trade commodities, complete missions, and customize your glider.

## Play

Open `index.html` in a modern browser, or deploy to Vercel as a static site.

## Controls

| Key | Action |
|-----|--------|
| W / ↑ | Pitch down (nose down) |
| S / ↓ | Pitch up (nose up) |
| A / ← | Roll left |
| D / → | Roll right |
| Q | Yaw left (rudder) |
| E | Yaw right (rudder) |
| Space | Speed brake |

## Features

- **Procedural World**: Perlin noise terrain with Plains, Mountains, Ocean, and Island biomes
- **Realistic Aerodynamics**: Lift, drag, angle of attack, stall, and weight physics
- **Thermal & Ridge Lift**: Find rising air to stay aloft — thermals in plains, ridge lift on mountains, volcano vents on islands
- **Economy**: Buy/sell commodities with dynamic pricing across 12+ airports
- **Missions**: Standard delivery, urgent (timed), and cold-chain (heat-sensitive) contracts
- **Plane Customization**: Swap fuselage, wings, and wingtips to tune performance
- **HUD**: Altimeter, variometer (with audio), speed, temperature gauge, minimap with thermal heatmap
- **Persistence**: Auto-saves to localStorage on landing

## Tech Stack

- **Three.js** (r160) — 3D rendering via ES module CDN
- **Custom physics** — Vector-based aerodynamics at 60Hz fixed timestep
- **Web Audio API** — Variometer beeps
- **Vanilla JS** — ES modules, no build step

## Deployment

```bash
# Vercel (zero-config static)
vercel deploy

# Or any static file server
python3 -m http.server 8080
```
