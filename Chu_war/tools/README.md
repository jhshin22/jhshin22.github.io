# Chu War Headless Tools

This directory is for development-only tooling. It is not loaded by `Chu_war/index.html` and is not required for the GitHub Pages game.

## Headless Match Runner

Run one deterministic random-AI match:

```bash
node Chu_war/tools/headless_match.js --seed demo --pretty
```

Run 50 summer-vs-summer matches with anomaly monitoring:

```bash
node Chu_war/tools/headless_match.js --seed summer --games 50 --top-ai summer --bottom-ai summer --max-turns 300 --pretty
```

Useful options:

```text
--seed <value>       Deterministic setup and move-choice seed
--max-turns <n>      Turn cap before forcing a draw result
--games <n>          Run multiple matches and print aggregate summary
--top-ai <name>      top AI: random or summer
--bottom-ai <name>   bottom AI: random or summer
--pretty            Pretty-print the JSON log
```

The runner reuses the existing browser game rule scripts through a Node VM:

- `js/constants.js`
- `js/state.js`
- `js/movement.js`
- `js/battle.js`
- `js/victory.js`
- `js/setup.js`

It intentionally does not load render, modal, localStorage, or browser AI wrapper files in this first step. The goal is to prove that setup, legal moves, move application, battle resolution, end checks, and JSON logging can run without the browser UI.

The headless `summer` policy mirrors the production AI goals rather than loading the browser scheduler directly. It uses summer-style safe setup, hidden king-candidate pressure, king safety scoring, repeated-move suppression, and guards against early high-cost hidden attacks, quiet bomb movement, quiet special moves, and long empty cavalry moves.

The anomaly summary also watches for king-safety regressions:

- `unanswered-king-danger`: a move leaves a direct king threat substantially unresolved.
- `hunt-while-king-threatened`: a hidden-candidate attack is made while the mover's king remains under threat.

Current remaining improvement targets are high turn-cap frequency and a small number of early high-cost hidden attacks around the midgame boundary.
