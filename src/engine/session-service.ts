import { App } from 'obsidian';
import { BaseSessionService, CreateSessionRequest, GetSessionRequest, ListSessionsRequest, ListSessionsResponse, DeleteSessionRequest, AppendEventRequest, Session, Event, createEvent } from '@google/adk';

export type ObsidianSession = Session & {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
};

const STATE_BLOCK_REGEX = /<!--\s*dyresearch-session-state\r?\n([\s\S]*?)\r?\n-->/;

export function sanitizeSessionId(rawId: string): string {
    return rawId
        .trim()
        .replace(/\.md$/i, '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

export class ObsidianSessionService extends BaseSessionService {
    private app: App;
    private basePath: string = 'DyResearch/Sessions';
    private activeSessions = new Map<string, ObsidianSession>();
    private renamedAliases = new Map<string, string>();

    constructor(app: App) {
        super();
        this.app = app;
        this.ensureBaseDirectory().catch(() => {});
    }

    public resolveSessionId(sessionId: string): string {
        let current = sanitizeSessionId(sessionId) || sessionId;
        const visited = new Set<string>();
        while (this.renamedAliases.has(current) && !visited.has(current)) {
            visited.add(current);
            current = this.renamedAliases.get(current)!;
        }
        return current;
    }

    private async ensureBaseDirectory() {
        const parts = this.basePath.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!(await this.app.vault.adapter.exists(current))) {
                if (this.app.vault.createFolder) {
                    try {
                        await this.app.vault.createFolder(current);
                    } catch {
                        if (!(await this.app.vault.adapter.exists(current))) {
                            await this.app.vault.adapter.mkdir(current);
                        }
                    }
                } else {
                    await this.app.vault.adapter.mkdir(current);
                }
            }
        }
    }

    private getFilePath(sessionId: string): string {
        return `${this.basePath}/${sessionId}.md`;
    }

    private serializeSessionToMarkdown(session: ObsidianSession): string {
        const lines: string[] = [
            '---',
            `id: ${session.id}`,
            `sessionId: ${session.sessionId}`,
            `appName: ${session.appName}`,
            `userId: ${session.userId}`,
            `createdAt: ${session.createdAt}`,
            `updatedAt: ${session.updatedAt}`,
            `lastUpdateTime: ${session.lastUpdateTime}`,
            '---',
            '',
            `# Session: ${session.sessionId}`,
            ''
        ];

        for (const evt of session.events || []) {
            const parts = (evt as any).content?.parts || (evt as any).newMessage?.parts || (evt as any).modelResponse?.parts || [];
            const text = parts
                .filter((p: any) => p?.text && !p?.thought)
                .map((p: any) => p.text)
                .join('')
                .trim();

            if (text) {
                const role = (evt as any).author === 'user' ? '👤 You' : `🤖 ${(evt as any).author || 'AI'}`;
                lines.push(`### ${role}`, '', text, '');
            } else if ((evt as any).errorMessage) {
                lines.push(`### ⚠️ Error`, '', String((evt as any).errorMessage), '');
            }
        }

        const payload = JSON.stringify({
            id: session.id,
            sessionId: session.sessionId,
            appName: session.appName,
            userId: session.userId,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            lastUpdateTime: session.lastUpdateTime,
            state: session.state || {},
            events: session.events || []
        }).replace(/-->/g, '--\\u003e');

        lines.push('<!-- dyresearch-session-state', payload, '-->', '');
        return lines.join('\n');
    }

    private parseMarkdownFallbackEvents(content: string): any[] {
        const events: any[] = [];
        const bodyWithoutState = content
            .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
            .replace(STATE_BLOCK_REGEX, '');
        const blockRegex = /^###\s+(.+)\r?\n([\s\S]*?)(?=^###\s+|$)/gm;
        let m: RegExpExecArray | null;
        let idx = 0;
        while ((m = blockRegex.exec(bodyWithoutState)) !== null) {
            const header = m[1].trim();
            const text = m[2].trim();
            if (!text || header.includes('Error')) continue;
            const isUser = header.includes('You') || header.toLowerCase().includes('user');
            const author = isUser ? 'user' : (header.replace(/^🤖\s*/, '').trim() || 'coordinator_agent');
            events.push({
                id: `md_evt_${idx++}`,
                invocationId: `md_inv_${idx}`,
                author,
                content: {
                    role: isUser ? 'user' : 'model',
                    parts: [{ text }]
                },
                timestamp: Date.now()
            });
        }
        return events;
    }

    private parseSessionFromMarkdown(content: string, fallbackId?: string): ObsidianSession {
        const match = content.match(STATE_BLOCK_REGEX);
        let raw: any = {};
        if (match) {
            try {
                raw = JSON.parse(match[1]);
            } catch {
                raw = {};
            }
        } else {
            try {
                raw = JSON.parse(content);
            } catch {
                raw = { events: this.parseMarkdownFallbackEvents(content) };
            }
        }

        // Authoritative ID is the filename on disk (fallbackId) when present, so renaming the .md file always works
        const id = fallbackId || raw.id || raw.sessionId || `session_${Date.now()}`;
        const updatedIso = raw.updatedAt || new Date(raw.lastUpdateTime || Date.now()).toISOString();
        const createdIso = raw.createdAt || updatedIso;
        const lastUpdateTime = typeof raw.lastUpdateTime === 'number'
            ? raw.lastUpdateTime
            : new Date(updatedIso).getTime();

        const rawEvents = Array.isArray(raw.events) && raw.events.length > 0
            ? raw.events
            : this.parseMarkdownFallbackEvents(content);
        const cleanedEvents = rawEvents.filter((e: any) => !(Array.isArray(e.longRunningToolIds) && e.longRunningToolIds.length > 0));

        return {
            id,
            sessionId: id,
            appName: raw.appName || 'dyresearch',
            userId: raw.userId || 'local-user',
            state: raw.state || {},
            events: cleanedEvents.map((e: any) => createEvent(e)),
            createdAt: createdIso,
            updatedAt: updatedIso,
            lastUpdateTime
        };
    }

    private async writeSessionFile(session: ObsidianSession): Promise<void> {
        await this.ensureBaseDirectory();
        const resolvedId = this.resolveSessionId(session.id || session.sessionId);
        session.id = resolvedId;
        session.sessionId = resolvedId;
        const filePath = this.getFilePath(resolvedId);
        const content = this.serializeSessionToMarkdown(session);
        const existingFile = this.app.vault.getAbstractFileByPath?.(filePath);
        if (existingFile && this.app.vault.modify) {
            await this.app.vault.modify(existingFile as any, content);
        } else if (!existingFile && this.app.vault.create && !(await this.app.vault.adapter.exists(filePath))) {
            await this.app.vault.create(filePath, content);
        } else {
            await this.app.vault.adapter.write(filePath, content);
        }
    }

    async createSession(request: CreateSessionRequest): Promise<ObsidianSession> {
        const rawId = request.sessionId || `obsidian_${Date.now()}`;
        const sessionId = this.resolveSessionId(rawId);
        const now = new Date();
        const session: ObsidianSession = {
            id: sessionId,
            sessionId: sessionId,
            appName: request.appName,
            userId: request.userId,
            state: request.state || {},
            events: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            lastUpdateTime: now.getTime(),
        };

        this.activeSessions.set(sessionId, session);
        await this.writeSessionFile(session);
        return session;
    }

    async getSession(request: GetSessionRequest): Promise<ObsidianSession | undefined> {
        const resolvedId = this.resolveSessionId(request.sessionId);
        const filePath = this.getFilePath(resolvedId);
        const exists = await this.app.vault.adapter.exists(filePath);
        if (!exists) {
            return this.activeSessions.get(resolvedId);
        }

        const content = await this.app.vault.adapter.read(filePath);
        const parsed = this.parseSessionFromMarkdown(content, resolvedId);

        // If an in-memory session exists for this ID, sync its events/state in place so active Runner references stay valid
        const existingInMemory = this.activeSessions.get(resolvedId);
        if (existingInMemory) {
            existingInMemory.id = resolvedId;
            existingInMemory.sessionId = resolvedId;
            existingInMemory.state = parsed.state;
            existingInMemory.events = parsed.events;
            existingInMemory.updatedAt = parsed.updatedAt;
            existingInMemory.lastUpdateTime = parsed.lastUpdateTime;
            return existingInMemory;
        }

        this.activeSessions.set(resolvedId, parsed);
        return parsed;
    }

    async listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse> {
        await this.ensureBaseDirectory();
        const exists = await this.app.vault.adapter.exists(this.basePath);
        if (!exists) {
            return { sessions: [], page: 1, limit: 0, totalItems: 0, totalPages: 0 };
        }

        const files = await this.app.vault.adapter.list(this.basePath);
        const sessions: ObsidianSession[] = [];

        for (const file of files.files) {
            if (file.endsWith('.md') || file.endsWith('.json')) {
                const fallbackId = file.split('/').pop()?.replace(/\.(md|json)$/, '');
                if (fallbackId && fallbackId.startsWith('auto_index_')) continue;
                const content = await this.app.vault.adapter.read(file);
                try {
                    const session = this.parseSessionFromMarkdown(content, fallbackId);
                    if (session.appName === request.appName && (!request.userId || session.userId === request.userId)) {
                        sessions.push(session);
                    }
                } catch (e) {
                    console.error("Failed to parse session file", file, e);
                }
            }
        }

        sessions.sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);

        const totalItems = sessions.length;
        const limit = request.limit || totalItems;
        const page = request.page || 1;
        
        return {
            sessions: sessions,
            page: page,
            limit: limit,
            totalItems: totalItems,
            totalPages: limit > 0 ? Math.ceil(totalItems / limit) : 1
        };
    }

    async renameSession(oldSessionId: string, newSessionId: string): Promise<string> {
        const cleanOldId = this.resolveSessionId(oldSessionId);
        const cleanNewId = sanitizeSessionId(newSessionId);
        if (!cleanNewId) {
            throw new Error("Session name cannot be empty.");
        }
        if (cleanOldId === cleanNewId) {
            return cleanNewId;
        }

        const newFilePath = this.getFilePath(cleanNewId);
        const oldFilePath = this.getFilePath(cleanOldId);
        const isCaseOnlyRename = oldFilePath.toLowerCase() === newFilePath.toLowerCase();

        if (!isCaseOnlyRename && await this.app.vault.adapter.exists(newFilePath)) {
            throw new Error(`A session named "${cleanNewId}" already exists.`);
        }

        let session = await this.getSession({ appName: 'dyresearch', userId: 'local-user', sessionId: cleanOldId });
        if (!session) {
            session = await this.createSession({ appName: 'dyresearch', userId: 'local-user', sessionId: cleanOldId });
        }

        // Record alias so any in-flight Runner turn referencing oldSessionId automatically targets cleanNewId
        this.renamedAliases.set(oldSessionId, cleanNewId);
        this.renamedAliases.set(cleanOldId, cleanNewId);
        this.renamedAliases.delete(cleanNewId);

        // Mutate the session object in place so in-flight ADK Runner references keep all events & state under the new ID
        session.id = cleanNewId;
        session.sessionId = cleanNewId;
        session.updatedAt = new Date().toISOString();
        session.lastUpdateTime = Date.now();

        this.activeSessions.delete(cleanOldId);
        this.activeSessions.set(cleanNewId, session);

        // Rename the underlying Markdown file in Obsidian Vault if it exists
        const existingAbstract = this.app.vault.getAbstractFileByPath?.(oldFilePath);
        if (existingAbstract && typeof this.app.vault.rename === 'function') {
            try {
                await this.app.vault.rename(existingAbstract as any, newFilePath);
            } catch {
                // Fallback to write + delete below if vault.rename fails
            }
        }

        await this.writeSessionFile(session);

        if (!isCaseOnlyRename && await this.app.vault.adapter.exists(oldFilePath)) {
            await this.deleteSession({ appName: session.appName, userId: session.userId, sessionId: cleanOldId });
        }

        return cleanNewId;
    }

    async deleteSession(request: DeleteSessionRequest): Promise<void> {
        const cleanId = sanitizeSessionId(request.sessionId) || request.sessionId;
        this.activeSessions.delete(cleanId);
        const filePath = this.getFilePath(cleanId);
        const existingFile = this.app.vault.getAbstractFileByPath?.(filePath);
        if (existingFile && this.app.vault.delete) {
            await this.app.vault.delete(existingFile as any);
            return;
        }
        const exists = await this.app.vault.adapter.exists(filePath);
        if (exists) {
            await this.app.vault.adapter.remove(filePath);
        }
    }

    async appendEvent(request: AppendEventRequest): Promise<Event> {
        const event = await super.appendEvent(request);
        const session = request.session as ObsidianSession;
        const resolvedId = this.resolveSessionId(session.id || session.sessionId);
        session.id = resolvedId;
        session.sessionId = resolvedId;
        session.updatedAt = new Date().toISOString();
        session.lastUpdateTime = event.timestamp || Date.now();

        this.activeSessions.set(resolvedId, session);
        await this.writeSessionFile(session);
        return event;
    }
}
