import { describe, it, expect } from 'vitest';
import {
  measurePromptSize,
  buildPrompt,
  buildDiscoveryPrompt,
  buildDenseDiscoveryPrompt,
  buildChunkPrompt,
  buildFinalizePrompt,
  shouldUseDenseTemplate,
  useDenseTemplate,
  type PromptInput,
  type PromptPhase,
  type InboxEntry,
} from '../../src/protocol/prompt.js';

function makeInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    phase: 'review',
    angelId: 'src-auth',
    angelPath: 'src/auth',
    angelType: 'folder',
    angelMdPath: '/project/.angels/src/auth/angel.md',
    folderListing: 'session.ts\nmiddleware.ts\nindex.ts',
    angelMd: `---\nstatus: active\nlast_updated: 2026-04-28T14:32:00Z\nlast_updated_by: main\n---\n\n# Angel: src/auth (folder)\n\n## Charter\nOwns all authentication logic.\n`,
    newspaperDelta: '',
    inbox: [],
    brief: 'TO: src-auth\nFROM: main\nTIMESTAMP: 2026-04-28T15:00:00Z\nPHASE: review\nTYPE: change_request\n\nTASK:\nAdd rate limiting to login endpoint\n\nCONTEXT:\nUsers are brute-forcing passwords\n\nEXPECTED SCOPE:\nmiddleware.ts\n\nPRIOR RESPONSE: none\n',
    responsePath: '/project/.angels/_responses/src-auth/2026-04-28T1500-001.md',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  describe('shared structure', () => {
    it('includes the protocol header in every phase', () => {
      const phases: PromptPhase[] = ['init', 'review', 'execute', 'sweep'];
      for (const phase of phases) {
        const prompt = buildPrompt(makeInput({ phase }));
        expect(prompt).toContain('[PROTOCOL]');
        expect(prompt).toContain('You are a Guard Angel.');
        expect(prompt).toContain('You may READ any file in the project');
        expect(prompt).toContain('only WRITE files inside your designated folder');
      }
    });

    it('includes angel identity in every phase', () => {
      const phases: PromptPhase[] = ['init', 'review', 'execute', 'sweep'];
      for (const phase of phases) {
        const prompt = buildPrompt(makeInput({ phase }));
        expect(prompt).toContain('[ANGEL IDENTITY]');
        expect(prompt).toContain('You are the angel for: src/auth');
        expect(prompt).toContain('Your angel ID is: src-auth');
        expect(prompt).toContain('Your type is: folder');
      }
    });

    it('includes output instructions in every phase', () => {
      const phases: PromptPhase[] = ['init', 'review', 'execute', 'sweep'];
      for (const phase of phases) {
        const prompt = buildPrompt(makeInput({ phase }));
        expect(prompt).toContain('[OUTPUT INSTRUCTIONS]');
        expect(prompt).toContain('Write your response to:');
        expect(prompt).toContain('When done, exit. Do not loop or wait for input.');
      }
    });

    it('includes folder listing', () => {
      const prompt = buildPrompt(makeInput());
      expect(prompt).toContain('session.ts\nmiddleware.ts\nindex.ts');
    });

    it('shows placeholder when folder listing is empty', () => {
      const prompt = buildPrompt(makeInput({ folderListing: '' }));
      expect(prompt).toContain('(empty or not yet created)');
    });
  });

  describe('phase: init', () => {
    it('snapshot matches', () => {
      const prompt = buildPrompt(makeInput({
        phase: 'init',
        angelMd: null,
      }));
      expect(prompt).toMatchSnapshot();
    });

    it('contains INIT-specific instructions', () => {
      const prompt = buildPrompt(makeInput({ phase: 'init' }));
      expect(prompt).toContain('[CURRENT PHASE: INIT]');
      expect(prompt).toContain('initialized for the first time');
      expect(prompt).toContain('write a comprehensive angel.md');
      expect(prompt).toContain('Do not modify any source code during INIT');
    });

    it('shows no-memory placeholder when angelMd is null', () => {
      const prompt = buildPrompt(makeInput({ phase: 'init', angelMd: null }));
      expect(prompt).toContain('(no angel.md exists yet');
    });
  });

  describe('phase: review', () => {
    it('snapshot matches', () => {
      const prompt = buildPrompt(makeInput({ phase: 'review' }));
      expect(prompt).toMatchSnapshot();
    });

    it('contains REVIEW-specific instructions', () => {
      const prompt = buildPrompt(makeInput({ phase: 'review' }));
      expect(prompt).toContain('[CURRENT PHASE: REVIEW]');
      expect(prompt).toContain('proceed');
      expect(prompt).toContain('concerns');
      expect(prompt).toContain('refuse');
      expect(prompt).toContain('Do NOT modify any code or files during REVIEW');
    });

    it('includes the brief content', () => {
      const prompt = buildPrompt(makeInput({ phase: 'review' }));
      expect(prompt).toContain('[BRIEF]');
      expect(prompt).toContain('Add rate limiting to login endpoint');
    });
  });

  describe('phase: execute', () => {
    it('snapshot matches', () => {
      const prompt = buildPrompt(makeInput({ phase: 'execute' }));
      expect(prompt).toMatchSnapshot();
    });

    it('contains EXECUTE-specific instructions', () => {
      const prompt = buildPrompt(makeInput({ phase: 'execute' }));
      expect(prompt).toContain('[CURRENT PHASE: EXECUTE]');
      expect(prompt).toContain('change has been approved');
      expect(prompt).toContain('Update your angel.md');
      expect(prompt).toContain('send cables');
      expect(prompt).toContain('RESPONSE: done');
    });
  });

  describe('phase: sweep', () => {
    it('snapshot matches', () => {
      const prompt = buildPrompt(makeInput({ phase: 'sweep' }));
      expect(prompt).toMatchSnapshot();
    });

    it('contains SWEEP-specific instructions', () => {
      const prompt = buildPrompt(makeInput({ phase: 'sweep' }));
      expect(prompt).toContain('[CURRENT PHASE: SWEEP]');
      expect(prompt).toContain('maintenance/sweep mode');
      expect(prompt).toContain('report-only pass');
      expect(prompt).toContain('last_updated_by: sweep');
      expect(prompt).toContain('do not modify other code');
    });
  });

  describe('newspaper delta', () => {
    it('shows placeholder when no delta', () => {
      const prompt = buildPrompt(makeInput({ newspaperDelta: '' }));
      expect(prompt).toContain('(no new entries)');
    });

    it('shows placeholder when delta is whitespace-only', () => {
      const prompt = buildPrompt(makeInput({ newspaperDelta: '   \n  ' }));
      expect(prompt).toContain('(no new entries)');
    });

    it('includes delta content when present', () => {
      const delta = '## 2026-04-28T14:00:00Z [src-api]\nAdded new endpoint /users';
      const prompt = buildPrompt(makeInput({ newspaperDelta: delta }));
      expect(prompt).toContain(delta);
      expect(prompt).not.toContain('(no new entries)');
    });
  });

  describe('inbox', () => {
    it('shows placeholder when empty', () => {
      const prompt = buildPrompt(makeInput({ inbox: [] }));
      expect(prompt).toContain('(no pending cables)');
    });

    it('inlines full content for high-urgency cables', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'high',
          subject: 'Breaking change in session API',
          content: 'FROM: src-api\nTO: src-auth\nTIMESTAMP: 2026-04-28T14:30:00Z\nTYPE: breaking_change\nURGENCY: high\nSUBJECT: Breaking change in session API\nREQUIRES_ACK: true\n\nBODY:\nThe session.create() signature changed.',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toContain('--- URGENT CABLE ---');
      expect(prompt).toContain('The session.create() signature changed.');
      expect(prompt).toContain('--- END CABLE ---');
    });

    it('shows subject only for normal-urgency cables', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'normal',
          subject: 'New utility function available',
          content: 'FROM: src-utils\nTO: src-auth\n...',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toContain('- [normal] New utility function available');
      expect(prompt).not.toContain('FROM: src-utils');
    });

    it('shows subject only for low-urgency cables', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'low',
          subject: 'Minor docs update',
          content: 'FROM: _root\nTO: src-auth\n...',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toContain('- [low] Minor docs update');
      expect(prompt).not.toContain('FROM: _root');
    });

    it('mixes high and normal cables correctly', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'high',
          subject: 'Urgent issue',
          content: 'URGENT CONTENT HERE',
        },
        {
          urgency: 'normal',
          subject: 'FYI update',
          content: 'Normal content here',
        },
        {
          urgency: 'low',
          subject: 'Low priority note',
          content: 'Low priority content',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toContain('--- URGENT CABLE ---');
      expect(prompt).toContain('URGENT CONTENT HERE');
      expect(prompt).toContain('- [normal] FYI update');
      expect(prompt).toContain('- [low] Low priority note');
      // Normal and low content should NOT be inlined
      expect(prompt).not.toContain('Normal content here');
      expect(prompt).not.toContain('Low priority content');
    });
  });

  describe('brief section', () => {
    it('shows placeholder when brief is empty', () => {
      const prompt = buildPrompt(makeInput({ brief: '' }));
      expect(prompt).toContain('(no brief provided)');
    });

    it('shows placeholder when brief is whitespace', () => {
      const prompt = buildPrompt(makeInput({ brief: '   \n  ' }));
      expect(prompt).toContain('(no brief provided)');
    });
  });

  describe('response path', () => {
    it('includes the response path in output instructions', () => {
      const prompt = buildPrompt(makeInput({
        responsePath: '/project/.angels/_responses/src-auth/2026-04-28T1500-001.md',
      }));
      expect(prompt).toContain('Write your response to: /project/.angels/_responses/src-auth/2026-04-28T1500-001.md');
    });
  });

  describe('root angel', () => {
    it('renders correctly for root angel', () => {
      const prompt = buildPrompt(makeInput({
        angelId: '_root',
        angelPath: '.',
        angelType: 'root',
      }));
      expect(prompt).toContain('You are the angel for: .');
      expect(prompt).toContain('Your angel ID is: _root');
      expect(prompt).toContain('Your type is: root');
    });
  });

  describe('inbox with cables (snapshot)', () => {
    it('snapshot with high-urgency cable inlined', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'high',
          subject: 'Breaking change in session API',
          content: 'FROM: src-api\nTO: src-auth\nTIMESTAMP: 2026-04-28T14:30:00Z\nTYPE: breaking_change\nURGENCY: high\nSUBJECT: Breaking change in session API\nREQUIRES_ACK: true\n\nBODY:\nThe session.create() signature changed from positional args to config object.',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toMatchSnapshot();
    });

    it('snapshot with mixed urgency cables', () => {
      const cables: InboxEntry[] = [
        {
          urgency: 'high',
          subject: 'Critical API change',
          content: 'FROM: src-api\nTO: src-auth\nTYPE: breaking_change\nURGENCY: high\nSUBJECT: Critical API change\n\nBODY:\nEndpoint signature changed.',
        },
        {
          urgency: 'normal',
          subject: 'New utility available',
          content: 'FROM: src-utils\nTO: src-auth\nTYPE: fyi\n\nBODY:\nformatDate() added.',
        },
        {
          urgency: 'low',
          subject: 'Docs updated',
          content: 'FROM: _root\nTO: src-auth\nTYPE: fyi\n\nBODY:\nREADME refreshed.',
        },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      expect(prompt).toMatchSnapshot();
    });
  });

  describe('deterministic output', () => {
    it('produces identical output for identical input', () => {
      const input = makeInput();
      const prompt1 = buildPrompt(input);
      const prompt2 = buildPrompt(input);
      expect(prompt1).toBe(prompt2);
    });

    it('inbox order is preserved (no reordering)', () => {
      const cables: InboxEntry[] = [
        { urgency: 'normal', subject: 'Alpha cable', content: 'alpha-content' },
        { urgency: 'high', subject: 'Beta cable', content: 'beta-content' },
        { urgency: 'low', subject: 'Gamma cable', content: 'gamma-content' },
      ];
      const prompt = buildPrompt(makeInput({ inbox: cables }));
      // Normal: shows subject line; high: shows full content; low: shows subject line
      const alphaIdx = prompt.indexOf('Alpha cable');
      const betaIdx = prompt.indexOf('beta-content');
      const gammaIdx = prompt.indexOf('Gamma cable');
      expect(alphaIdx).toBeGreaterThan(-1);
      expect(betaIdx).toBeGreaterThan(-1);
      expect(gammaIdx).toBeGreaterThan(-1);
      expect(alphaIdx).toBeLessThan(betaIdx);
      expect(betaIdx).toBeLessThan(gammaIdx);
    });
  });
});

