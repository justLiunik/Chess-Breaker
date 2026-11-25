// The headless bot (M4 spec section 9.2): a test driver, not an AI player. It plays whole runs from a seed
// with generated stages and checks invariants on the way.
//   npm run bot -- [--runs N] [--seed S] [--json out.json]
// Run i plays seed S (i = 0) or hash(S, i) as XXXX-XXXX. A stage with a solution is played from it
// (placements, then the line turn by turn); one without, or whose placements the shop broke, gets the
// fallback of bot-policy.ts. After every action the session goes through serializeSave -> loadSave and must
// come back deep-equal. Exit 1 on any crash, invariant breach or bot failure.
// The --json output depends only on the arguments: wall times are printed to stdout and never written there.
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { loadFormations, loadGenConfig, loadRunConfig, loadTemplates } from '@checkbreaker/content';
import type { RunConfig } from '@checkbreaker/content';
import { hash } from '@checkbreaker/engine';
import type { Action, EndReason } from '@checkbreaker/engine';
import { generateStage } from '@checkbreaker/gen';
import type { GenContent, Solution } from '@checkbreaker/gen';
import {
  abandon, applyShopMove, chooseShopAction, commit, fallbackPlacements, fallbackQueue, loadSave, memoryStorage, newRun,
  provideStage, serializeSave, start,
} from '@checkbreaker/run';
import type { GenRequest, RunResult, RunSession } from '@checkbreaker/run';

// Bot parameters (spec section 9.2), not tuning numbers.
const DEFAULT_RUNS = 20;
const DEFAULT_SEED = '7F3A-2210';
/** Turns in one stage after which the bot abandons the run. */
const TURN_CAP = 60;
/** Session actions in one run after which the bot gives up: a policy loop, reported as a bot failure. */
const STEP_CAP = 5000;

type Failure = { kind: 'bot' | 'invariant' | 'crash'; stage: number; detail: string };
const ABANDON_REASONS = ['turn_cap', 'no_fallback_move', 'bot_failure'] as const;
type AbandonReason = (typeof ABANDON_REASONS)[number];
type StageLog = {
  stage: number; // 1-9
  templateId: string;
  proven: boolean; // gen returned a solution
  mode: 'solution' | 'fallback';
  outcome: 'win' | 'loss' | 'abandoned';
  turns: number;
  coins: number; // wallet after the stage (award, overtime and salvage applied)
  deck: number; // non-king pieces after the stage (a promotion may leave it over 8; the shop trims it)
};
type RunLog = {
  seed: string;
  result: 'won' | 'lost' | 'crashed';
  stageReached: number; // the last stage entered, 1-9 (0: none)
  endReason: EndReason | 'abandoned' | null;
  /**
   * Why the bot abandoned the run. Only `turn_cap` is a valid outcome (spec section 10); `no_fallback_move`
   * (a stage still active, but no single MOVE accepted: only skill-led or bonus-move queues are legal) is a
   * limit of the bot, and like `bot_failure` it comes with a bot failure.
   */
  abandonedFor: AbandonReason | null;
  stages: StageLog[];
  actions: Record<'merge' | 'repair' | 'buy' | 'reroll' | 'sell', number>;
  failures: Failure[];
};

