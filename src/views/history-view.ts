import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import type DyResearchPlugin from '../main';

export const VIEW_TYPE_HISTORY = "dyresearch-history-view";

export class HistoryView extends ItemView {
    private activeTab: 'chats' | 'library' = 'chats';
    private searchQuery = "";
    private isFuzzySearch = false;

    constructor(leaf: WorkspaceLeaf, private plugin: DyResearchPlugin) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_HISTORY; }
    getDisplayText() { return "DyResearch History"; }

    async onOpen() {
        this.refreshView();
    }

    async refreshView() {
        const container = this.containerEl.children[1];
        container.empty();

        const navContainer = container.createDiv({ cls: 'dy-nav-tabs' });
        
        const chatsTab = navContainer.createEl('button', { text: '💬 Chats', cls: 'dy-tab-btn' });
        const libTab = navContainer.createEl('button', { text: '📚 Library', cls: 'dy-tab-btn' });

        if (this.activeTab === 'chats') chatsTab.addClass('is-active-tab');
        if (this.activeTab === 'library') libTab.addClass('is-active-tab');

        chatsTab.onClickEvent(() => { this.activeTab = 'chats'; this.refreshView(); });
        libTab.onClickEvent(() => { this.activeTab = 'library'; this.refreshView(); });
        
        if (this.activeTab === 'chats') {
            await this.renderChatsTab(container);
        } else {
            await this.renderLibraryTab(container);
        }
    }

    async renderChatsTab(container: HTMLElement) {
        const header = container.createDiv({ cls: 'history-header' });
        header.createEl("h4", { text: "Research Sessions" });

        const buttonContainer = header.createDiv({ cls: 'history-buttons' });
        const newChatBtn = buttonContainer.createEl("button", { cls: 'dy-new-chat-btn' });
        setIcon(newChatBtn, 'plus');
        newChatBtn.onClickEvent(async () => {
            this.plugin.currentSessionId = `obsidian_${Date.now()}`;
            await this.plugin.engine.ensureSession(this.plugin.currentSessionId);
            this.plugin.openOrCreateChat();
            if (this.plugin.activeChatModal) {
                await this.plugin.activeChatModal.switchSession(this.plugin.currentSessionId);
            }
            await this.refreshView();
        });

        const searchContainer = container.createDiv({ cls: 'history-search-container' });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search sessions...",
            value: this.searchQuery,
            cls: "history-search-input"
        });

        searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this.searchQuery = searchInput.value.trim();
                list.empty();
                loadChats();
            }
        });

        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim() === "" && this.searchQuery !== "") {
                this.searchQuery = "";
                list.empty();
                loadChats();
            }
        });

        const list = container.createDiv({ cls: "history-list" });

        const loadChats = async () => {
            const loadingText = list.createEl("p", { text: "Loading sessions...", cls: "loading-text" });
            try {
                const response = await this.plugin.engine.getSessions();
                loadingText.remove();
                
                let sessions = response.sessions;
                if (this.searchQuery) {
                    sessions = sessions.filter(s => s.sessionId.toLowerCase().includes(this.searchQuery.toLowerCase()));
                }

                sessions.forEach((item) => {
                    const sessionEl = list.createDiv({ cls: "history-item" });
                    if (item.sessionId === this.plugin.currentSessionId) sessionEl.addClass('is-active');

                    const titleContainer = sessionEl.createDiv({ cls: "session-title-container" });
                    const nameEl = titleContainer.createEl("div", { text: item.sessionId, cls: "session-name" });
                    
                    const editBtn = titleContainer.createEl("button", { cls: "dy-edit-btn" });
                    setIcon(editBtn, 'pencil');

                    const deleteBtn = titleContainer.createEl("button", { cls: "dy-delete-btn" });
                    setIcon(deleteBtn, 'trash');
                    
                    const date = new Date(item.updatedAt!).toLocaleDateString();
                    sessionEl.createEl("small", { text: `Last activity: ${date}` });

                    sessionEl.onClickEvent((e) => {
                        if ((e.target as HTMLElement).tagName === 'INPUT') return;
                        this.plugin.currentSessionId = item.sessionId;
                        this.plugin.openOrCreateChat();
                        if (this.plugin.activeChatModal) {
                            this.plugin.activeChatModal.switchSession(item.sessionId);
                        }
                        this.refreshView();
                    });

                    editBtn.onClickEvent((e) => {
                        e.stopPropagation();
                        nameEl.empty();
                        const inputField = nameEl.createEl("input", { type: "text", value: item.sessionId, cls: "session-rename-input" });
                        editBtn.style.display = 'none';
                        inputField.focus();

                        inputField.addEventListener('keydown', async (keyEvent: KeyboardEvent) => {
                            if (keyEvent.key === 'Enter') {
                                const newId = inputField.value.trim();
                                if (!newId || newId === item.sessionId) {
                                    nameEl.setText(item.sessionId);
                                    editBtn.style.display = 'flex';
                                    return;
                                }
                                inputField.disabled = true;
                                try {
                                    await this.plugin.engine.renameSession(item.sessionId, newId);
                                    if (this.plugin.currentSessionId === item.sessionId) {
                                        this.plugin.currentSessionId = newId;
                                    }
                                    this.refreshView();
                                    new Notice("Session renamed successfully.");
                                } catch (err) {
                                    nameEl.setText(item.sessionId);
                                    editBtn.style.display = 'flex';
                                }
                            }
                        });
                    });

                    deleteBtn.onClickEvent(async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Are you sure you want to delete session "${item.sessionId}"?`)) return;
                        try {
                            await this.plugin.engine.sessionService.deleteSession({ appName: 'dyresearch', sessionId: item.sessionId });
                            if (this.plugin.currentSessionId === item.sessionId) this.plugin.currentSessionId = "";
                            this.refreshView();
                            new Notice("Session deleted.");
                        } catch (err) {
                            new Notice("Failed to delete session.");
                        }
                    });
                });
            } catch (err) {
                loadingText.setText("Failed to load history.");
            }
        };

        await loadChats();
    }

    async renderUploadSection(container: HTMLElement){
        const uploadContainer = container.createDiv({ cls: 'upload-section' });
        uploadContainer.createEl("h4", { text: "Upload File(s) to Library" });
        const metadataForm = uploadContainer.createDiv({ cls: 'metadata-form' });

        const subjectInput = metadataForm.createEl("input", { type: "text", placeholder: "Subject..." });
        const authorsInput = metadataForm.createEl("input", { type: "text", placeholder: "Authors..." });
        
        const fileInput = uploadContainer.createEl("input", {
            attr: { type: "file", multiple: "true", accept: ".pdf,.md,.docx,.txt" },
            cls: "hidden-file-input"
        });

        const uploadBtn = uploadContainer.createEl("button", { text: "📁 Select & Upload Docs", cls: "dy-upload-btn" });
        uploadBtn.onClickEvent(() => fileInput.click());
        
        fileInput.addEventListener("change", async () => {
            if (!fileInput.files || fileInput.files.length === 0) return;
            
            uploadBtn.setText("⏳ Processing...");
            uploadBtn.disabled = true;

            try {
                for (const file of Array.from(fileInput.files)) {
                    await this.plugin.engine.ingestFile(file, {
                        subject: subjectInput.value.trim(),
                        authors: authorsInput.value.trim()
                    });
                }
                new Notice(`Files ingested successfully!`);
                this.refreshView();
            } catch (err) {
                new Notice("Upload failed.");
            } finally {
                uploadBtn.setText("📁 Select & Upload Docs");
                uploadBtn.disabled = false;
                fileInput.value = "";
            }
        });
    }

    async renderLibraryTab(container: HTMLElement){
        await this.renderUploadSection(container);
        container.createEl("hr", { cls: "library-divider" });

        const libContainer = container.createDiv({ cls: 'library-container' });
        libContainer.createEl("h4", { text: "Files in Library" });
        const list = libContainer.createDiv({ cls: "library-list" });

        const loadDocs = async () => {
            const loadingNotice = list.createEl("p", { text: "Loading...", cls: "loading-text" });
            try {
                const files = await this.plugin.engine.getLibraryFiles();
                loadingNotice.remove();

                files.forEach((doc) => {
                    const card = list.createDiv({ cls: "library-card" });
                    const header = card.createDiv({ cls: "library-card-header" });
                    const titleInfo = header.createDiv({ cls: "library-title-group" });
                    titleInfo.createEl("strong", { text: doc.title });
                    titleInfo.createEl("span", { text: doc.type, cls: "badge-type" });

                    const libDeleteBtn = header.createEl("button", { cls: "dy-delete-btn-small" });
                    setIcon(libDeleteBtn, 'trash');

                    libDeleteBtn.onClickEvent(async () => {
                        if (!confirm(`Delete "${doc.title}"?`)) return;
                        await this.plugin.engine.deleteLibraryFile(doc.title);
                        this.refreshView();
                    });
                    
                    card.createEl("div", { text: `👤 ${doc.authors}`, cls: "library-meta" });
                    card.createEl("div", { text: `🏷️ ${doc.subject}`, cls: "library-meta" });
                });

                if (files.length === 0) {
                    list.createEl("p", { text: "No documents found in Vault.", cls: "text-muted" });
                }
            } catch (err) {
                loadingNotice.setText("❌ Error loading library.");
            }
        };

        await loadDocs();
    }
}