// ─── angel.md memory budget ───────────────────────────────────────────────────

describe('buildPrompt memory budget', () => {
  // ~4 chars/token, so 200 tokens ≈ 800 chars. Build an angel.md well past that.
  const bigAngelMd = '# Charter\n' + 'x'.repeat(4000);
  const maxTokens = 200;

  it('truncates the angel.md in SWEEP when it exceeds memoryMaxTokens', () => {
    const prompt = buildPrompt(
      makeInput({ phase: 'sweep', angelMd: bigAngelMd, memoryMaxTokens: maxTokens }),
    );
    expect(prompt).toContain('# Charter');
    expect(prompt).toContain('angel.md truncated for SWEEP');
    // Body should not survive in full — the tail of the 4000 x's is dropped.
    expect(prompt).not.toContain('x'.repeat(4000));
  });

  it('keeps the angel.md complete in EXECUTE and DISCOVERY even when oversized', () => {
    for (const phase of ['execute', 'discovery'] as PromptPhase[]) {
      const prompt = buildPrompt(
        makeInput({ phase, angelMd: bigAngelMd, memoryMaxTokens: maxTokens }),
      );
      expect(prompt).toContain('x'.repeat(4000));
      expect(prompt).not.toContain('angel.md truncated for SWEEP');
    }
  });

  it('does not truncate in SWEEP when under budget', () => {
    const small = '# Charter\nOwns auth.';
    const prompt = buildPrompt(
      makeInput({ phase: 'sweep', angelMd: small, memoryMaxTokens: maxTokens }),
    );
    expect(prompt).toContain('Owns auth.');
    expect(prompt).not.toContain('angel.md truncated for SWEEP');
  });

  it('does not truncate when memoryMaxTokens is undefined', () => {
    const prompt = buildPrompt(
      makeInput({ phase: 'sweep', angelMd: bigAngelMd, memoryMaxTokens: undefined }),
    );
    expect(prompt).toContain('x'.repeat(4000));
    expect(prompt).not.toContain('angel.md truncated for SWEEP');
  });
});

