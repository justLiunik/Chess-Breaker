import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTemplates } from '@checkbreaker/content/parse';
import type { GenRequest } from '@checkbreaker/run';
import { App } from '../src/App';
import { Bench } from '../src/screens/Bench';
import { genTexts } from '../src/state/genContent';
import type { StageSource } from '../src/state/stageSource';
import { GAME_FENS, RARITY_FENS } from '../../../packages/engine/test/bench-positions';
import { testStageSource } from './doubles';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const templates = parseTemplates(genTexts.templates);

/** Answers instantly; the i-th request for a template (seed `bench-<id>-<i>`) reports i + 1 ms. */
function stubSource(seen: { templateId?: string; req: GenRequest }[] = []): StageSource {
  return {
    request(id, req, templateId) {
      seen.push({ templateId, req });
      const i = Number(req.run.seed.slice(req.run.seed.lastIndexOf('-') + 1));
      return Promise.resolve({ id, ok: true as const, stage: null as never, provenance: null, ms: i + 1 });
    },
  };
}

describe('dev bench', () => {
  it('shows median and p95 of the worker ms per template, and times every FEN', async () => {
    const seen: { templateId?: string; req: GenRequest }[] = [];
    render(<Bench source={stubSource(seen)} enemyRuns={2} enemyWarmups={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    // N = 10 stages with ms 1..10: median 5.5, p95 10.
    await waitFor(() => expect(screen.getAllByTestId(/^gen-/)).toHaveLength(templates.length), { timeout: 20_000 });
    for (const t of templates) {
      const row = within(screen.getByTestId(`gen-${t.id}`));
      expect(row.getByText('5.5')).toBeTruthy();
      expect(row.getByText('10.0')).toBeTruthy();
    }
    expect(seen).toHaveLength(templates.length * 10);
    expect(seen.every((s) => s.req.run.seed.startsWith(`bench-${s.templateId}-`))).toBe(true);
    expect(new Set(seen.map((s) => s.templateId))).toEqual(new Set(templates.map((t) => t.id)));
    // The fixed deck of the template's act, and its slot (bosses at stage 2).
    const first = seen.find((s) => s.templateId === templates[0]!.id)!;
    expect(first.req.actIndex).toBe(templates[0]!.act - 1);
    expect(first.req.run.deck.length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getAllByTestId(/^enemy-/)).toHaveLength(GAME_FENS.length + RARITY_FENS.length), { timeout: 30_000 });
    for (const fen of GAME_FENS) expect(screen.getAllByText(fen).length).toBeGreaterThan(0);
  }, 60_000);

  it('uses the stage count from the input field', async () => {
    const seen: { templateId?: string; req: GenRequest }[] = [];
    render(<Bench source={stubSource(seen)} enemyRuns={1} enemyWarmups={0} />);
    const input = screen.getByLabelText('Stages per template');
    fireEvent.change(input, { target: { value: '4' } });
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(seen).toHaveLength(templates.length * 4), { timeout: 20_000 });
    // ms 1..4: median 2.5, p95 4.
    await waitFor(() => expect(within(screen.getByTestId(`gen-${templates[0]!.id}`)).getByText('2.5')).toBeTruthy());
    expect(within(screen.getByTestId(`gen-${templates[0]!.id}`)).getByText('4.0')).toBeTruthy();
  }, 60_000);

  it('copies both tables as Markdown and says numbers depend on the machine', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Bench source={stubSource()} enemyRuns={1} enemyWarmups={0} />);
    expect(screen.getByText(/depend on the machine/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(screen.getAllByTestId(/^enemy-/)).toHaveLength(GAME_FENS.length + RARITY_FENS.length), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    const md = writeText.mock.calls[0]![0] as string;
    expect(md).toContain('| Template |');
    expect(md).toContain('| Position |');
    expect(md).toContain(templates[0]!.id);
    expect(md).toContain(GAME_FENS[0]!);
  }, 60_000);

  it('labels the effective depth: plain on normal rows, capped on rarity rows', async () => {
    render(<Bench source={stubSource()} enemyRuns={1} enemyWarmups={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(screen.getAllByTestId(/^enemy-/)).toHaveLength(GAME_FENS.length + RARITY_FENS.length), { timeout: 30_000 });
    expect(within(screen.getByTestId('enemy-0')).getByText('4')).toBeTruthy();
    const rarityRow = within(screen.getByTestId(`enemy-${GAME_FENS.length}`));
    expect(rarityRow.getByText('4 requested, capped by the engine on rarity boards')).toBeTruthy();
  }, 60_000);

  it('recovers when the source rejects and shows the error', async () => {
    const source: StageSource = { request: () => Promise.reject(new Error('worker died')) };
    render(<Bench source={source} enemyRuns={1} enemyWarmups={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Error: worker died'));
    expect((screen.getByRole('button', { name: 'Run bench' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('counts failed answers, renders "-" and shows the first message', async () => {
    const source: StageSource = {
      request: (id) => Promise.resolve({ id, ok: false as const, message: `no stage ${id}` }),
    };
    render(<Bench source={source} enemyRuns={1} enemyWarmups={0} />);
    fireEvent.change(screen.getByLabelText('Stages per template'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(screen.getAllByTestId(/^gen-tpl/).length).toBeGreaterThan(0), { timeout: 20_000 });
    const row = within(screen.getByTestId(`gen-${templates[0]!.id}`));
    expect(row.getByText('3', { selector: 'td:nth-child(4)' })).toBeTruthy();
    expect(row.getAllByText('-')).toHaveLength(2);
    const errors = screen.getByTestId('gen-errors').textContent!;
    expect(errors).toContain(`${templates[0]!.id}: 3 failed, first message: no stage 1`);
  }, 60_000);

  it('shows "Copy failed" when the clipboard rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<Bench source={stubSource()} enemyRuns={1} enemyWarmups={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run bench' }));
    await waitFor(() => expect(screen.getAllByTestId(/^enemy-/)).toHaveLength(GAME_FENS.length + RARITY_FENS.length), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copy failed'));
  }, 60_000);

  it('is shown by the app at #bench', async () => {
    window.location.hash = '#bench';
    render(<App source={testStageSource()} />);
    expect(await screen.findByRole('button', { name: 'Run bench' })).toBeTruthy();
  });
});
