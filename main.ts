import { App, Plugin, Modal, MarkdownRenderer, ItemView, WorkspaceLeaf, setIcon, Notice, PluginSettingTab, Setting } from 'obsidian';

export const VIEW_TYPE_HISTORY = "dyresearch-history-view";

export interface LLMConf {
    model: string;
    temperature: number;
    type: string;
    api_key?: string;
    endpoint?: string;
}

export interface EmbedderConf {
    type: string;
    model?: string;
    api_key?: string;
}

export interface DBConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    url?: string;
}

export interface FullConfiguration {
    default_llm: LLMConf;
    agent_configs: Record<string, LLMConf>;
    embedder: EmbedderConf;
    db: DBConfig;
}


class DyResearchSettingTab extends PluginSettingTab {
    plugin: DyResearchPlugin;
    config: FullConfiguration | null = null;

    constructor(app: App, plugin: DyResearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'DyResearch Engine Settings' });

        // 1. Fetch current settings from FastAPI
        if (!this.config) {
            try {
                const response = await fetch('http://localhost:8000/settings');
                this.config = await response.json();
            } catch (e) {
                containerEl.createEl('p', { text: '❌ Could not connect to Python Engine.', cls: 'error-text' });
                return;
            }
        }

        const config = this.config!;

        // --- SECTION: DEFAULT LLM ---
        new Setting(containerEl)
            .setName('Default LLM Model')
            .setDesc('Fallback model for all agents')
            .addText(text => text
                .setValue(config.default_llm.model)
                .onChange(async (val) => { config.default_llm.model = val; }));

        new Setting(containerEl)
            .setName('Default API Key')
            .setDesc('API key for the default provider')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(config.default_llm.api_key || '')
                .onChange(async (val) => { config.default_llm.api_key = val; }));

        // --- SECTION: AGENT SPECIFIC ---
        containerEl.createEl('h3', { text: 'Agent Configurations' });
        const agents = ['coordinator', 'professor', 'librarian', 'notetaker', 'researcher'];
        
        agents.forEach(agentName => {
            const agentCfg = config.agent_configs[agentName];
            const details = containerEl.createEl('details');
            const summary = details.createEl('summary', { text: `Settings for ${agentName.toUpperCase()}` });
            
            new Setting(details)
                .setName('Model')
                .addText(t => t.setValue(agentCfg.model).onChange(v => agentCfg.model = v));
            
            new Setting(details)
                .setName('Type')
                .addDropdown(d => d
                    .addOptions({ 'openai': 'OpenAI', 'google': 'Google', 'groq': 'Groq', 'ollama': 'Ollama' })
                    .setValue(agentCfg.type)
                    .onChange(v => agentCfg.type = v));

            new Setting(details)
                .setName('API Key')
                .addText(t => t.setPlaceholder('Leave blank to use default').setValue(agentCfg.api_key || '').onChange(v => agentCfg.api_key = v));
        });

        // --- SECTION: EMBEDDER ---
        containerEl.createEl('h3', { text: 'Embedder Configuration' });

        new Setting(containerEl)
            .setName('Embedder Type')
            .setDesc('The provider used to generate vector embeddings')
            .addDropdown(d => d
                .addOptions({ 
                    'openai': 'OpenAI', 
                    'google': 'Google (Gemini)', 
                    'huggingface': 'HuggingFace (Local)',
                    'ollama': 'Ollama' 
                })
                .setValue(config.embedder.type)
                .onChange(v => config.embedder.type = v));

        new Setting(containerEl)
            .setName('Embedder Model')
            .setDesc('Specific model for embeddings (e.g., gemini-embedding-001)')
            .addText(t => t
                .setValue(config.embedder.model || '')
                .onChange(v => config.embedder.model = v));

        new Setting(containerEl)
            .setName('Embedder API Key')
            .setDesc('Leave blank to use Default API Key')
            .addText(t => t
                .setPlaceholder('sk-...')
                .setValue(config.embedder.api_key || '')
                .onChange(v => config.embedder.api_key = v));


        // --- SECTION: DATABASE ---
        containerEl.createEl('h3', { text: 'Database (Relational & Vector)' });
        
        new Setting(containerEl)
            .setName('DB Connection URL')
            .setDesc('SQLite path or Postgres connection string')
            .addText(text => text
                .setPlaceholder('sqlite:///./adk_history.db')
                .setValue(config.db.url || '')
                .onChange(async (val) => { config.db.url = val; }));

        // --- SAVE BUTTON ---
        const btnDiv = containerEl.createDiv({ cls: 'settings-save-container' });
        const saveBtn = btnDiv.createEl('button', { text: 'Save & Reload Engine', cls: 'mod-cta' });
        
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            saveBtn.setText('Saving...');
            
            try {
                const response = await fetch('http://localhost:8000/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.config)
                });
                
                if (response.ok) {
                    new Notice('Settings saved successfully!');
                    this.config = null; // Reset so next open fetches fresh
                    this.display(); 
                } else {
                    throw new Error();
                }
            } catch (e) {
                new Notice('Failed to save settings.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.setText('Save & Reload Engine');
            }
        };
    }
}