// ─── useDenseTemplate ─────────────────────────────────────────────────────────

describe('useDenseTemplate', () => {
  it('returns false when memory is undefined', () => {
    expect(useDenseTemplate(undefined)).toBe(false);
  });

  it('returns true when target_pct is > 5 (default is 25)', () => {
    expect(useDenseTemplate({ target_pct: 25 })).toBe(true);
    expect(useDenseTemplate({ target_pct: 100 })).toBe(true);
    expect(useDenseTemplate({ target_pct: 6 })).toBe(true);
  });

  it('returns false when target_pct is <= 5', () => {
    expect(useDenseTemplate({ target_pct: 5 })).toBe(false);
    expect(useDenseTemplate({ target_pct: 1 })).toBe(false);
    expect(useDenseTemplate({ target_pct: 0 })).toBe(false);
  });
});

// ─── shouldUseDenseTemplate ───────────────────────────────────────────────────

describe('shouldUseDenseTemplate', () => {
  it('returns false when angelMemory is undefined', () => {
    expect(shouldUseDenseTemplate(undefined)).toBe(false);
  });

  it('returns true when target_pct > 5', () => {
    expect(shouldUseDenseTemplate({ target_pct: 25 })).toBe(true);
    expect(shouldUseDenseTemplate({ target_pct: 6 })).toBe(true);
  });

  it('returns true when max_tokens > 5000', () => {
    expect(shouldUseDenseTemplate({ max_tokens: 5001 })).toBe(true);
    expect(shouldUseDenseTemplate({ max_tokens: 6000 })).toBe(true);
  });

  it('returns false when target_pct <= 5 and max_tokens <= 5000', () => {
    expect(shouldUseDenseTemplate({ target_pct: 5, max_tokens: 5000 })).toBe(false);
    expect(shouldUseDenseTemplate({ target_pct: 0, max_tokens: 0 })).toBe(false);
    expect(shouldUseDenseTemplate({ target_pct: 5 })).toBe(false);
    expect(shouldUseDenseTemplate({})).toBe(false);
  });
});

