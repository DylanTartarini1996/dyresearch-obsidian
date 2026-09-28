import { App } from 'obsidian';
import { BaseSessionService, CreateSessionRequest, GetSessionRequest, ListSessionsRequest, ListSessionsResponse, DeleteSessionRequest, AppendEventRequest, Session, Event } from '@google/adk';

export class ObsidianSessionService extends BaseSessionService {
    private app: App;
    private basePath: string = 'DyResearch/Sessions';

    constructor(app: App) {
        super();
        this.app = app;
        this.ensureBaseDirectory();
    }

    private async ensureBaseDirectory() {
        const exists = await this.app.vault.adapter.exists(this.basePath);
        if (!exists) {
            await this.app.vault.adapter.mkdir(this.basePath);
        }
    }

    private getFilePath(sessionId: string): string {
        return `${this.basePath}/${sessionId}.json`;
    }

    async createSession(request: CreateSessionRequest): Promise<Session> {
        const sessionId = request.sessionId || `session_${Date.now()}`;
        const session: Session = {
            appName: request.appName,
            userId: request.userId,
            sessionId: sessionId,
            state: request.state || {},
            events: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const filePath = this.getFilePath(sessionId);
        await this.app.vault.adapter.write(filePath, JSON.stringify(session, null, 2));
        return session;
    }

    async getSession(request: GetSessionRequest): Promise<Session | undefined> {
        const filePath = this.getFilePath(request.sessionId);
        const exists = await this.app.vault.adapter.exists(filePath);
        if (!exists) return undefined;

        const content = await this.app.vault.adapter.read(filePath);
        const session: Session = JSON.parse(content);
        
        // Optional: Filter by config (numRecentEvents, afterTimestamp) if provided in request.config
        return session;
    }

    async listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse> {
        const exists = await this.app.vault.adapter.exists(this.basePath);
        if (!exists) {
            return { sessions: [], page: 1, limit: 0, totalItems: 0, totalPages: 0 };
        }

        const files = await this.app.vault.adapter.list(this.basePath);
        const sessions: Session[] = [];

        for (const file of files.files) {
            if (file.endsWith('.json')) {
                const content = await this.app.vault.adapter.read(file);
                try {
                    const session = JSON.parse(content);
                    if (session.appName === request.appName && (!request.userId || session.userId === request.userId)) {
                        sessions.push(session);
                    }
                } catch (e) {
                    console.error("Failed to parse session file", file);
                }
            }
        }

        // Sort by updatedAt desc by default
        sessions.sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime());

        const totalItems = sessions.length;
        const limit = request.limit || totalItems;
        const page = request.page || 1;
        
        return {
            sessions: sessions, // Ideally paginated, but returning all for now
            page: page,
            limit: limit,
            totalItems: totalItems,
            totalPages: limit > 0 ? Math.ceil(totalItems / limit) : 1
        };
    }

    async deleteSession(request: DeleteSessionRequest): Promise<void> {
        const filePath = this.getFilePath(request.sessionId);
        const exists = await this.app.vault.adapter.exists(filePath);
        if (exists) {
            await this.app.vault.adapter.remove(filePath);
        }
    }

    async appendEvent(request: AppendEventRequest): Promise<Event> {
        // Call the base class to update the in-memory session state first
        const event = await super.appendEvent(request);
        
        // request.session is mutated by super.appendEvent to include the new event and state delta
        request.session.updatedAt = new Date().toISOString();

        // Write the updated session back to the file
        const filePath = this.getFilePath(request.session.sessionId);
        await this.app.vault.adapter.write(filePath, JSON.stringify(request.session, null, 2));

        return event;
    }
}
