import { App } from 'obsidian';
import { DyResearchEngine } from './src/engine/engine';

// Mock App and Plugin
const mockApp = { vault: { adapter: { exists: async () => false } } } as any;
const mockPlugin = {
    settings: {
        apiKeys: { gemini: 'test-key', openai: '', anthropic: '' },
        agents: {
            coordinator: { provider: 'gemini', model: 'gemini-1.5-flash' },
            professor: { provider: 'gemini', model: 'gemini-1.5-flash' },
            librarian: { provider: 'gemini', model: 'gemini-1.5-flash' },
            researcher: { provider: 'gemini', model: 'gemini-1.5-flash' },
            notetaker: { provider: 'gemini', model: 'gemini-1.5-flash' }
        }
    }
} as any;

const engine = new DyResearchEngine(mockApp, mockPlugin);
try {
    engine.initialize();
    console.log("Engine initialized successfully.");
} catch (e) {
    console.error("Error during initialization:", e);
}
