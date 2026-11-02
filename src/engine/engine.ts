import { App, Notice } from 'obsidian';
import { Runner, Event, Gemini } from '@google/adk';
import { ObsidianSessionService } from './session-service';
import { createCoordinatorAgent } from './agents/coordinator';
import { createLibrarianAgent } from './agents/librarian';
import { createProfessorAgent } from './agents/professor';
import { createResearcherAgent } from './agents/researcher';
import { createNoteTakerAgent } from './agents/notetaker';
import { saveAndIndexDocument, listLibraryCatalog, sanitizeFileName } from './pdf-service';
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

    public async ingestFile(file: File, metadata: { subject?: string; authors?: string }) {
        // Enforce max size limit (e.g. 25MB for research PDFs)
        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            new Notice(`File ${file.name} exceeds the 25MB limit.`);
            return;
        }

        const buffer = await file.arrayBuffer();
        const topicFolder = metadata?.subject?.trim() || '';
        const saved = await saveAndIndexDocument(this.app, {
            buffer,
            filename: file.name,
            title: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
            authors: metadata?.authors?.trim() || undefined,
            topicFolder: topicFolder || undefined,
            subject: topicFolder ? topicFolder.toLowerCase() : 'general'
        });

        new Notice(`Saved ${file.name} to ${saved.filePath} and indexed ${saved.totalPages} page(s) in Library Index!`);
    }

    public async getLibraryFiles() {
        return await listLibraryCatalog(this.app);
    }

    public async deleteLibraryFile(titleOrFilename: string) {
        const entries = await listLibraryCatalog(this.app);
        const safeTarget = sanitizeFileName(titleOrFilename).toLowerCase();
        const match = entries.find(e =>
            e.title.toLowerCase() === titleOrFilename.toLowerCase() ||
            sanitizeFileName(e.title).toLowerCase() === safeTarget ||
            e.filePath.endsWith(`/${titleOrFilename}`)
        );

        if (match) {
            if (match.indexPath && await this.app.vault.adapter.exists(match.indexPath)) {
                await this.app.vault.adapter.remove(match.indexPath);
            }
            if (match.filePath && await this.app.vault.adapter.exists(match.filePath)) {
                await this.app.vault.adapter.remove(match.filePath);
            }
        }
    }
}