// ─── buildDiscoveryPrompt ─────────────────────────────────────────────────────

describe('buildDiscoveryPrompt', () => {
  const angel = {
    id: 'src-api',
    type: 'folder' as const,
    path: 'src/api',
    memory: undefined,
  };

  const context = {
    territoryPath: 'src/api',
    fileCount: 3,
    classifiedFiles: [
      { path: 'src/api/routes.ts', value: 'high' as const, sizeBytes: 2048, language: 'TypeScript', reason: 'core routes' },
      { path: 'src/api/middleware.ts', value: 'medium' as const, sizeBytes: 1024, language: 'TypeScript', reason: 'middleware logic' },
      { path: 'src/api/types.ts', value: 'low' as const, sizeBytes: 256, language: 'TypeScript', reason: 'type definitions' },
    ],
    highValueContent: '// routes.ts\nexport const router = ...',
    mediumValueStubs: '// middleware.ts\nfunction auth() {}',
    lowValueListing: '- src/api/types.ts (256 bytes)',
    totalTokens: 5000,
    budgetUsed: 4000,
    memoryConfig: { targetPct: 25, maxTokens: 2000 },
    stats: {
      totalFiles: 3,
      highValueFiles: 1,
      mediumValueFiles: 1,
      lowValueFiles: 1,
      boilerplateLinesSkipped: 10,
      usefulLinesKept: 200,
      compressionRatio: 85,
    },
  };

  it('includes the territory file listing with classified files', () => {
    const prompt = buildDiscoveryPrompt({
      angel,
      context,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('## Territory File Listing');
    expect(prompt).toContain('- [high] src/api/routes.ts');
    expect(prompt).toContain('- [medium] src/api/middleware.ts');
    expect(prompt).toContain('- [low] src/api/types.ts');
  });

  it('includes high/medium/low value sections', () => {
    const prompt = buildDiscoveryPrompt({
      angel,
      context,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('## High Value Files (full content)');
    expect(prompt).toContain('// routes.ts');
    expect(prompt).toContain('## Medium Value Files (stubs)');
    expect(prompt).toContain('// middleware.ts');
    expect(prompt).toContain('## Low Value Files');
    expect(prompt).toContain('- src/api/types.ts');
  });

  it('includes output instructions with response path', () => {
    const prompt = buildDiscoveryPrompt({
      angel,
      context,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('[OUTPUT INSTRUCTIONS]');
    expect(prompt).toContain('Write your response to: /responses/discovery.md');
  });

  it('shows root path correctly for root angel', () => {
    const rootAngel = { ...angel, type: 'root' as const, path: '.' };
    const prompt = buildDiscoveryPrompt({
      angel: rootAngel,
      context,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('You are the angel for: .');
  });
});

// ─── buildDenseDiscoveryPrompt ────────────────────────────────────────────────

describe('buildDenseDiscoveryPrompt', () => {
  const angel = {
    id: 'src-api',
    type: 'folder' as const,
    path: 'src/api',
  };

  const memoryConfig = { targetPct: 25, maxTokens: 2000 };

  const context = {
    territoryPath: 'src/api',
    fileCount: 3,
    classifiedFiles: [
      { path: 'src/api/routes.ts', value: 'high' as const, sizeBytes: 2048, language: 'TypeScript', reason: 'core routes' },
    ],
    highValueContent: '// routes.ts\nexport const router = ...',
    mediumValueStubs: '(none)',
    lowValueListing: '(none)',
    totalTokens: 5000,
    budgetUsed: 4000,
    memoryConfig,
    stats: {
      totalFiles: 3,
      highValueFiles: 1,
      mediumValueFiles: 0,
      lowValueFiles: 2,
      boilerplateLinesSkipped: 10,
      usefulLinesKept: 200,
      compressionRatio: 85,
    },
  };

  it('includes DENSE MODE header and stats', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('[CURRENT PHASE: DISCOVERY — DENSE MODE]');
    expect(prompt).toContain('Target size: ~2000 tokens');
    expect(prompt).toContain('Budget allocated: 25%');
  });

  it('with writeMode="direct" includes WRITE_MODE: DIRECT', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'direct',
      angelMdPath: '/project/.angels/src-api/angel.md',
    });
    expect(prompt).toContain('WRITE_MODE: DIRECT');
  });

  it('with writeMode="proposed" does NOT include WRITE_MODE', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).not.toContain('WRITE_MODE');
  });

  it('includes DENSE TEMPLATE section', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('[DENSE TEMPLATE — USE THIS STRUCTURE]');
  });

  it('direct write outputs angel.md path and instructions', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'direct',
      angelMdPath: '/project/.angels/src-api/angel.md',
    });
    expect(prompt).toContain('WRITE angel.md directly at: /project/.angels/src-api/angel.md');
    expect(prompt).toContain('DO NOT include the angel.md body in PROPOSED PLAN');
  });

  it('proposed mode writes to response path', () => {
    const prompt = buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig,
      responsePath: '/responses/discovery.md',
      writeMode: 'proposed',
    });
    expect(prompt).toContain('Write your response (the complete angel.md body) to: /responses/discovery.md');
  });
});

