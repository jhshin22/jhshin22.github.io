# AI Architecture

## Load-Time Wrapping

AI behavior is assembled by script order:

```text
ai.js
ai_setup.js
ai_summer.js
ai_special_guard.js
ai_policy_guard.js
ai_endgame_guard.js
match_log.js
```

The important wrappers are:

- `ai.js` defines `A.isAiMode`, `A.isAiTurn`, `A.resetAi`, and `A.scheduleAiTurn`.
- `ai_summer.js` wraps `A.scheduleAiTurn` and `A.resetAi` for `ai-summer`.
- `ai_special_guard.js` wraps `A.legal` to suppress wasteful non-attack special moves.
- `ai_policy_guard.js` wraps `A.legal`, `A.scheduleAiTurn`, `A.applyMove`, and `A.resetAi`.
- `ai_endgame_guard.js` wraps `A.scheduleAiTurn` and `A.resetAi` after the policy guard.
- `match_log.js` wraps `A.applyMove`, `A.endTurn`, `A.alert`, and `A.reset` for logging.

Because these are wrappers over mutable globals, script order is part of the architecture.

## Common Flow

```text
Game state
-> legal move generation
-> AI policy filters
-> forced action checks
-> score evaluation
-> candidate selection
-> timer execution
-> move application
-> alert/end-turn handling
-> match log recording
-> next turn
```

## Base AI

`ai.js` controls human-vs-AI modes and base scoring.

- Easy mode is mostly random, with occasional attack preference.
- Normal mode evaluates public fights and hidden candidates by expected value.
- Spring mode (`ai-bom`) adds stronger tactical scoring, hidden-risk handling, king defense, and pass consideration.

The base AI uses piece values, known remaining counts, revealed pieces, captured pieces, nearest-enemy distance, and inferred hidden candidates. It treats hidden enemies as candidate sets rather than reading their real type directly for expected-value scoring.

## Setup AI

`ai_setup.js` replaces random setup with named plans:

- Base plans: king fortress, infantry scout line, front blocking, 1-star raid, high-general pressure.
- Spring adds five extra plans.
- Summer uses a safer subset: king fortress, infantry scout line, front blocking, spy waiting, king decoy spread.

For bottom, plan rows are mirrored with `mapRow`; columns may be randomly flipped.

## Summer AI

`ai_summer.js` is the main information-war AI:

- Keeps memory per bottom piece id.
- Assigns a random style: balanced, scout, pressure, defense, or trap.
- Scores hidden bottom pieces as king candidates using position, movement history, staleness, centrality, and nearby protection.
- Infers revealed movement types from public move shape, including cavalry and 1-star/2-star/3-star special moves.
- Scores public combat with the battle table only when the target is revealed.
- Scores hidden attacks using king-candidate estimates, game phase, attacker cost, and risk.
- Scores quiet moves by candidate pressure, king safety, guard value, and exposure change.
- Penalizes purposeless king, bomb, revealed spy, and low-pressure moves.
- Chooses immediate revealed-king wins before general scoring.

Summer scheduling uses `setTimeout` and a local `busy` lock to avoid overlapping AI moves.

## Policy Guards

`ai_special_guard.js` filters non-attack special moves unless they are justified by threat avoidance or forward pressure.

`ai_policy_guard.js` adds broader policy filters:

- Blocks immediate backtracking for top pieces.
- Suppresses early or purposeless cavalry long moves.
- Suppresses weak hidden attacks, especially high-value generals into low-confidence targets.
- Blocks non-attack bomb movement.
- Protects the top king using simulated king-danger scoring.
- Restores emergency fallback moves if strict filters would otherwise leave no useful response under king threat.
- Records top piece movement to detect repeated reversals.
- Adds forced emergency response, forced cavalry strike, and forced hidden-candidate hunt paths.

The policy guard simulates hidden combat conservatively. For hidden defenders, it does not inspect the defender type; non-bomb attackers are treated as removed, and bomb attacks remove both.

## Endgame Guard

`ai_endgame_guard.js` runs after the policy guard and can preempt summer AI scheduling:

- Scores hidden bottom pieces as king candidates.
- Treats a single remaining hidden bottom piece as effectively confirmed king candidate.
- Collects direct attacks from top non-king pieces, including cavalry line attacks and unused 1-star/2-star/3-star specials.
- Runs a forced attack before the normal summer scheduler when the candidate score crosses the threshold.
- Uses `pendingSummerTurn` and interval polling to avoid multiple summer moves in the same turn.

## Pass Conditions

- Human pass is always available from the play panel.
- Base and summer AI pass only if no candidate move is selected after legal generation and filters.
- Policy guard includes emergency fallback logic specifically to avoid accidental pass when the king is threatened and strict filters removed all moves.

## Cheating Review

The reviewed AI decision paths mostly check `target.revealed` before using the actual target type in battle scoring. Hidden target scoring uses position, revealed status, owner, remaining counts, and movement inference. `match_log.js` records true identities for analysis, but it is loaded as logging infrastructure and should not be used by AI scoring.

Future changes should continue to audit any use of `target.type` where `target.owner === 'bottom' && !target.revealed`.
