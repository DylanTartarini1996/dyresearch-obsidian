import { App, Notice } from 'obsidian';
import { Runner, Event, Gemini } from '@google/adk';
import { ObsidianSessionService } from './session-service';
import { createCoordinatorAgent } from './agents/coordinator';
import { createLibrarianAgent } from './agents/librarian';
import { createProfessorAgent } from './agents/professor';
import { createResearcherAgent } from './agents/researcher';
import { createNoteTakerAgent } from './agents/notetaker';
import type DyResearchPlugin from '../main';

export class DyResearchEngine {
    private app: App;
    private plugin: DyResearchPlugin;
    public sessionService: ObsidianSessionService;
    private runner: Runner | null = null;

    constructor(app: App, plugin: DyResearchPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.sessionService = new ObsidianSessionService(this.app);
    }

    public initialize() {
        const getApiKey = (provider: string) => this.plugin.settings.apiKeys[provider as keyof typeof this.plugin.settings.apiKeys];

        const getModel = (config: any) => {
            if (config.provider === 'gemini') {
                return new Gemini({ model: config.model, apiKey: getApiKey(config.provider) });
            }
            return config.model;
        };

        const librarian = createLibrarianAgent({
            model: getModel(this.plugin.settings.agents.librarian) as any,
            provider: this.plugin.settings.agents.librarian.provider,
            apiKey: getApiKey(this.plugin.settings.agents.librarian.provider)
        }, this.app);

        const professor = createProfessorAgent({
            model: getModel(this.plugin.settings.agents.professor) as any,
            provider: this.plugin.settings.agents.professor.provider,
            apiKey: getApiKey(this.plugin.settings.agents.professor.provider)
        }, this.app);

        const researcher = createResearcherAgent({
            model: getModel(this.plugin.settings.agents.researcher) as any,
            provider: this.plugin.settings.agents.researcher.provider,
            apiKey: getApiKey(this.plugin.settings.agents.researcher.provider)
        }, this.app);

        const notetaker = createNoteTakerAgent({
            model: getModel(this.plugin.settings.agents.notetaker) as any,
            provider: this.plugin.settings.agents.notetaker.provider,
            apiKey: getApiKey(this.plugin.settings.agents.notetaker.provider)
        }, this.app);

        const coordinatorConfig = this.plugin.settings.agents.coordinator;
        const rootAgent = createCoordinatorAgent({
            model: getModel(coordinatorConfig) as any,
            provider: coordinatorConfig.provider,
            apiKey: getApiKey(coordinatorConfig.provider)
        }, [librarian, professor, researcher, notetaker]);

        this.runner = new Runner({
            appName: 'dyresearch',
            agent: rootAgent,
            sessionService: this.sessionService
        });
    }

    public async ensureSession(sessionId: string) {
        return await this.sessionService.getOrCreateSession({
            appName: 'dyresearch',
            userId: 'local-user',
            sessionId: sessionId
        });
    }

    public async *sendMessage(sessionId: string, text: string): AsyncGenerator<Event, void, undefined> {
        if (!this.runner) {
            this.initialize();
        }

        if (!this.runner) {
            throw new Error("Engine not initialized");
        }

        await this.ensureSession(sessionId);

        const events = this.runner.runAsync({
            userId: 'local-user',
            sessionId: sessionId,
            newMessage: { parts: [{ text }] }
        });

        for await (const event of events) {
            yield event;
        }
    }

    public async getSessions() {
        return await this.sessionService.listSessions({ appName: 'dyresearch' });
    }

    public async renameSession(oldSessionId: string, newSessionId: string) {
        await this.sessionService.renameSession(oldSessionId, newSessionId);
    }

    public async ingestFile(file: File, metadata: any) {
        // Enforce max size limit (e.g. 5MB)
        const MAX_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            new Notice(`File ${file.name} exceeds the 5MB limit.`);
            return;
        }

        // Save original file to DyResearch/Library/Originals/
        const originalsDir = 'DyResearch/Library/Originals';
        const exists = await this.app.vault.adapter.exists(originalsDir);
        if (!exists) {
            // Recursive mkdir basically
            const libExists = await this.app.vault.adapter.exists('DyResearch/Library');
            if (!libExists) await this.app.vault.adapter.mkdir('DyResearch/Library');
            await this.app.vault.adapter.mkdir(originalsDir);
        }

        const buffer = await file.arrayBuffer();
        const originalPath = `${originalsDir}/${file.name}`;
        await this.app.vault.adapter.writeBinary(originalPath, buffer);

        // TODO: Pass to Librarian Agent for summarization.
        // For now, simulate success:
        new Notice(`File ${file.name} saved to Vault successfully!`);
    }

    public async getLibraryFiles() {
        const exists = await this.app.vault.adapter.exists('DyResearch/Library/Originals');
        if (!exists) return [];
        const files = await this.app.vault.adapter.list('DyResearch/Library/Originals');
        return files.files.map(f => ({
            title: f.split('/').pop(),
            type: f.endsWith('.pdf') ? 'PDF' : 'Document',
            authors: 'Unknown',
            subject: 'General'
        }));
    }

    public async deleteLibraryFile(filename: string) {
        const path = `DyResearch/Library/Originals/${filename}`;
        const exists = await this.app.vault.adapter.exists(path);
        if (exists) {
            await this.app.vault.adapter.remove(path);
        }
    }
}