// ─── buildChunkPrompt ─────────────────────────────────────────────────────────

describe('buildChunkPrompt', () => {
  const angel = {
    id: 'src-api',
    type: 'folder' as const,
    path: 'src/api',
  };

  const baseContext = {
    territoryPath: 'src/api',
    fileCount: 5,
    classifiedFiles: [
      { path: 'src/api/routes.ts', value: 'high' as const, sizeBytes: 2048, language: 'TypeScript', reason: 'core routes' },
    ],
    highValueContent: '// routes.ts content here',
    mediumValueStubs: '(none)',
    lowValueListing: '(none)',
    totalTokens: 8000,
    budgetUsed: 6000,
    memoryConfig: { targetPct: 50, maxTokens: 4000 },
    stats: {
      totalFiles: 5,
      highValueFiles: 1,
      mediumValueFiles: 2,
      lowValueFiles: 2,
      boilerplateLinesSkipped: 20,
      usefulLinesKept: 400,
      compressionRatio: 80,
    },
  };

  const chunk0 = { id: 0, sections: ['Charter y Boundaries', 'Arquitectura del Área'], estimatedTokens: 500, contextHint: 'structure' };
  const chunk1 = { id: 1, sections: ['Cobertura de Código'], estimatedTokens: 500, contextHint: 'code coverage' };
  const chunkFinal = { id: 4, sections: ['Decision Log', 'Known Debt y TODO'], estimatedTokens: 500, contextHint: 'final sections' };

  it('chunk 0 mentions FIRST chunk', () => {
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunk0,
      deepContext: baseContext,
      chunkIndex: 0,
      totalChunks: 5,
    });
    expect(prompt).toContain('FIRST chunk');
    expect(prompt).toContain('CHUNKED WRITE, FIRST CHUNK');
    expect(prompt).toContain('WRITE_MODE: CHUNK');
  });

  it('chunk 0 includes section list', () => {
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunk0,
      deepContext: baseContext,
      chunkIndex: 0,
      totalChunks: 5,
    });
    expect(prompt).toContain('Charter y Boundaries, Arquitectura del Área');
  });

  it('chunk 1+ says "chunk N of M"', () => {
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunk1,
      deepContext: baseContext,
      chunkIndex: 1,
      totalChunks: 5,
    });
    expect(prompt).toContain('chunk 2/5');
    expect(prompt).toContain('Sections already written:');
    expect(prompt).toContain('WRITE_MODE: CHUNK');
  });

  it('last chunk uses CHUNK_FINAL write mode', () => {
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunkFinal,
      deepContext: baseContext,
      chunkIndex: 4,
      totalChunks: 5,
    });
    expect(prompt).toContain('CHUNK_FINAL');
  });

  it('includes discovery context stats', () => {
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunk0,
      deepContext: baseContext,
      chunkIndex: 0,
      totalChunks: 5,
    });
    expect(prompt).toContain('[DISCOVERY CONTEXT]');
    expect(prompt).toContain('Total files: 5');
    expect(prompt).toContain('High value: 1');
  });

  it('includes classified file listing when sections need file content', () => {
    const chunkWithCoverage = { id: 0, sections: ['Cobertura de Código'], estimatedTokens: 500, contextHint: 'coverage' };
    const prompt = buildChunkPrompt({
      angel,
      chunk: chunkWithCoverage,
      deepContext: baseContext,
      chunkIndex: 0,
      totalChunks: 3,
    });
    expect(prompt).toContain('[CLASSIFIED FILE LISTING]');
  });
});

