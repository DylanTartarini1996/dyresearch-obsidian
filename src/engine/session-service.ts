import { App } from 'obsidian';
import { BaseSessionService, CreateSessionRequest, GetSessionRequest, ListSessionsRequest, ListSessionsResponse, DeleteSessionRequest, AppendEventRequest, Session, Event, createEvent } from '@google/adk';

export type ObsidianSession = Session & {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
};

const STATE_BLOCK_REGEX = /<!--\s*dyresearch-session-state\r?\n([\s\S]*?)\r?\n-->/;

export class ObsidianSessionService extends BaseSessionService {
    private app: App;
    private basePath: string = 'DyResearch/Sessions';

    constructor(app: App) {
        super();
        this.app = app;
        this.ensureBaseDirectory().catch(() => {});
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

    private parseSessionFromMarkdown(content: string, fallbackId?: string): ObsidianSession {
        const match = content.match(STATE_BLOCK_REGEX);
        const raw = match ? JSON.parse(match[1]) : JSON.parse(content);
        const id = raw.id || raw.sessionId || fallbackId || `session_${Date.now()}`;
        const updatedIso = raw.updatedAt || new Date(raw.lastUpdateTime || Date.now()).toISOString();
        const createdIso = raw.createdAt || updatedIso;
        const lastUpdateTime = typeof raw.lastUpdateTime === 'number'
            ? raw.lastUpdateTime
            : new Date(updatedIso).getTime();

        const rawEvents = Array.isArray(raw.events) ? raw.events : [];
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
        const filePath = this.getFilePath(session.id || session.sessionId);
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
        const sessionId = request.sessionId || `obsidian_${Date.now()}`;
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

        await this.writeSessionFile(session);
        return session;
    }

    async getSession(request: GetSessionRequest): Promise<ObsidianSession | undefined> {
        const filePath = this.getFilePath(request.sessionId);
        const exists = await this.app.vault.adapter.exists(filePath);
        if (!exists) return undefined;

        const content = await this.app.vault.adapter.read(filePath);
        return this.parseSessionFromMarkdown(content, request.sessionId);
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
                const content = await this.app.vault.adapter.read(file);
                try {
                    const fallbackId = file.split('/').pop()?.replace(/\.(md|json)$/, '');
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

    async renameSession(oldSessionId: string, newSessionId: string): Promise<void> {
        const session = await this.getSession({ appName: 'dyresearch', userId: 'local-user', sessionId: oldSessionId });
        if (!session) return;
        session.id = newSessionId;
        session.sessionId = newSessionId;
        session.updatedAt = new Date().toISOString();
        session.lastUpdateTime = Date.now();
        await this.writeSessionFile(session);
        await this.deleteSession({ appName: session.appName, userId: session.userId, sessionId: oldSessionId });
    }

    async deleteSession(request: DeleteSessionRequest): Promise<void> {
        const filePath = this.getFilePath(request.sessionId);
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
        const sessionId = session.id || session.sessionId;
        session.id = sessionId;
        session.sessionId = sessionId;
        session.updatedAt = new Date().toISOString();
        session.lastUpdateTime = event.timestamp || Date.now();

        await this.writeSessionFile(session);
        return event;
    }
}
