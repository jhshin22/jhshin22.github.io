# Chu War Agent Guide

## Project

This repository serves a browser game from GitHub Pages:

- Repository: `https://github.com/jhshin22/jhshin22.github.io.git`
- Game path: `Chu_war`
- Published URL: `https://jhshin22.github.io/Chu_war/`
- Runtime: static HTML, CSS, and vanilla JavaScript

The production game must keep working on GitHub Pages without Node.js, a build step, a server, or required external CDNs.

## Working Rules

- Inspect the repository state before changing files.
- Run `git status --short`, `git diff --stat`, and `git diff` before reporting changes.
- Keep changes scoped to the requested task.
- Do not rewrite, delete, or reformat unrelated files.
- Preserve script load order, relative paths, line endings, and browser-only behavior unless the task explicitly requires a change.
- Do not push to the remote repository without explicit user approval.
- Do not use destructive Git commands such as `git reset --hard`, `git clean -fd`, `git checkout -- .`, or `git restore .` without explicit user approval.

## Game Invariants

- Do not change game rules casually.
- Keep rules and AI strategy separated where practical.
- AI code must not inspect the true identity of hidden enemy pieces for decision making.
- AI may use public information, revealed pieces, move history, battle outcomes, inferred candidates, and legal move shape.
- Match logs may record true piece identities after the fact for analysis, but gameplay AI must not consume those logs as hidden truth.

## File Roles

- `index.html`: page layout and script order.
- `css/style.css`: main layout and component styling.
- `css/revealed_marker.css`: revealed-piece visual marker.
- `js/constants.js`: piece definitions, counts, labels, generated icons.
- `js/state.js`: global state object and empty board factory.
- `js/movement.js`: legal move generation.
- `js/battle.js`: combat result table.
- `js/victory.js`: helper predicates, labels, win/draw checks.
- `js/setup.js`: reset, piece pool, placement zones, random setup.
- `js/render.js`: DOM rendering, modal alerts, side panel updates.
- `js/main.js`: setup flow, turns, pass handling, move application, combat application.
- `js/ai.js`: base AI modes and scoring.
- `js/ai_setup.js`: strategy setup plans for random, spring, and summer AI.
- `js/ai_summer.js`: summer AI memory, candidate scoring, defense, and scheduler.
- `js/ai_special_guard.js`: AI special-move policy guard.
- `js/ai_policy_guard.js`: summer AI policy filters, emergency response, repeated-move guard.
- `js/ai_endgame_guard.js`: summer AI forced endgame hidden-king-candidate attacks.
- `js/match_log.js`: browser localStorage match logs, copy/download/clear controls, wrappers around moves and alerts.

## Verification

Useful checks before reporting:

```bash
git status --short
git diff --check
git diff --stat
git diff
node --check Chu_war/js/constants.js
node --check Chu_war/js/state.js
node --check Chu_war/js/movement.js
node --check Chu_war/js/battle.js
node --check Chu_war/js/victory.js
node --check Chu_war/js/setup.js
node --check Chu_war/js/render.js
node --check Chu_war/js/main.js
node --check Chu_war/js/ai.js
node --check Chu_war/js/ai_setup.js
node --check Chu_war/js/ai_summer.js
node --check Chu_war/js/ai_special_guard.js
node --check Chu_war/js/ai_policy_guard.js
node --check Chu_war/js/ai_endgame_guard.js
node --check Chu_war/js/match_log.js
```

Open `Chu_war/index.html` directly in Chrome for a quick browser check. If browser security behavior differs from GitHub Pages, record the difference instead of adding a local-server dependency to the game.

## Commit Practice

- Prefer one purpose per commit.
- Review `git diff --check`, `git diff --stat`, and `git diff` before committing.
- Use concrete commit messages, for example `Set up local AI simulation development workflow`.
- Record the pre-change and post-change HEAD SHA in the work report.
- Do not push until the user explicitly asks.

## AI Improvement Loop

1. Collect match logs from the browser UI or future simulator.
2. Identify repeated bad moves, illegal assumptions, or unstable decisions from logs.
3. Decide whether the issue belongs to rules, AI scoring, policy guard, or simulation tooling.
4. Add a focused change.
5. Re-run syntax checks and representative games.
6. Compare new logs against the original failure pattern.
7. Report changed files, validation, remaining risk, and commit recommendation.