// ─── buildFinalizePrompt ──────────────────────────────────────────────────────

describe('buildFinalizePrompt', () => {
  const angel = {
    id: 'src-api',
    type: 'folder' as const,
    path: 'src/api',
  };

  const context = {
    territoryPath: 'src/api',
    fileCount: 3,
    classifiedFiles: [
      { path: 'src/api/routes.ts', value: 'high' as const, sizeBytes: 2048, language: 'TypeScript', reason: 'core routes' },
    ],
    highValueContent: '// routes.ts',
    mediumValueStubs: '(none)',
    lowValueListing: '(none)',
    totalTokens: 5000,
    budgetUsed: 4000,
    memoryConfig: { targetPct: 25, maxTokens: 2000 },
    stats: {
      totalFiles: 3,
      highValueFiles: 1,
      mediumValueFiles: 0,
      lowValueFiles: 2,
      boilerplateLinesSkipped: 10,
      usefulLinesKept: 200,
      compressionRatio: 85,
    },
  };

  const finalAngelMd = [
    '---',
    'status: active',
    'last_updated: 2026-06-04T12:00:00Z',
    'last_updated_by: discovery',
    '---',
    '',
    '## Charter y Boundaries',
    'Owns the API layer.',
    '',
    '## Arquitectura del Área',
    'Express-based REST API.',
  ].join('\n');

  it('includes FINALIZE CHUNKED WRITE header', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('[CURRENT PHASE: DISCOVERY — FINALIZE CHUNKED WRITE]');
  });

  it('mentions angel.md path for the angel', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('.angels/src-api/angel.md');
  });

  it('asks to verify all 11 sections are present', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('Check that all 11 sections are present');
  });

  it('asks to verify frontmatter, sections, and empty/TODO/TBD checks', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('Check frontmatter has last_updated: now');
    expect(prompt).toContain("Check no section is empty or says 'TODO' or 'TBD'");
    expect(prompt).toContain('If anything is missing, write a brief CHUNK_FIX');
  });

  it('includes the final angel.md content as reference', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('[FINAL ANGEL.MD CONTENT]');
    expect(prompt).toContain('Owns the API layer.');
  });

  it('output instructions mention WRITE_MODE: CHUNK_FINAL', () => {
    const prompt = buildFinalizePrompt({
      angel,
      deepContext: context,
      finalAngelMd,
    });
    expect(prompt).toContain('WRITE_MODE: CHUNK_FINAL');
  });
});

