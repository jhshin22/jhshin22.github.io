# Implemented Game Rules

This document describes the rules currently implemented in code. It is not a proposed rule set.

## Board And Pieces

- Board size: 8 by 8.
- Top setup zone: rows 0-3, shown as the upper four rows.
- Bottom setup zone: rows 4-7, shown as the lower four rows.
- Each player has 16 pieces:
  - 1 king
  - 4 infantry
  - 2 cavalry
  - 2 spies
  - 2 bombs
  - one each of 1-star, 2-star, 3-star, 4-star, and 5-star general

## Visibility

- A player sees their own pieces.
- Enemy hidden pieces render as `?`.
- Combat reveals both attacker and defender.
- Special moves by 1-star, 2-star, and 3-star generals reveal the moving general.
- Bomb movement reveals the bomb.
- Cavalry movement of distance 2 or more reveals the cavalry.

## Normal Movement

- King, infantry, spy, bomb, and generals normally move one orthogonal square.
- Cavalry moves any number of clear orthogonal squares and may attack the first enemy piece in line.
- A piece may not move onto a friendly piece.
- A move may target an empty square or an enemy-occupied square.

## Special Movement

Special movement is available only while the general is hidden and `specialUsed` is false:

- 1-star general: knight-style move, like `(2,1)` or `(1,2)`.
- 2-star general: jumps two orthogonal squares only when the middle square contains a friendly piece.
- 3-star general: one diagonal square.

Using a special move reveals the general and marks `specialUsed`.

## Combat

Combat is resolved by `A.battleRank(attacker, defender)`:

- Any combat involving a bomb removes both pieces.
- King versus king removes both kings.
- Spy versus spy removes both spies.
- Spy attacking king wins.
- King attacking spy loses.
- Equal non-special types remove both pieces.
- King attacking any non-spy, non-king defender loses.
- Any non-king attacker attacking king wins.
- Hidden spy attacking a general wins.
- Revealed spy attacking a general loses.
- General attacking hidden spy loses.
- General attacking revealed spy wins.
- Soldier-class pieces are infantry and cavalry.
- Soldier-class pieces beat spies.
- Spies lose to soldier-class pieces.
- Generals beat soldier-class pieces.
- Soldier-class pieces lose to generals.
- Higher-rank general beats lower-rank general.

The code returns no draw branch for equal-rank generals because each side has one of each general type, but equal type is already handled as simultaneous removal.

## 4-Star General Return

When a hidden, unused 4-star general attacks and wins, `main.js` returns it to the origin square, clears the defender square, reveals it through combat, and marks `specialUsed`. This behavior is implemented for any winning attack by such a 4-star general, not only a separate special move.

## King Consecutive Move Limit

If a king moved on that player's previous turn, `A.legal` returns no moves for that king on the next turn. Passing sets `lastKingMove` to false for the passing player.

## Pass

Human players can pass with the pass button during play. AI may pass when its scheduler chooses no move. Passing records a log entry and ends the turn.

## Victory And Draw

`A.checkEnd` runs at turn changes:

- If both kings are gone, the game is a draw.
- If only top king is gone, bottom wins.
- If only bottom king is gone, top wins.
- If both players have only kings left, the game is a draw.
- If top has only king and bottom has another piece, bottom wins.
- If bottom has only king and top has another piece, top wins.

## AI Information Boundary

AI is allowed to use:

- Board coordinates.
- Owner.
- Whether a piece is revealed.
- Revealed piece type.
- Public move shape.
- Battle result.
- Captured revealed identities.
- Candidate estimates derived from remaining counts and movement history.

AI must not use hidden enemy `type` directly in move choice. Current code has several places that correctly avoid hidden target type by checking `target.revealed` before using battle tables. `match_log.js` records actual piece identity for analysis, but that data is not part of legal AI decision input.

## README Comparison

The README broadly matches the implemented rules. Notable implementation details to keep in mind:

- The 4-star general return condition is implemented as hidden, not revealed, and `specialUsed === false`; it is tied to a winning attack.
- The 2-star general special requires a friendly middle piece.
- The browser log records true piece identities, while the gameplay display and AI policy must treat hidden enemy identity as unknown.