interface ChatResponse {
    message: string; 
}

export class HistoryView extends ItemView {
    // State to track which tab is active
    private activeTab: 'chats' | 'library' = 'chats';
    // Library state
    private libraryOffset = 0;
    private readonly libraryLimit = 20;
    // Chat state
    private chatOffset = 0;
    private readonly chatLimit = 10;

    // Search Properties
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

        // --- Tab Navigation ---
        const navContainer = container.createDiv({ cls: 'dy-nav-tabs' });
        
        const chatsTab = navContainer.createEl('button', { text: '💬 Chats', cls: 'dy-tab-btn' });
        const libTab = navContainer.createEl('button', { text: '📚 Library', cls: 'dy-tab-btn' });

        if (this.activeTab === 'chats') chatsTab.addClass('is-active-tab');
        if (this.activeTab === 'library') libTab.addClass('is-active-tab');

        chatsTab.onClickEvent(() => { this.activeTab = 'chats'; this.refreshView(); });
        libTab.onClickEvent(() => { this.activeTab = 'library'; this.refreshView(); });
        
        // --- Render Active Tab Content ---
        if (this.activeTab === 'chats') {
            await this.renderChatsTab(container);
        } else {
            await this.renderLibraryTab(container);
        }
    }


    async renderChatsTab(container: HTMLElement) {
        // --- Header with New Chat Button ---
        const header = container.createDiv({ cls: 'history-header' });
        header.createEl("h4", { text: "Research Sessions" });

        const buttonContainer = header.createDiv({ cls: 'history-buttons' });
        const newChatBtn = buttonContainer.createEl("button", { 
            cls: 'dy-new-chat-btn',
            attr: { "aria-label": "New Session" } 
        });
        setIcon(newChatBtn, 'plus');
        newChatBtn.onClickEvent(() => {
            this.plugin.currentSessionId = `obsidian_${Date.now()}`;
            new ChatModal(this.app, this.plugin).open();
            this.refreshView();
        });

        const closeBtn = buttonContainer.createEl("button", { 
            cls: 'dy-close-sidebar-btn',
            attr: { "aria-label": "Close Sidebar" } 
        });
        setIcon(closeBtn, 'x'); // Uses Obsidian's native 'x' icon
        closeBtn.onClickEvent(() => {
            this.app.workspace.rightSplit.collapse();
        });

        // --- NEW: Search Bar Interface ---
        const searchContainer = container.createDiv({ cls: 'history-search-container' });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search sessions...",
            value: this.searchQuery,
            cls: "history-search-input"
        });

        const fuzzySetting = searchContainer.createDiv({ cls: 'history-fuzzy-toggle' });
        const fuzzyCheckbox = fuzzySetting.createEl("input", {
            type: "checkbox",
            id: "fuzzy-search-checkbox"
        });
        fuzzyCheckbox.checked = this.isFuzzySearch;
        const fuzzyLabel = fuzzySetting.createEl("label", {
            text: "Fuzzy",
            attr: { for: "fuzzy-search-checkbox" }
        });

        // Execute search on pressing Enter
        searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this.searchQuery = searchInput.value.trim();
                this.isFuzzySearch = fuzzyCheckbox.checked;
                this.chatOffset = 0; // Reset offset for clean lists
                list.empty();
                loadChats();
            }
        });

        // Auto-clear search view if the user manually empties the input field
        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim() === "" && this.searchQuery !== "") {
                this.searchQuery = "";
                this.chatOffset = 0;
                list.empty();
                loadChats();
            }
        });

        // Session List Container
        const list = container.createDiv({ cls: "history-list" });
        const footer = container.createDiv({ cls: "history-footer" });
        // Offset is intentionally managed dynamically by user actions
        //this.chatOffset = 0; // Reset offset for fresh tab load

        // Loading Logic for chats
        const loadChats = async () => {
            const loadingText = list.createEl("p", { text: "Loading sessions...", cls: "loading-text" });

            try {
                // Determine target route based on the search query state
                let url = "";
                if (this.searchQuery) {
                    url = `http://localhost:8000/sessions/search?user_id=${this.plugin.userId}&q=${encodeURIComponent(this.searchQuery)}&fuzzy=${this.isFuzzySearch}`;
                } else {
                    url = `http://localhost:8000/history/${this.plugin.userId}?limit=${this.chatLimit}&offset=${this.chatOffset}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                
                loadingText.remove();

                data.sessions.forEach((item: any) => {
                    const sessionEl = list.createDiv({ cls: "history-item" });
                    if (item.session_id === this.plugin.currentSessionId) sessionEl.addClass('is-active');

                    // Container for the name and the edit button
                    const titleContainer = sessionEl.createDiv({ cls: "session-title-container" });
                    const nameEl = titleContainer.createEl("div", { text: item.session_id, cls: "session-name" });
                    
                    const editBtn = titleContainer.createEl("button", { cls: "dy-edit-btn", attr: { "aria-label": "Rename Session" } });
                    setIcon(editBtn, 'pencil');

                    const deleteBtn = titleContainer.createEl("button", { cls: "dy-delete-btn", attr: { "aria-label": "Delete Session" } });
                    setIcon(deleteBtn, 'trash');

                    const date = new Date(item.last_updated).toLocaleDateString();
                    //sessionEl.createEl("div", { text: item.session_id, cls: "session-name" });
                    sessionEl.createEl("small", { text: `Last activity: ${date}` });
                    // Open chat on click (make sure we don't trigger this when clicking the edit button)
                    sessionEl.onClickEvent((e) => {
                        // Prevent opening if the user is currently typing in the input box
                        if ((e.target as HTMLElement).tagName === 'INPUT') return;
                        this.plugin.currentSessionId = item.session_id;
                        new ChatModal(this.app, this.plugin).open();
                        this.refreshView();
                    });

                    // Handle the Edit Button Click
                    editBtn.onClickEvent((e) => {
                        e.stopPropagation(); // Stop the sessionEl click event from firing
                        // Turn text into an input field
                        nameEl.empty();
                        const inputField = nameEl.createEl("input", { 
                            type: "text", 
                            value: item.session_id,
                            cls: "session-rename-input"
                        });
                        editBtn.style.display = 'none'; // Hide pencil while editing
                        inputField.focus();

                        // 4. Save on Enter
                        inputField.addEventListener('keydown', async (keyEvent: KeyboardEvent) => {
                            if (keyEvent.key === 'Enter') {
                                const newId = inputField.value.trim();
                                
                                // If unchanged or empty, revert UI
                                if (!newId || newId === item.session_id) {
                                    nameEl.setText(item.session_id);
                                    editBtn.style.display = 'flex';
                                    return;
                                }

                                inputField.disabled = true; // prevent double submission

                                try {
                                    const response = await fetch(`http://localhost:8000/sessions/${item.session_id}/rename`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ 
                                            new_session_id: newId,
                                            user_id: this.plugin.userId 
                                        })
                                    });

                                    if (!response.ok) throw new Error("Rename failed");

                                    // If they renamed the currently active chat, update the plugin state
                                    if (this.plugin.currentSessionId === item.session_id) {
                                        this.plugin.currentSessionId = newId;
                                    }

                                    // Reload the UI to reflect changes
                                    this.refreshView();
                                    new Notice("Session renamed successfully.");

                                } catch (err) {
                                    new Notice("Failed to rename session.");
                                    nameEl.setText(item.session_id); // Revert on failure
                                    editBtn.style.display = 'flex';
                                }
                            }
                            // Optional: Revert on Escape key
                            if (keyEvent.key === 'Escape') {
                                nameEl.setText(item.session_id);
                                editBtn.style.display = 'flex';
                            }
                        });
                    });

                    deleteBtn.onClickEvent(async (e) => {
                        e.stopPropagation();
                        
                        const confirmDelete = confirm(`Are you sure you want to delete the session "${item.session_id}"? This cannot be undone.`);
                        if (!confirmDelete) return;

                        try {
                            const response = await fetch(`http://localhost:8000/sessions/${item.session_id}?user_id=${this.plugin.userId}`, {
                                method: 'DELETE'
                            });

                            if (response.ok) {
                                if (this.plugin.currentSessionId === item.session_id) this.plugin.currentSessionId = "";
                                this.refreshView();
                                new Notice("Session deleted.");
                            }
                        } catch (err) {
                            new Notice("Failed to delete session.");
                        }
                    });
                });
                
                // --- Footer Navigation Configurations ---
                footer.empty();
                if (this.searchQuery) {
                    this.chatOffset = data.sessions.length; // Lock out further pagination steps during filters
                    if (data.sessions.length === 0) {
                        list.createEl("p", { text: "No matching sessions found.", cls: "text-muted" });
                    } else {
                        footer.createEl("p", { text: `Found ${data.sessions.length} matches`, cls: "text-muted" });
                    }
                } else {
                    this.chatOffset += data.sessions.length;
                    if (this.chatOffset < data.total) {
                        const loadMoreBtn = footer.createEl("button", { 
                            text: "Load Older Chats", 
                            cls: "dy-load-more-btn" 
                        });
                        loadMoreBtn.onClickEvent(() => loadChats());
                    } else if (data.total > 0) {
                        footer.createEl("p", { text: "End of history", cls: "text-muted" });
                    }
                }

            } catch (err) {
                loadingText.setText("Failed to load history.");
            }
        };

        await loadChats();
    }

    async renderUploadSection(container: HTMLElement){
        // -------- UPLOAD CONTAINER ---------
        const uploadContainer = container.createDiv({ cls: 'upload-section' });
        uploadContainer.createEl("h4", { text: "Upload File(s) to Library" });
        const metadataForm = uploadContainer.createDiv({ cls: 'metadata-form' });

        const subjectInput = metadataForm.createEl("input", { 
            type: "text", 
            placeholder: "Subject (e.g. Quantum Computing)..." 
        });
        const authorsInput = metadataForm.createEl("input", { 
            type: "text", 
            placeholder: "Authors (e.g. John Doe)..." 
        });
        const typeSelect = metadataForm.createEl("select");
        typeSelect.add(new Option("Research Paper", "paper"));
        typeSelect.add(new Option("Book / Chapter", "book"));
        typeSelect.add(new Option("Manual", "manual"));
        
        // --- Create File Input & Button ---
        const fileInput = uploadContainer.createEl("input", {
            attr: { type: "file", multiple: "true", accept: ".pdf,.md,.docx,.txt" },
            cls: "hidden-file-input"
        });

        const uploadBtn = uploadContainer.createEl("button", { 
            text: "📁 Select & Upload Docs",
            cls: "dy-upload-btn" 
        });

        uploadBtn.onClickEvent(() => fileInput.click());
        
        // ---  Handle the Upload ---
        fileInput.addEventListener("change", async () => {
            if (!fileInput.files || fileInput.files.length === 0) return;
            
            const formData = new FormData();
            
            // Append the files
            for (let i = 0; i < fileInput.files.length; i++) {
                formData.append("files", fileInput.files[i]);
            }

            // Append the metadata fields
            // We use fallback values in case the user leaves them blank
            formData.append("subject", subjectInput.value.trim() || "General");
            formData.append("authors", authorsInput.value.trim() || "Unknown");
            formData.append("source_type", typeSelect.value);
            
            // Pass any extra data as a JSON string
            formData.append("metadata_json", JSON.stringify({ 
                uploaded_via: "obsidian_ui",
                batch_id: Date.now() 
            }));

            // Update UI State
            uploadBtn.setText("⏳ Ingesting...");
            uploadBtn.disabled = true;

            try {
                const response = await fetch("http://localhost:8000/ingest", {
                    method: "POST",
                    body: formData // The browser automatically sets the correct multipart headers
                });
                
                if (!response.ok) throw new Error("Server rejected the upload");
                
                const result = await response.json();
                const successCount = result.results.filter((r: any) => r.status === "success").length;
                
                new Notice(`Successfully ingested ${successCount} files!`);
                
                // Optional: Clear the form inputs after successful upload
                subjectInput.value = "";
                authorsInput.value = "";
                
            } catch (err) {
                console.error(err);
                new Notice("Failed to upload documents. Check console for details.");
            } finally {
                uploadBtn.setText("📁 Select & Upload Docs");
                uploadBtn.disabled = false;
                fileInput.value = "";
            }
        });
    }

    async renderLibraryTab(container: HTMLElement){
        // Render the Upload form at the top
        await this.renderUploadSection(container);

        // Add a separator
        container.createEl("hr", { cls: "library-divider" });

        const libContainer = container.createDiv({ cls: 'library-container' });
        libContainer.createEl("h4", { text: "Files in Library" });

        const list = libContainer.createDiv({ cls: "library-list" });
        const footer = libContainer.createDiv({ cls: "library-footer" });

        // Reset offset when opening the tab fresh
        this.libraryOffset = 0;

        const loadDocs = async () => {
            const loadingNotice = list.createEl("p", { text: "Loading...", cls: "loading-text" });
            
            try {
                const url = `http://localhost:8000/library?limit=${this.libraryLimit}&offset=${this.libraryOffset}`;
                const response = await fetch(url);
                const data = await response.json();
                
                loadingNotice.remove();

                // Render each document card
                data.documents.forEach((doc: any) => {
                    const card = list.createDiv({ cls: "library-card" });
                    const header = card.createDiv({ cls: "library-card-header" });

                    const titleInfo = header.createDiv({ cls: "library-title-group" });
                    titleInfo.createEl("strong", { text: doc.title });
                    titleInfo.createEl("span", { text: doc.type, cls: "badge-type" });

                    const libDeleteBtn = header.createEl("button", { cls: "dy-delete-btn-small" });
                    setIcon(libDeleteBtn, 'trash');

                    libDeleteBtn.onClickEvent(async () => {
                        if (!confirm(`Delete "${doc.title}" from Knowledge Base?`)) return;

                        try {
                            const response = await fetch(`http://localhost:8000/library/${encodeURIComponent(doc.title)}`, {
                                method: 'DELETE'
                            });
                            if (response.ok) {
                                this.refreshView();
                                new Notice("Document removed.");
                            }
                        } catch (err) {
                            new Notice("Failed to remove document.");
                        }
                    });
                    
                    card.createEl("div", { text: `👤 ${doc.authors}`, cls: "library-meta" });
                    card.createEl("div", { text: `🏷️ ${doc.subject}`, cls: "library-meta" });
                    card.createEl("div", { text: `🧩 ${doc.chunks} chunks indexed`, cls: "library-meta chunks-info" });
                });

                // Update state for the next batch
                this.libraryOffset += data.documents.length;

                // 3. Handle the "Load More" Button Visibility
                footer.empty(); // Clear old button
                if (this.libraryOffset < data.total) {
                    const loadMoreBtn = footer.createEl("button", { 
                        text: "Load More", 
                        cls: "dy-load-more-btn" 
                    });
                    loadMoreBtn.onClickEvent(() => loadDocs());
                } else if (data.total > 0) {
                    footer.createEl("p", { text: "All documents loaded.", cls: "text-muted" });
                } else {
                    list.createEl("p", { text: "No documents found.", cls: "text-muted" });
                }

            } catch (err) {
                loadingNotice.setText("❌ Error loading library.");
            }
        };

        // Initial load
        await loadDocs();
    }
}