// ─── measurePromptSize ────────────────────────────────────────────────────────

describe('measurePromptSize', () => {
  it('sections plus fixed sum to the total prompt bytes', () => {
    const input = makeInput();
    const prompt = buildPrompt(input);
    const report = measurePromptSize(prompt, input);
    const sum = report.sections.reduce((acc, s) => acc + s.bytes, 0);
    expect(report.totalBytes).toBe(Buffer.byteLength(prompt));
    expect(sum).toBe(report.totalBytes);
  });

  it('counts only the subject line for normal/low urgency cables', () => {
    const bigContent = 'X'.repeat(10_000);
    const cables: InboxEntry[] = [
      { urgency: 'normal', subject: 'short subject', content: bigContent },
    ];
    const input = makeInput({ inbox: cables });
    const prompt = buildPrompt(input);
    const report = measurePromptSize(prompt, input);
    const inbox = report.sections.find((s) => s.name === 'inbox')!;
    expect(inbox.bytes).toBe(Buffer.byteLength('- [normal] short subject'));
    // The full content never entered the prompt, so total stays small
    expect(report.totalBytes).toBeLessThan(10_000);
  });

  it('counts full content for high urgency cables', () => {
    const content = 'URGENT: the build is broken because of X'.repeat(10);
    const cables: InboxEntry[] = [
      { urgency: 'high', subject: 'ignored for sizing', content },
    ];
    const input = makeInput({ inbox: cables });
    const prompt = buildPrompt(input);
    const report = measurePromptSize(prompt, input);
    const inbox = report.sections.find((s) => s.name === 'inbox')!;
    expect(inbox.bytes).toBe(Buffer.byteLength(content));
  });
});
