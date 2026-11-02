import assert from 'node:assert';
import { DyResearchEngine } from './src/engine/engine';

const files = new Map<string, string>();
const dirs = new Set<string>();

const mockApp = {
    vault: {
        adapter: {
            exists: async (p: string) => dirs.has(p) || files.has(p),
            mkdir: async (p: string) => { dirs.add(p); },
            write: async (p: string, c: string) => { files.set(p, c); },
            read: async (p: string) => files.get(p) || '',
            remove: async (p: string) => { files.delete(p); },
            list: async (p: string) => ({
                files: [...files.keys()].filter(k => k.startsWith(p + '/')),
                folders: []
            })
        }
    }
} as any;

const mockPlugin = {
    settings: {
        apiKeys: { gemini: 'test-key', openai: '', anthropic: '' },
        agents: {
            coordinator: { provider: 'gemini', model: 'gemini-2.5-flash' },
            professor: { provider: 'gemini', model: 'gemini-2.5-flash' },
            librarian: { provider: 'gemini', model: 'gemini-2.5-flash' },
            researcher: { provider: 'gemini', model: 'gemini-2.5-flash' },
            notetaker: { provider: 'gemini', model: 'gemini-2.5-flash' }
        }
    }
} as any;

(async () => {
    const engine = new DyResearchEngine(mockApp, mockPlugin);
    engine.initialize();
    const session = await engine.ensureSession('test_session_1');
    assert.strictEqual(session.id, 'test_session_1');
    assert.ok(dirs.has('DyResearch') && dirs.has('DyResearch/Sessions'));
    assert.ok(files.has('DyResearch/Sessions/test_session_1.md'));
    await engine.renameSession('test_session_1', 'renamed_session');
    assert.ok(files.has('DyResearch/Sessions/renamed_session.md'));
    assert.ok(!files.has('DyResearch/Sessions/test_session_1.md'));
    const listed = await engine.getSessions();
    assert.strictEqual(listed.sessions.length, 1);
    assert.strictEqual(listed.sessions[0].id, 'renamed_session');
    console.log("All session markdown checks passed.");
})();