export default class DyResearchPlugin extends Plugin {
    public currentSessionId: string = `obsidian_${Date.now()}`;
    public userId: string = 'dyresearch_plugin_user';

    async onload() {

        this.addSettingTab(new DyResearchSettingTab(this.app, this));

        this.registerView(VIEW_TYPE_HISTORY, (leaf) => new HistoryView(leaf, this));

        this.addRibbonIcon('bot', 'DyResearch Chat', () => {
            new ChatModal(this.app, this).open();
        });

        this.addRibbonIcon('history', 'View History', () => {
            this.activateView();
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_HISTORY, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}

export class ChatModal extends Modal {
    plugin: DyResearchPlugin;

    constructor(app: App, plugin: DyResearchPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('dy-chat-modal');
        
        contentEl.createEl('h2', { text: '🤖 DyResearch Assistant' });
        contentEl.createEl('p', { 
            text: `Session: ${this.plugin.currentSessionId}`, 
            cls: 'chat-session-id' 
        });

        const chatHistory = contentEl.createDiv({ cls: 'chat-history' });
        
        //  Load History
        try {
            const historyResponse = await fetch(`http://localhost:8000/sessions/${this.plugin.currentSessionId}/messages`);
            const messages = await historyResponse.json();
            
            for (const msg of messages) {
                const senderLabel = msg.role === 'user' ? '👤 You' : '🤖 AI';
                const msgDiv = this.appendSimpleMessage(chatHistory, senderLabel, '');
                await MarkdownRenderer.render(this.app, msg.content, msgDiv, '', this.plugin);
            }
            chatHistory.scrollTop = chatHistory.scrollHeight;
        } catch (err) {
            console.error("Could not load session history", err);
        }
        
        // Input Setup
        const inputContainer = contentEl.createDiv({ cls: 'chat-input-container' });
        const inputField = inputContainer.createEl('input', { 
            type: 'text', 
            placeholder: 'Type your message...' 
        });
        inputField.focus();

        inputField.addEventListener('keydown', async (e: KeyboardEvent) => {
            if (e.key === 'Enter' && inputField.value.trim() !== '') {
                const userQuery = inputField.value;
                inputField.value = '';

                // Add User Message
                this.appendSimpleMessage(chatHistory, '👤 You', userQuery);
                
                // Set up AI Streaming Area
                const ai = this.appendStreamingMessage(chatHistory, '🤖 AI');
                
                let fullAnswer = "";
                chatHistory.scrollTop = chatHistory.scrollHeight;

                try {
                    const response = await fetch('http://localhost:8000/chat/stream', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: userQuery,
                            session_id: this.plugin.currentSessionId,
                            user_id: this.plugin.userId
                        })
                    });

                    if (!response.body) throw new Error('No response body');

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n\n');

                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            
                            try {
                                const data = JSON.parse(line.replace('data: ', ''));

                                if (data.type === 'system') {
                                    ai.statusEl.setText(data.content);
                                } else if (data.type === 'thinking') {
                                    ai.thinkingEl.style.display = 'block';
                                    ai.thinkingEl.innerText += data.content;
                                } else if (data.type === 'answer') {
                                    fullAnswer += data.content;
                                    ai.answerEl.empty();
                                    await MarkdownRenderer.render(this.app, fullAnswer, ai.answerEl, '', this.plugin);
                                } else if (data.error) {
                                    new Notice("AI Error: " + data.error);
                                }
                            } catch (parseErr) {
                                console.error("Error parsing stream chunk", parseErr);
                            }
                        }
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }
                    
                    ai.statusEl.setText(""); // Clear status "Using tool..." when finished

                } catch (err) {
                    ai.answerEl.setText('❌ Error: Could not reach Python sidecar.');
                    console.error(err);
                }
            }
        });
    }

    // Creates a structured message area for streaming AI responses
    appendStreamingMessage(container: HTMLElement, sender: string) {
        const msgWrapper = container.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        
        const statusEl = msgWrapper.createDiv({ cls: 'chat-status-indicator' });
        const thinkingEl = msgWrapper.createDiv({ cls: 'chat-thinking-block' });
        const answerEl = msgWrapper.createDiv({ cls: 'chat-msg-content' });
        
        thinkingEl.style.display = 'none'; // Hidden until 'thinking' tokens arrive

        return { statusEl, thinkingEl, answerEl };
    }

    // Creates a simple message area for users or history loading
    appendSimpleMessage(container: HTMLElement, sender: string, text: string): HTMLElement {
        const msgWrapper = container.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        return msgWrapper.createDiv({ cls: 'chat-msg-content', text: text });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}