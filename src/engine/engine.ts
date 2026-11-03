import { App, Notice } from 'obsidian';
import { Runner, Event, Gemini } from '@google/adk';
import { ObsidianSessionService } from './session-service';
import { createCoordinatorAgent } from './agents/coordinator';
import { createLibrarianAgent } from './agents/librarian';
import { createProfessorAgent } from './agents/professor';
import { createResearcherAgent } from './agents/researcher';
import { createNoteTakerAgent } from './agents/notetaker';
import {
    saveAndIndexDocument,
    listLibraryCatalog,
    sanitizeFileName,
    getExistingLibraryTaxonomy,
    DocumentKind,
    SaveAndIndexResult
} from './pdf-service';
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

    public async ingestFile(
        file: File,
        metadata: { docKind?: DocumentKind; topicHint?: string },
        onProgress?: (status: string) => void
    ) {
        // Enforce max size limit (25MB for research PDFs/books)
        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            new Notice(`File ${file.name} exceeds the 25MB limit.`);
            return;
        }

        const docKind: DocumentKind = metadata?.docKind || 'Paper';
        const topicHint = metadata?.topicHint?.trim() || '';

        onProgress?.(`📄 Extracting ${file.name}...`);
        const buffer = await file.arrayBuffer();
        const saved = await saveAndIndexDocument(this.app, {
            buffer,
            filename: file.name,
            docKind,
            title: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
            topicFolder: topicHint || undefined,
            subject: topicHint ? topicHint.toLowerCase() : undefined
        });

        onProgress?.(`🤖 Indexing "${saved.title}" with Librarian...`);
        await this.autoIndexUploadedDocument(saved, docKind, topicHint);

        new Notice(`Indexed ${docKind} "${saved.title}" into Library & Library Index!`);
    }

    private async autoIndexUploadedDocument(
        saved: SaveAndIndexResult,
        docKind: DocumentKind,
        topicHint: string
    ) {
        const taxonomy = await getExistingLibraryTaxonomy(this.app);
        const tempSessionId = `auto_index_${Date.now()}`;

        const prompt = [
            `A new ${docKind} has been uploaded to the Vault and needs to be organized and indexed.`,
            ``,
            `### UPLOADED DOCUMENT DETAILS`,
            `- **Document Kind**: ${docKind}`,
            `- **Current File Path**: ${saved.filePath}`,
            `- **Current Index Path**: ${saved.indexPath}`,
            `- **Extracted Title**: ${saved.title}`,
            `- **Heuristically Extracted Authors**: ${saved.authors}`,
            `- **Total Pages**: ${saved.totalPages}`,
            `- **User Topic Hint**: ${topicHint || 'None (infer automatically)'}`,
            `- **Existing Library Topic Subfolders**: ${taxonomy.topicFolders.length > 0 ? JSON.stringify(taxonomy.topicFolders) : 'None yet'}`,
            `- **Existing Canonical Authors in Library**: ${taxonomy.canonicalAuthors.length > 0 ? JSON.stringify(taxonomy.canonicalAuthors) : 'None yet'}`,
            ``,
            `### EXTRACTED STRUCTURE & TEXT PREVIEW`,
            `- **Extracted Abstract / Overview**: ${saved.abstractText || '(Not directly detected)'}`,
            `- **Extracted Section / Chapter Titles**: ${saved.sectionTitles.length > 0 ? JSON.stringify(saved.sectionTitles) : '(None detected)'}`,
            `- **Extracted Conclusions**: ${saved.conclusionsText || '(Not directly detected)'}`,
            `- **Text Preview (First Pages)**:`,
            saved.textPreview.slice(0, 3500),
            ``,
            `### REQUIRED ACTIONS`,
            `1. If the authors are "Unknown" or incomplete, or if this is a Book/Paper missing its overview/abstract in the preview above, use the **Researcher** (\`web_search\`) to look up the title "${saved.title}" and find the accurate authors and overview.`,
            `2. Call the **Librarian** tool \`organize_and_index_document\` with:`,
            `   - \`title\`: Clean official title of the ${docKind}`,
            `   - \`doc_kind\`: "${docKind}"`,
            `   - \`topic_folder\`: Choose an existing folder from ${JSON.stringify(taxonomy.topicFolders)} if the topic fits; otherwise create a clean, general topic folder name (e.g. "Machine Learning", "Game Theory", "Economics").`,
            `   - \`subject\`: Lowercase subject matching the topic`,
            `   - \`author\`: Comma-separated author names in "First Last" format, reusing any matching names from ${JSON.stringify(taxonomy.canonicalAuthors)}`,
            `   - \`tags\`: 3 to 6 relevant lowercase tags`,
            `   - \`abstract\`: Clean abstract or book/document overview`,
            `   - \`section_titles\`: Array of main section or chapter titles`,
            `   - \`summary\`: Concise, high-signal structured summary of the key contributions and takeaways`,
            `   - \`conclusions\`: Concise conclusions and takeaways`,
            `   - \`file_path\`: "${saved.filePath}"`
        ].join('\n');

        try {
            for await (const _chunk of this.sendMessage(tempSessionId, prompt)) {
                // Consume agent events until Librarian completes indexing
            }
        } catch (err) {
            console.warn("Agent auto-indexing fallback (initial deterministic index preserved):", err);
        } finally {
            try {
                await this.sessionService.deleteSession({ appName: 'dyresearch', sessionId: tempSessionId });
            } catch {
                // Ignore cleanup error
            }
        }
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
