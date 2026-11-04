import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import type DyResearchPlugin from '../main';
import { renderChatInterface } from '../modals/chat-modal';
import { areAuthorsEquivalent, cleanSingleAuthorName } from '../engine/pdf-service';

export const VIEW_TYPE_HISTORY = "dyresearch-history-view";

export class HistoryView extends ItemView {
    private activeTab: 'chat' | 'chats' | 'library' = 'chat';
    private searchQuery = "";
    private libSearchQuery = "";
    private libKindFilter = "";
    private libTopicFilter = "";
    private libAuthorFilter = "";

    constructor(leaf: WorkspaceLeaf, private plugin: DyResearchPlugin) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_HISTORY; }
    getDisplayText() { return "DyResearch"; }
    getIcon() { return "bot"; }

    public getActiveTab() {
        return this.activeTab;
    }

    public setActiveTab(tab: 'chat' | 'chats' | 'library') {
        this.activeTab = tab;
        this.refreshView();
    }

    public updateActiveChatBadge(newSessionId: string) {
        const badgeText = this.containerEl.querySelector('.chat-session-id-text');
        if (badgeText) {
            badgeText.textContent = newSessionId;
        }
    }

    async onOpen() {
        if (this.plugin.activeChatModal) {
            this.activeTab = 'chats';
        }
        await this.refreshView();
    }

    async refreshView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('dy-history-container');

        const navContainer = container.createDiv({ cls: 'dy-nav-tabs' });

        const chatTab = navContainer.createEl('button', { text: '💬 Chat', cls: 'dy-tab-btn' });
        const chatsTab = navContainer.createEl('button', { text: '🕓 Sessions', cls: 'dy-tab-btn' });
        const libTab = navContainer.createEl('button', { text: '📚 Library', cls: 'dy-tab-btn' });

        if (this.activeTab === 'chat') chatTab.addClass('is-active-tab');
        if (this.activeTab === 'chats') chatsTab.addClass('is-active-tab');
        if (this.activeTab === 'library') libTab.addClass('is-active-tab');

        chatTab.onClickEvent(async () => {
            if (this.plugin.activeChatModal) {
                this.plugin.activeChatModal.close();
            }
            this.plugin.settings.chatDisplayMode = 'docked';
            await this.plugin.saveData(this.plugin.settings);
            this.activeTab = 'chat';
            await this.refreshView();
        });
        chatsTab.onClickEvent(() => { this.activeTab = 'chats'; this.refreshView(); });
        libTab.onClickEvent(() => { this.activeTab = 'library'; this.refreshView(); });

        if (this.activeTab === 'chat') {
            await this.renderActiveChatTab(container);
        } else if (this.activeTab === 'chats') {
            await this.renderChatsTab(container);
        } else {
            await this.renderLibraryTab(container);
        }
    }

    async renderActiveChatTab(container: HTMLElement) {
        const chatWrapper = container.createDiv({ cls: 'chat-main-body-wrapper dy-docked-chat-wrapper' });
        await renderChatInterface(chatWrapper, this.app, this.plugin, this.plugin.currentSessionId, {
            isDocked: true
        });
    }

    async renderChatsTab(container: HTMLElement) {
        const header = container.createDiv({ cls: 'history-header' });
        header.createEl("h4", { text: "Research Sessions" });

        const buttonContainer = header.createDiv({ cls: 'history-buttons' });
        const newChatBtn = buttonContainer.createEl("button", {
            cls: 'dy-new-chat-btn',
            attr: { 'aria-label': 'New chat session' }
        });
        setIcon(newChatBtn, 'plus');
        newChatBtn.onClickEvent(async () => {
            await this.plugin.startNewSession();
        });

        const searchContainer = container.createDiv({ cls: 'history-search-container' });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "🔍 Search sessions by name or message...",
            value: this.searchQuery,
            cls: "history-search-input"
        });

        const list = container.createDiv({ cls: "history-list" });
        let allSessions: any[] = [];

        const renderFilteredSessions = () => {
            list.empty();
            const query = this.searchQuery.trim().toLowerCase();

            const sessions = query
                ? allSessions.filter((s) => {
                    if (s.sessionId.toLowerCase().includes(query)) return true;
                    const eventText = (s.events || [])
                        .map((e: any) => {
                            const parts = e.content?.parts || e.newMessage?.parts || e.modelResponse?.parts || [];
                            return parts.map((p: any) => p.text || '').join(' ');
                        })
                        .join(' ')
                        .toLowerCase();
                    return eventText.includes(query);
                })
                : allSessions;

            if (sessions.length === 0) {
                list.createEl("p", { text: "No sessions found.", cls: "dy-empty-list-text" });
                return;
            }

            sessions.forEach((item) => {
                const sessionEl = list.createDiv({ cls: "history-item" });
                if (item.sessionId === this.plugin.currentSessionId) sessionEl.addClass('is-active');

                const titleContainer = sessionEl.createDiv({ cls: "session-title-container" });
                const nameEl = titleContainer.createEl("div", {
                    text: item.sessionId,
                    cls: "session-name",
                    attr: { title: "Click to open chat • Double-click or click ✏️ to rename" }
                });

                const actionsGroup = titleContainer.createDiv({ cls: "session-item-actions" });

                const openMdBtn = actionsGroup.createEl("button", {
                    cls: "dy-edit-btn",
                    attr: { 'aria-label': 'Open session Markdown note' }
                });
                setIcon(openMdBtn, 'file-text');

                const editBtn = actionsGroup.createEl("button", {
                    cls: "dy-edit-btn",
                    attr: { 'aria-label': 'Rename session' }
                });
                setIcon(editBtn, 'pencil');

                const deleteBtn = actionsGroup.createEl("button", {
                    cls: "dy-delete-btn",
                    attr: { 'aria-label': 'Delete session' }
                });
                setIcon(deleteBtn, 'trash');

                const msgCount = (item.events || []).filter((e: any) => {
                    const parts = e.content?.parts || e.newMessage?.parts || e.modelResponse?.parts || [];
                    return parts.some((p: any) => p?.text && !p?.thought);
                }).length;
                const date = new Date(item.updatedAt!).toLocaleDateString();
                sessionEl.createEl("small", {
                    text: `Last activity: ${date} • 💬 ${msgCount} msg${msgCount === 1 ? '' : 's'}`,
                    cls: "session-date"
                });

                sessionEl.onClickEvent(async (e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT') return;
                    this.plugin.currentSessionId = item.sessionId;
                    if (this.plugin.activeChatModal) {
                        await this.plugin.activeChatModal.switchSession(item.sessionId);
                        await this.refreshView();
                    } else {
                        this.activeTab = 'chat';
                        await this.refreshView();
                    }
                });

                openMdBtn.onClickEvent(async (e) => {
                    e.stopPropagation();
                    await this.app.workspace.openLinkText(`DyResearch/Sessions/${item.sessionId}.md`, '', false);
                });

                const beginSessionRename = (e: MouseEvent) => {
                    e.stopPropagation();
                    if (nameEl.querySelector('input')) return;
                    nameEl.empty();
                    const inputField = nameEl.createEl("input", {
                        type: "text",
                        value: item.sessionId,
                        cls: "session-rename-input"
                    });
                    editBtn.style.display = 'none';
                    inputField.focus();
                    inputField.select();

                    let committed = false;
                    const commitRename = async (save: boolean) => {
                        if (committed) return;
                        committed = true;
                        const newId = inputField.value.trim();
                        if (!save || !newId || newId === item.sessionId) {
                            nameEl.setText(item.sessionId);
                            editBtn.style.display = 'flex';
                            return;
                        }
                        inputField.disabled = true;
                        try {
                            const finalId = await this.plugin.renameSession(item.sessionId, newId);
                            new Notice(`Session renamed to "${finalId}".`);
                        } catch (err: any) {
                            nameEl.setText(item.sessionId);
                            editBtn.style.display = 'flex';
                            new Notice(err?.message || "Failed to rename session.");
                        }
                    };

                    inputField.addEventListener('keydown', async (keyEvent: KeyboardEvent) => {
                        if (keyEvent.key === 'Enter') {
                            keyEvent.preventDefault();
                            await commitRename(true);
                        } else if (keyEvent.key === 'Escape') {
                            keyEvent.preventDefault();
                            await commitRename(false);
                        }
                    });

                    inputField.addEventListener('blur', async () => {
                        await commitRename(true);
                    });
                };

                editBtn.onClickEvent(beginSessionRename);
                nameEl.addEventListener('dblclick', beginSessionRename);

                deleteBtn.onClickEvent(async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Are you sure you want to delete session "${item.sessionId}"?`)) return;
                    try {
                        await this.plugin.engine.sessionService.deleteSession({
                            appName: 'dyresearch',
                            sessionId: item.sessionId
                        });
                        if (this.plugin.currentSessionId === item.sessionId) {
                            this.plugin.currentSessionId = `obsidian_${Date.now()}`;
                        }
                        this.refreshView();
                        new Notice("Session deleted.");
                    } catch (err) {
                        new Notice("Failed to delete session.");
                    }
                });
            });
        };

        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            renderFilteredSessions();
        });

        const loadChats = async () => {
            const loadingText = list.createEl("p", { text: "Loading sessions...", cls: "loading-text" });
            try {
                const response = await this.plugin.engine.getSessions();
                loadingText.remove();
                allSessions = response.sessions;
                renderFilteredSessions();
            } catch (err) {
                loadingText.setText("Failed to load history.");
            }
        };

        await loadChats();
    }

    async renderUploadSection(container: HTMLElement) {
        const uploadContainer = container.createDiv({ cls: 'upload-section' });
        uploadContainer.createEl("h4", { text: "Upload & Auto-Index to Library" });
        const metadataForm = uploadContainer.createDiv({ cls: 'metadata-form' });

        const docKindSelect = metadataForm.createEl("select", { cls: "dy-doc-kind-select" });
        docKindSelect.createEl("option", { value: "Paper", text: "📄 Academic Paper" });
        docKindSelect.createEl("option", { value: "Book", text: "📘 Book / Textbook" });
        docKindSelect.createEl("option", { value: "Document", text: "📑 General Document" });

        const topicHintInput = metadataForm.createEl("input", {
            type: "text",
            placeholder: "Topic hint (auto if empty)..."
        });

        const fileInput = uploadContainer.createEl("input", {
            attr: { type: "file", multiple: "true", accept: ".pdf,.md,.docx,.txt" },
            cls: "hidden-file-input"
        });

        const uploadBtn = uploadContainer.createEl("button", {
            text: "📁 Select & Index File(s)",
            cls: "dy-upload-btn"
        });
        uploadBtn.onClickEvent(() => fileInput.click());

        const handleFiles = async (files: FileList | File[]) => {
            if (!files || files.length === 0 || uploadBtn.disabled) return;

            uploadBtn.setText("⏳ Processing...");
            uploadBtn.disabled = true;

            try {
                for (const file of Array.from(files)) {
                    await this.plugin.engine.ingestFile(
                        file,
                        {
                            docKind: docKindSelect.value as 'Paper' | 'Book' | 'Document',
                            topicHint: topicHintInput.value.trim()
                        },
                        (statusText) => {
                            uploadBtn.setText(statusText);
                        }
                    );
                }
                topicHintInput.value = "";
                this.refreshView();
            } catch (err) {
                new Notice("Upload failed.");
            } finally {
                uploadBtn.setText("📁 Select & Index File(s)");
                uploadBtn.disabled = false;
                fileInput.value = "";
            }
        };

        fileInput.addEventListener("change", () => handleFiles(fileInput.files!));

        uploadBtn.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadBtn.addClass("is-dragover");
        });
        uploadBtn.addEventListener("dragleave", () => uploadBtn.removeClass("is-dragover"));
        uploadBtn.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadBtn.removeClass("is-dragover");
            if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
        });
    }

    async renderLibraryTab(container: HTMLElement) {
        await this.renderUploadSection(container);

        const libContainer = container.createDiv({ cls: 'library-container' });
        const libHeader = libContainer.createDiv({ cls: 'history-header' });
        const headerTitle = libHeader.createEl("h4", { text: "Files in Library" });

        const clearFiltersBtn = libHeader.createEl("button", {
            text: "✕ Clear filters",
            cls: "dy-clear-filters-btn"
        });
        clearFiltersBtn.style.display = "none";

        // Filter & Search bar
        const filterBox = libContainer.createDiv({ cls: 'dy-library-filters' });
        const searchInput = filterBox.createEl("input", {
            type: "text",
            placeholder: "🔍 Search title, author, topic, or tag...",
            cls: "dy-lib-search-input"
        });
        searchInput.value = this.libSearchQuery;

        const filterSelectRow = filterBox.createDiv({ cls: 'dy-lib-filter-row' });

        const kindSelect = filterSelectRow.createEl("select", {
            cls: "dy-lib-filter-select",
            attr: { 'aria-label': 'Filter by document kind' }
        });
        kindSelect.createEl("option", { value: "", text: "All Types" });
        kindSelect.createEl("option", { value: "Paper", text: "📄 Paper" });
        kindSelect.createEl("option", { value: "Book", text: "📘 Book" });
        kindSelect.createEl("option", { value: "Document", text: "📑 Document" });
        kindSelect.value = this.libKindFilter;

        const topicSelect = filterSelectRow.createEl("select", {
            cls: "dy-lib-filter-select",
            attr: { 'aria-label': 'Filter by topic' }
        });
        topicSelect.createEl("option", { value: "", text: "All Topics" });

        const authorSelect = filterSelectRow.createEl("select", {
            cls: "dy-lib-filter-select",
            attr: { 'aria-label': 'Filter by author' }
        });
        authorSelect.createEl("option", { value: "", text: "All Authors" });

        const list = libContainer.createDiv({ cls: "library-list" });

        const loadDocs = async () => {
            const loadingNotice = list.createEl("p", { text: "Loading...", cls: "loading-text" });
            try {
                const allFiles = await this.plugin.engine.getLibraryFiles();
                loadingNotice.remove();

                // Populate unique topics and canonical authors
                const topicsSet = new Set<string>();
                const authorsList: string[] = [];

                for (const doc of allFiles) {
                    const topic = (doc.topicFolder && doc.topicFolder !== 'Uncategorized')
                        ? doc.topicFolder
                        : doc.subject;
                    if (topic) topicsSet.add(topic);

                    if (doc.authors && doc.authors !== 'Unknown') {
                        const splitAuthors = doc.authors
                            .split(',')
                            .map(a => cleanSingleAuthorName(a))
                            .filter(Boolean);
                        for (const a of splitAuthors) {
                            const existingIdx = authorsList.findIndex(ex => areAuthorsEquivalent(a, ex));
                            if (existingIdx !== -1) {
                                if (a.replace(/\./g, '').length > authorsList[existingIdx].replace(/\./g, '').length) {
                                    authorsList[existingIdx] = a;
                                }
                            } else {
                                authorsList.push(a);
                            }
                        }
                    }
                }

                Array.from(topicsSet)
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(t => {
                        topicSelect.createEl("option", { value: t, text: `📁 ${t}` });
                    });
                topicSelect.value = topicsSet.has(this.libTopicFilter) ? this.libTopicFilter : "";
                this.libTopicFilter = topicSelect.value;

                authorsList
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(a => {
                        authorSelect.createEl("option", { value: a, text: `👤 ${a}` });
                    });
                authorSelect.value = authorsList.includes(this.libAuthorFilter) ? this.libAuthorFilter : "";
                this.libAuthorFilter = authorSelect.value;

                const renderFilteredList = () => {
                    list.empty();

                    const query = this.libSearchQuery.trim().toLowerCase();
                    const kind = this.libKindFilter;
                    const topic = this.libTopicFilter.toLowerCase();
                    const author = this.libAuthorFilter;

                    const hasActiveFilter = Boolean(query || kind || topic || author);
                    clearFiltersBtn.style.display = hasActiveFilter ? "inline-flex" : "none";

                    const filtered = allFiles.filter(doc => {
                        if (kind && doc.docKind !== kind && doc.type.toLowerCase() !== kind.toLowerCase()) {
                            return false;
                        }
                        if (topic) {
                            const docTopic = (doc.topicFolder || '').toLowerCase();
                            const docSubj = (doc.subject || '').toLowerCase();
                            if (docTopic !== topic && docSubj !== topic && !docTopic.includes(topic)) {
                                return false;
                            }
                        }
                        if (author) {
                            const docAuthors = (doc.authors || '')
                                .split(',')
                                .map(a => cleanSingleAuthorName(a))
                                .filter(Boolean);
                            const matched =
                                doc.authors.toLowerCase().includes(author.toLowerCase()) ||
                                docAuthors.some(a => areAuthorsEquivalent(a, author));
                            if (!matched) return false;
                        }
                        if (query) {
                            const haystack = [
                                doc.title,
                                doc.authors,
                                doc.topicFolder,
                                doc.subject,
                                doc.docKind,
                                doc.type,
                                ...(doc.tags || [])
                            ].join(' ').toLowerCase();
                            const terms = query.split(/\s+/).filter(Boolean);
                            if (!terms.every(term => haystack.includes(term))) {
                                return false;
                            }
                        }
                        return true;
                    });

                    headerTitle.setText(
                        hasActiveFilter
                            ? `Files in Library (${filtered.length} / ${allFiles.length})`
                            : `Files in Library (${allFiles.length})`
                    );

                    filtered.forEach((doc) => {
                        const card = list.createDiv({ cls: "library-card" });
                        const header = card.createDiv({ cls: "library-card-header" });
                        const titleInfo = header.createDiv({ cls: "library-title-group" });
                        titleInfo.createEl("strong", { text: doc.title });
                        if (doc.docKind) {
                            const kindBadge = titleInfo.createEl("span", {
                                text: doc.docKind,
                                cls: "badge-kind is-clickable-filter",
                                attr: { title: `Filter by ${doc.docKind}` }
                            });
                            kindBadge.onClickEvent((e) => {
                                e.stopPropagation();
                                this.libKindFilter = this.libKindFilter === doc.docKind ? "" : doc.docKind;
                                kindSelect.value = this.libKindFilter;
                                renderFilteredList();
                            });
                        }
                        titleInfo.createEl("span", { text: doc.type, cls: "badge-type" });

                        const libDeleteBtn = header.createEl("button", {
                            cls: "dy-delete-btn-small",
                            attr: { 'aria-label': 'Delete document' }
                        });
                        setIcon(libDeleteBtn, 'trash');

                        libDeleteBtn.onClickEvent(async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete "${doc.title}" from Library and Library Index?`)) return;
                            await this.plugin.engine.deleteLibraryFile(doc.title);
                            this.refreshView();
                        });

                        const displayTopic = (doc.topicFolder && doc.topicFolder !== 'Uncategorized')
                            ? doc.topicFolder
                            : doc.subject;
                        const topicRow = card.createDiv({ cls: "library-meta" });
                        const topicChip = topicRow.createEl("span", {
                            text: `📁 ${displayTopic}`,
                            cls: "dy-meta-chip",
                            attr: { title: `Filter by topic: ${displayTopic}` }
                        });
                        topicChip.onClickEvent((e) => {
                            e.stopPropagation();
                            this.libTopicFilter = this.libTopicFilter === displayTopic ? "" : displayTopic;
                            topicSelect.value = this.libTopicFilter;
                            renderFilteredList();
                        });

                        const authorRow = card.createDiv({ cls: "library-meta" });
                        authorRow.createSpan({ text: "👤 " });
                        const docAuthorList = (doc.authors || 'Unknown')
                            .split(',')
                            .map(a => a.trim())
                            .filter(Boolean);

                        docAuthorList.forEach((authName, idx) => {
                            if (authName !== 'Unknown') {
                                const authChip = authorRow.createEl("span", {
                                    text: authName,
                                    cls: "dy-meta-chip",
                                    attr: { title: `Filter by author: ${authName}` }
                                });
                                authChip.onClickEvent((e) => {
                                    e.stopPropagation();
                                    const canonical = authorsList.find(ex => areAuthorsEquivalent(authName, ex)) || authName;
                                    this.libAuthorFilter = this.libAuthorFilter === canonical ? "" : canonical;
                                    authorSelect.value = this.libAuthorFilter;
                                    renderFilteredList();
                                });
                            } else {
                                authorRow.createSpan({ text: authName });
                            }
                            if (idx < docAuthorList.length - 1) {
                                authorRow.createSpan({ text: ", " });
                            }
                        });
                        authorRow.createSpan({ text: ` • 📄 ${doc.pages || 1} p.` });

                        card.style.cursor = "pointer";
                        card.onClickEvent(async () => {
                            const targetPath = doc.indexPath || doc.filePath;
                            if (targetPath) {
                                await this.app.workspace.openLinkText(targetPath, '', false);
                            }
                        });
                    });

                    if (filtered.length === 0) {
                        list.createEl("p", {
                            text: allFiles.length === 0
                                ? "No documents found in Library."
                                : "No documents match the current search or filters.",
                            cls: "dy-empty-list-text"
                        });
                    }
                };

                searchInput.addEventListener("input", () => {
                    this.libSearchQuery = searchInput.value;
                    renderFilteredList();
                });

                kindSelect.addEventListener("change", () => {
                    this.libKindFilter = kindSelect.value;
                    renderFilteredList();
                });

                topicSelect.addEventListener("change", () => {
                    this.libTopicFilter = topicSelect.value;
                    renderFilteredList();
                });

                authorSelect.addEventListener("change", () => {
                    this.libAuthorFilter = authorSelect.value;
                    renderFilteredList();
                });

                clearFiltersBtn.onClickEvent(() => {
                    this.libSearchQuery = "";
                    this.libKindFilter = "";
                    this.libTopicFilter = "";
                    this.libAuthorFilter = "";
                    searchInput.value = "";
                    kindSelect.value = "";
                    topicSelect.value = "";
                    authorSelect.value = "";
                    renderFilteredList();
                });

                renderFilteredList();
            } catch (err) {
                loadingNotice.setText("❌ Error loading library.");
            }
        };

        await loadDocs();
    }
}
