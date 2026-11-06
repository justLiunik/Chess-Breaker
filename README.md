# Checkbreaker

**A chess-puzzle roguelike where you break one rule at a time.**

Checkbreaker is a single-player, run-based puzzle game built on real chess. Each stage hands you
a sparse board, a strict turn limit, and a deck of pieces you must physically deploy. You win by
checkmating the enemy king or by out-materialing them — but every turn you save converts into
coins, and every piece you lose is gone forever. Skills let you violate chess: move twice in one
turn, turn a bishop into a queen, freeze an enemy piece. They are scarce, they cost Focus, and
they are the only way to exceed the one move chess gives you.

> **A stage is the puzzle. A run is the deck.**

---

## Status

**Milestone M0 — Design Foundation.** This repository currently contains design documents, JSON
Schemas, tuning data, and example content. There is no engine or UI code yet; see
[`docs/10-roadmap-and-milestones.md`](docs/10-roadmap-and-milestones.md) for what comes next.

## Read this in order

| # | Document | What it answers |
|---|---|---|
| 00 | [Vision & Pillars](docs/00-vision-and-pillars.md) | What the game is, who it's for, why it's different |
| 01 | [Core Gameplay Loop](docs/01-core-gameplay-loop.md) | How the four nested loops fit together |
| 02 | [Rules Framework](docs/02-rules-framework.md) | **Authoritative rules** — turns, actions, deployment, win/lose |
| 03 | [Skill Framework](docs/03-skill-framework.md) | How rule-breaking skills are authored as data |
| 04 | [Stage Generation](docs/04-stage-generation-and-authoring.md) | Templates, randomization, and solver validation |
| 05 | [Run Structure & Economy](docs/05-run-structure-and-economy.md) | Acts, coins, salvage, prices |
| 06 | [Deck, Durability & Permadeath](docs/06-deck-durability-and-permadeath.md) | The long-run resource and its guardrails |
| 07 | [Shop Phase](docs/07-shop-phase.md) | Post-stage purchasing |
| 08 | [Progression & UX](docs/08-progression-and-ux.md) | Screens, HUD, onboarding, telegraphing |
| 09 | [Technical Architecture](docs/09-technical-architecture.md) | Packages, state model, determinism |
| 10 | [Roadmap & Milestones](docs/10-roadmap-and-milestones.md) | M0–M6 with acceptance criteria |
| 11 | [Open Decisions](docs/11-open-decisions.md) | Deliberately deferred choices |

## The game in one table

| System | What it is | Clock |
|---|---|---|
| **Turn limit** | Per-stage countdown; running out is a loss | Short |
| **Durability** | Per-piece charges spent when deploying | Long |
| **Coins** | Leftover turns converted to currency | Run |
| **Deck capacity** | Hard cap on how much power you can hold | Run |

## Repository layout

```
README.md                      This file
docs/                          Design documents 00–11
schemas/                       JSON Schemas (draft 2020-12): run, stage, template, piece, skill
data/economy.yaml              EVERY tuning constant, in one place
content/examples/              Validated example content used as schema fixtures
scripts/validate-content.mjs   Validates examples against schemas
```

## Validate the content

```bash
npm install
npm run validate
```

The validator checks every file in `content/examples/` against the relevant schema and reports
each failure with its JSON pointer path.

## Glossary

| Term | Meaning |
|---|---|
| **Stage** | One chess encounter with a turn limit. The unit of puzzle. |
| **Run** | One attempt at the game: 3 acts × 3 stages. Ends on loss. |
| **Action Queue** | The ordered list of actions you commit to in a turn. |
| **Focus** | Per-turn resource that pays for skills only. |
| **Free Move** | The single standard move you get each turn. |
| **Deploy** | Summoning a deck piece onto the board; costs the Free Move + 1 durability. |
| **Durability** | A piece instance's remaining deployments. Zero destroys it. |
| **Salvage** | Coins earned for capturing an enemy piece. |
| **Domination** | Winning by material threshold instead of checkmate (lower payout). |
