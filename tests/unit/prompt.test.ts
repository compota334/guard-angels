import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  getProtocolHeaderLength,
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

describe('getProtocolHeaderLength', () => {
  it('returns the header character count', () => {
    const len = getProtocolHeaderLength();
    expect(len).toBeGreaterThan(0);
    expect(typeof len).toBe('number');
  });

  it('header is under ~600 tokens (rough estimate: length / 4 < 600)', () => {
    const len = getProtocolHeaderLength();
    const estimatedTokens = len / 4;
    expect(estimatedTokens).toBeLessThan(600);
  });
});