function parseArgs(argv: string[]): { runs: number; seed: string; json?: string } {
  const out = { runs: DEFAULT_RUNS, seed: DEFAULT_SEED, json: undefined as string | undefined };
  for (let k = 0; k < argv.length; k++) {
    const flag = argv[k];
    const val = argv[++k];
    if (val === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--runs') out.runs = Number(val);
    else if (flag === '--seed') out.seed = val;
    else if (flag === '--json') out.json = val;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error('--runs must be a positive integer');
  return out;
}

/** Run i's seed: the first seed itself, then hash(first, i) as XXXX-XXXX. */
function seedOf(first: string, i: number): string {
  if (i === 0) return first;
  const h = hash(first, i).toString(16).toUpperCase().padStart(8, '0');
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

const nonKing = (s: RunSession): number => s.run.deck.filter(p => p.pieceType !== 'king').length;

/** The first path where `a` and `b` differ, for an invariant report. */
function firstDiff(a: unknown, b: unknown, path = 'session'): string {
  if (isDeepStrictEqual(a, b)) return '';
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    const ka = Object.hasOwn(a, k);
    const kb = Object.hasOwn(b, k);
    if (ka !== kb) return `${path}.${k}: present ${ka} vs ${kb}`;
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return `${path}: prototypes differ`;
}

function playRun(seed: string, rc: RunConfig, generate: (r: GenRequest) => ReturnType<typeof generateStage>): RunLog {
  const log: RunLog = {
    seed, result: 'lost', stageReached: 0, endReason: null, abandonedFor: null, stages: [],
    actions: { merge: 0, repair: 0, buy: 0, reroll: 0, sell: 0 }, failures: [],
  };
  const storage = memoryStorage();
  let s = newRun(seed, rc);
  // `as` keeps the declared types: these are assigned inside the helpers below, which narrowing does not see.
  let solution = null as Solution | null; // the solution of the stage in `next` (or being played)
  let following = false; // playing the current stage from `solution`
  let current = null as Omit<StageLog, 'outcome' | 'turns' | 'coins' | 'deck'> | null;
  const fail = (kind: Failure['kind'], detail: string): void => {
    log.failures.push({ kind, stage: log.stageReached, detail });
  };

  /** Saves and reloads `next` (the invariant check), then makes it the session. */
  const accept = (next: RunSession): void => {
    storage.write(serializeSave(next));
    const back = loadSave(storage.read()!, rc);
    if (!back.ok) fail('invariant', `loadSave refused the save: ${JSON.stringify(back.error)}`);
    else if (!isDeepStrictEqual(back.value, next)) fail('invariant', `save round trip differs at ${firstDiff(back.value, next)}`);
    s = next;
  };
  /** Applies `r`, or reports `what` as a bot failure and returns false. */
  const apply = (r: RunResult, what: string): boolean => {
    if (!r.ok) {
      fail('bot', `${what} refused: ${JSON.stringify(r.error)}`);
      return false;
    }
    accept(r.value.session);
    return true;
  };
  const giveUp = (why: NonNullable<RunLog['abandonedFor']>): void => {
    log.abandonedFor = why;
    const wasPlaying = s.phase === 'action' && s.stage !== null;
    const turns = s.stage?.turnsUsed ?? 0;
    const r = abandon(s);
    if (!r.ok) throw new Error(`abandon refused: ${JSON.stringify(r.error)}`);
    accept(r.value.session);
    if (wasPlaying && current) log.stages.push({ ...current, outcome: 'abandoned', turns, coins: s.run.coins, deck: nonKing(s) });
    current = null;
  };
  /** Generates the pending request's stage and hands it to the session. */
  const supply = (): void => {
    const g = generate(s.next!.request);
    solution = g.solution;
    if (!apply(provideStage(s, g.stage, rc), 'provideStage')) giveUp('bot_failure');
  };
  /** After a commit: if the stage ended, its log line. */
  const closeStage = (): void => {
    if (s.phase === 'action' || !current) return;
    const h = s.run.history.at(-1)!;
    log.stages.push({ ...current, outcome: h.outcome, turns: h.turnsUsed, coins: s.run.coins, deck: nonKing(s) });
    if (following && h.outcome === 'loss') fail('bot', `stage ${current.stage}: the solution's line lost (${s.outcome?.endReason})`);
    current = null;
    following = false;
  };

  for (let steps = 0; s.phase !== 'ended'; steps++) {
    if (steps >= STEP_CAP) {
      fail('bot', `no end after ${STEP_CAP} actions (phase ${s.phase})`);
      giveUp('bot_failure');
      break;
    }
    switch (s.phase) {
      case 'awaiting_stage':
        supply();
        break;

      case 'shop': {
        if (s.next!.stage === null) {
          supply();
          break;
        }
        // The next stage's solution is known here, so its pieces are protected: a merge never takes them, and the
        // sale that trims a deck a promotion overflowed takes one only when nothing else can go (the deck gate).
        const protectedIds = new Set(solution?.placements.map(p => p.instanceId) ?? []);
        const m = chooseShopAction(s, protectedIds, rc);
        if (!apply(applyShopMove(s, m, rc), `shop ${m.kind}`)) giveUp('bot_failure');
        else if (m.kind !== 'leave') log.actions[m.kind]++;
        break;
      }

      case 'deployment': {
        const stage = s.stage!;
        const number = s.run.actIndex * rc.run.stagesPerAct + s.run.stageIndex + 1;
        log.stageReached = number;
        const sol: Solution | null = solution;
        const usable = sol !== null
          && sol.placements.every(p => s.run.deck.find(d => d.instanceId === p.instanceId)?.status === 'in_deck');
        following = false;
        if (usable) {
          const r = start(s, sol.placements, rc);
          if (r.ok) {
            accept(r.value.session);
            following = true;
          } else {
            fail('bot', `stage ${number}: the solution's placements were refused: ${JSON.stringify(r.error)}`);
          }
        }
        if (!following && !apply(start(s, fallbackPlacements(s.run, stage, rc), rc), `stage ${number}: fallback deployment`)) {
          giveUp('bot_failure');
          break;
        }
        current = { stage: number, templateId: stage.templateId, proven: sol !== null, mode: following ? 'solution' : 'fallback' };
        break;
      }

      case 'action': {
        const stage = s.stage!;
        if (stage.turnsUsed >= TURN_CAP) {
          giveUp('turn_cap');
          break;
        }
        if (following) {
          const queue = solution!.line[stage.turnsUsed];
          if (queue === undefined) {
            fail('bot', `stage ${current?.stage}: the solution's line ended after ${stage.turnsUsed} turns with the stage still active`);
            following = false;
            if (current) current = { ...current, mode: 'fallback' };
          } else {
            const r = commit(s, queue, rc);
            if (r.ok) {
              accept(r.value.session);
              closeStage();
              break;
            }
            fail('bot', `stage ${current?.stage} turn ${stage.turnsUsed + 1}: the solution's queue was refused: ${JSON.stringify(r.error)}`);
            following = false;
            if (current) current = { ...current, mode: 'fallback' };
          }
        }
        const queue: Action[] = fallbackQueue(s.run, stage, rc);
        if (queue.length === 0) {
          // The engine keeps the stage active while any legal queue exists (skill-led or bonus-move ones
          // included), so this is the fallback's limit, not a game result: a bot failure.
          fail('bot', `stage ${current?.stage} turn ${stage.turnsUsed + 1}: no single MOVE is accepted, the fallback cannot go on`);
          giveUp('no_fallback_move');
          break;
        }
        if (!apply(commit(s, queue, rc), `stage ${current?.stage}: fallback commit`)) {
          giveUp('bot_failure');
          break;
        }
        closeStage();
        break;
      }
    }
  }

  log.result = s.outcome?.result ?? 'lost';
  log.endReason = s.outcome?.endReason ?? null;
  return log;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rc = loadRunConfig();
  const genConfig = loadGenConfig();
  const content: GenContent = { templates: loadTemplates(), formations: loadFormations() };
  let genMs = 0;
  const generate = (r: GenRequest): ReturnType<typeof generateStage> => {
    const t0 = performance.now();
    const out = generateStage(r, content, genConfig);
    genMs += performance.now() - t0;
    return out;
  };

  const runs: RunLog[] = [];
  for (let i = 0; i < args.runs; i++) {
    const seed = seedOf(args.seed, i);
    const t0 = performance.now();
    genMs = 0;
    let log: RunLog;
    try {
      log = playRun(seed, rc, generate);
    } catch (e) {
      console.error(e);
      log = {
        seed, result: 'crashed', stageReached: 0, endReason: null, abandonedFor: null, stages: [],
        actions: { merge: 0, repair: 0, buy: 0, reroll: 0, sell: 0 },
        failures: [{ kind: 'crash', stage: 0, detail: e instanceof Error ? e.message : String(e) }],
      };
    }
    runs.push(log);
    const ms = performance.now() - t0;
    const stages = log.stages.map(st => `${st.stage}:${st.outcome}${st.mode === 'fallback' ? '(fb)' : ''} ${st.coins}c/${st.deck}p`).join(', ');
    console.log(
      `run ${i + 1}/${args.runs} ${seed}: ${log.result} at stage ${log.stageReached}`
      + `${log.endReason ? ` (${log.endReason}${log.abandonedFor ? `: ${log.abandonedFor}` : ''})` : ''}`
      + ` | ${stages || 'no stage finished'} | failures ${log.failures.length}`
      + ` | ${(ms / 1000).toFixed(1)} s (gen ${(genMs / 1000).toFixed(1)} s)`,
    );
    for (const f of log.failures) console.log(`  ${f.kind} failure, stage ${f.stage}: ${f.detail}`);
  }

  const count = (kind: Failure['kind']): number => runs.reduce((t, r) => t + r.failures.filter(f => f.kind === kind).length, 0);
  const reached: Record<string, number> = {};
  for (const r of runs) reached[r.stageReached] = (reached[r.stageReached] ?? 0) + 1;
  const abandoned = Object.fromEntries(ABANDON_REASONS.map(why => [why, runs.filter(r => r.abandonedFor === why).length])) as
    Record<AbandonReason, number>;
  const summary = {
    runs: runs.length,
    won: runs.filter(r => r.result === 'won').length,
    lost: runs.filter(r => r.result === 'lost').length,
    abandoned,
    crashes: count('crash'),
    invariantBreaches: count('invariant'),
    botFailures: count('bot'),
    stageReached: reached,
  };
  console.log(
    `\n${summary.runs} runs: ${summary.won} won, ${summary.lost} lost; `
    + `abandoned: ${ABANDON_REASONS.map(why => `${why} ${abandoned[why]}`).join(', ')} (only turn_cap is a valid outcome); `
    + `crashes ${summary.crashes}, invariant breaches ${summary.invariantBreaches}, bot failures ${summary.botFailures}`,
  );
  console.log(`stage reached: ${Object.entries(reached).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  if (args.json) {
    writeFileSync(args.json, `${JSON.stringify({ args: { runs: args.runs, seed: args.seed }, summary, runs }, null, 2)}\n`);
    console.log(`wrote ${args.json}`);
  }
  if (summary.crashes + summary.invariantBreaches + summary.botFailures > 0) process.exitCode = 1;
}

main();
