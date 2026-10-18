# Tilekeeper

A portrait puzzle game for phones. Kip, an apprentice Tilekeeper, marks tiles with a glowing glove to capture tumbling cubes before they grind the floating stages away. Five worlds, twenty-five levels, five bosses, plus Endless and a Daily Challenge.

**Play:** https://etothesmith.github.io/tilekeeper/

On a phone, open the link and choose **Add to Home Screen** to install it. After the first visit it plays offline.

## How to play

- **Swipe** to move Kip one tile.
- **Tap a tile** near Kip to set a mark. The next cube that rolls onto it can be captured.
- **Tap the mark again** (or the brass button) to capture it.
- Green cubes leave a green glyph: hit **Blast** to clear the 3×3 around it.
- Never capture black cubes, and don't let cubes fall off the edge.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | The whole game: HTML, CSS and JavaScript in one file |
| `assets/` | Art (WebP/PNG): backgrounds, cubes, floors, Kip, bosses, effects, UI |
| `assets/cutscenes/` | Story panels (`cs_w1_intro_1.webp` …), added when the art is ready |
| `manifest.webmanifest`, `sw.js` | Home-screen install and offline cache |
| `dev/core.js` | Copy of the wave generator and solver bot, for testing |
| `dev/test_waves.js` | `node dev/test_waves.js` checks every level's waves can be cleared Perfect |

No build step: edit `index.html` and refresh. To test locally, serve the folder (for example `npx serve .`) and open it in a browser. Add `?debug` to the URL for the debug overlay.

## Credits

Game design and code by Claude, art by Gemini, directed by Coach Smith.
