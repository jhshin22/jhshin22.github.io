# Simulation Plan

## Current Coupling

The game currently mixes engine, UI, AI, timers, alerts, and logging through the global `window.ChuWar` object. The same functions both mutate game state and call browser APIs.

Browser-dependent areas:

- `constants.js`: creates canvas icons with `document.createElement('canvas')`.
- `render.js`: reads and writes DOM nodes, modals, board buttons, and image elements.
- `main.js`: binds click handlers and uses alert modal callbacks.
- `ai.js`, `ai_summer.js`, `ai_policy_guard.js`, `ai_endgame_guard.js`: use `document.getElementById` and `setTimeout`.
- `match_log.js`: uses `localStorage`, clipboard, `Blob`, object URLs, DOM buttons, and alert wrapping.

## Engine Candidates

The following logic can become a shared pure or mostly pure engine:

- Piece definitions and counts.
- Empty board creation.
- Piece pool creation.
- Setup zone predicates.
- Legal move generation.
- Battle resolution.
- Move application.
- Victory and draw checks.
- Public-information snapshots.
- AI candidate scoring, once browser access and timers are injected.

## Adapter Boundary

Introduce small adapters instead of duplicating rules:

- `uiAdapter`: render, show cover, show alert.
- `clockAdapter`: `setTimeout`, immediate execution for simulation.
- `storageAdapter`: browser localStorage or in-memory simulation logs.
- `randomAdapter`: seeded random for reproducible simulations.
- `modeAdapter`: selected AI mode without reading a DOM select element.

The browser game should keep using the same rule functions through browser adapters.

## Deterministic Randomness

Simulation needs seeded randomness for:

- Setup plan choice.
- Setup column flip.
- Remaining piece shuffle.
- AI style choice.
- Any random tie-break or easy-mode random move.

Each match log should record the seed and the random stream version.

## Headless Match Runner

Planned flow:

```text
create seeded game state
apply top and bottom setup strategies
while not game over and turn limit not reached:
  enumerate legal moves
  run AI policy/scoring
  apply selected move
  record structured turn log
  check end condition
summarize result
```

The runner should support AI vs AI combinations such as easy vs summer, spring vs summer, and summer policy variants.

Initial implementation:

- `Chu_war/tools/headless_match.js` runs one random-AI match in Node.
- It loads the existing rule scripts with a small DOM/canvas stub instead of duplicating movement, battle, victory, setup, and state rules.
- It writes a JSON match log with seed, setup, per-turn selected move, battle result, remaining counts, final result, and final board.
- It is intentionally outside the `index.html` load path, so the GitHub Pages game does not depend on it.
- Browser AI wrappers, rendering, modals, and localStorage logging are not loaded in this first version.

## Log Format

Each simulated game should write JSON with:

- Seed.
- AI names and parameter versions.
- Setup strategy names.
- Initial board.
- Per-turn legal candidate count.
- Filtered candidate count.
- Selected move.
- Selection score.
- Score components where available.
- Rejected moves and rejection reasons for policy guards.
- Battle result.
- Board snapshot after move.
- Winner or draw.
- Total turns.
- Termination reason, including turn cap.

## Batch Statistics

For hundreds or thousands of games, summarize:

- Win rate by side and AI.
- Draw rate.
- Average turns.
- Median turns.
- King capture frequency.
- Pass frequency.
- Repetition/backtrack blocks.
- Emergency response frequency.
- Forced hunt frequency.
- Bomb trade frequency.
- Hidden attack success proxy.
- Crashes or invariant violations.

## Anomaly Detection

Flag logs for review when:

- AI passes while legal moves exist and king is threatened.
- The same piece repeatedly reverses between two squares.
- A high-value general attacks a weak hidden candidate early.
- Cavalry performs long empty moves without pressure or defense gain.
- King has zero safe adjacent squares for several turns.
- Game exceeds a configured turn cap.
- A hidden enemy type is accessed directly in AI scoring code.

## Regression Tests

Start with lightweight tests:

- Legal move snapshots for each piece type.
- Battle table expectations.
- 4-star return behavior.
- King consecutive movement restriction.
- Bomb reveal and simultaneous removal.
- Victory/draw cases.
- AI information-boundary checks for hidden target type usage.

## Isolation From Production

Simulator-only files should live outside the production `index.html` load path unless explicitly wired for development. The GitHub Pages game must continue to run from `Chu_war/index.html` with the current static file model.
