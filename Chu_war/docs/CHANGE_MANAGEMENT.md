# Change Management

## Start Of Work

Before changing files:

```bash
git rev-parse --show-toplevel
git remote -v
git branch --show-current
git rev-parse HEAD
git status --short
git status
```

Record:

- Current branch.
- HEAD SHA.
- Remote URL.
- Working tree status.
- Untracked files.
- Relevant `Chu_war` file list.

If the remote is not `https://github.com/jhshin22/jhshin22.github.io.git`, stop and report instead of changing it.

## Branching

Use a focused work branch when appropriate, for example:

```text
chu-war-ai-simulation
```

If already on a user work branch, do not switch branches without a clear reason. Do not delete branches unless explicitly asked.

## During Work

- Keep changes limited to the task.
- Prefer small, reviewable diffs.
- Do not run broad auto-formatting over compressed one-line files unless the task is specifically to reformat.
- Preserve GitHub Pages relative paths.
- Preserve script order unless the task is to change load behavior.
- Use Git diffs as the review and rollback mechanism, not ad hoc backup files.

## Before Commit

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff
```

For JavaScript changes, run available syntax checks, for example:

```bash
node --check Chu_war/js/main.js
```

If tooling is unavailable, report exactly which checks could not be run.

## Commit

- Use one commit per purpose.
- Use a specific message, for example `Set up local AI simulation development workflow`.
- After committing, record the new SHA with `git rev-parse HEAD`.
- Do not amend existing commits unless explicitly requested.

## Before Push

Before pushing:

```bash
git fetch origin
git status --short
git log --oneline --decorate -5
```

Check whether the remote branch advanced. If there is a conflict or unexpected divergence, stop and report. Do not force push or rewrite remote history without explicit approval.

## Deployment Check

After an approved push to the GitHub Pages branch:

- Confirm `https://jhshin22.github.io/Chu_war/` loads.
- Confirm `index.html` references resolve under `/Chu_war/`.
- Run a quick browser game flow: setup, move, combat if practical, new game.
- Check the browser console for immediate errors.

## Bad Deployment Recovery

Preferred recovery is a normal revert commit:

```bash
git revert <bad_commit_sha>
```

Avoid `reset --hard`, force push, or history rewriting unless the user explicitly approves and understands the impact.

## Report Format

Report:

- Baseline branch and HEAD SHA.
- Files created.
- Files modified.
- Files intentionally not modified.
- Validation commands and results.
- Known risks.
- Recommended commit message.
- Whether push was performed.
