import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleQuestionsForMain } from '../../src/messaging/questions.js';
import { readInbox } from '../../src/messaging/cables.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'questions-test-'));
  fs.mkdirSync(path.join(tmpDir, '.angels', '_inbox'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.angels', '_outbox'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.angels', '_newspaper.md'), '', 'utf-8');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('handleQuestionsForMain', () => {
  it('prints the questions prominently to stdout', () => {
    handleQuestionsForMain(tmpDir, 'src-auth', 'Should sessions expire?\nWhat is the TTL?');

    const output = vi.mocked(console.log).mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('QUESTIONS FOR MAIN (from src-auth):');
    expect(output).toContain('Should sessions expire?');
    expect(output).toContain('What is the TTL?');
  });

  it('sends a review_request cable from main back to the angel', () => {
    handleQuestionsForMain(tmpDir, 'src-auth', 'Should sessions expire?');

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
    const cable = cables[0]!;
    expect(cable.from).toBe('main');
    expect(cable.to).toBe('src-auth');
    expect(cable.type).toBe('review_request');
    expect(cable.urgency).toBe('normal');
    expect(cable.requiresAck).toBe(false);
    expect(cable.subject).toContain('src-auth');
    expect(cable.body).toContain('Should sessions expire?');
  });

  it('logs a newspaper entry with the questions as details', () => {
    handleQuestionsForMain(tmpDir, 'src-auth', 'Should sessions expire?');

    const newspaper = fs.readFileSync(
      path.join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('src-auth');
    expect(newspaper).toContain('QUESTIONS FOR MAIN');
    expect(newspaper).toContain('Should sessions expire?');
  });

  it('truncates newspaper details to 500 characters', () => {
    const longQuestions = 'q'.repeat(600);
    handleQuestionsForMain(tmpDir, 'src-auth', longQuestions);

    const newspaper = fs.readFileSync(
      path.join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('q'.repeat(500));
    expect(newspaper).not.toContain('q'.repeat(501));
  });
});
