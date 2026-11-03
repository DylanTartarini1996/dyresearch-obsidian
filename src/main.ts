import { App, Plugin, WorkspaceLeaf } from 'obsidian';
import { DyResearchSettingTab } from './settings';
import { HistoryView, VIEW_TYPE_HISTORY } from './views/history-view';
import { ChatModal } from './modals/chat-modal';
import { DyResearchSettings, DEFAULT_SETTINGS } from './types';
import { DyResearchEngine } from './engine/engine';

export default class DyResearchPlugin extends Plugin {
    public currentSessionId: string = `obsidian_${Date.now()}`;
    public userId: string = 'dyresearch_plugin_user';
    public settings: DyResearchSettings;
    // TRACK THE SINGLE ACTIVE MODAL INSTANCE
    public activeChatModal: ChatModal | null = null;
    public engine: DyResearchEngine;

    async onload() {
        await this.loadSettings();
        
        // Initialize the local ADK Engine
        this.engine = new DyResearchEngine(this.app, this);
        try {
            this.engine.initialize();
        } catch (e) {
            console.error("Failed to initialize DyResearchEngine (Check API keys)", e);
        }

        this.addSettingTab(new DyResearchSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_HISTORY, (leaf) => new HistoryView(leaf, this));
        
        this.addRibbonIcon('bot', 'DyResearch Chat', () => {
           this.openOrCreateChat();
        });

        this.addRibbonIcon('history', 'DyResearch Panel', () => {
            this.activateView('chats');
        });
    }

    // Switch between docked right-sidebar panel and floating modal window
    public async setChatMode(mode: 'docked' | 'floating') {
        this.settings.chatDisplayMode = mode;
        await this.saveData(this.settings);

        if (mode === 'docked') {
            if (this.activeChatModal) {
                this.activeChatModal.close();
            }
            await this.activateView('chat');
        } else {
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
            if (leaf && leaf.view instanceof HistoryView) {
                if (leaf.view.getActiveTab() === 'chat') {
                    leaf.view.setActiveTab('chats');
                }
            }
            await this.openOrCreateChat('floating');
        }
    }

    public async startNewSession() {
        this.currentSessionId = `obsidian_${Date.now()}`;
        await this.engine.ensureSession(this.currentSessionId);
        if (this.activeChatModal) {
            await this.activeChatModal.switchSession(this.currentSessionId);
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
            if (leaf && leaf.view instanceof HistoryView) {
                await leaf.view.refreshView();
            }
        } else {
            await this.activateView('chat');
        }
    }

    public async renameSession(oldSessionId: string, newSessionId: string): Promise<string> {
        const finalId = await this.engine.renameSession(oldSessionId, newSessionId);
        if (this.currentSessionId === oldSessionId) {
            this.currentSessionId = finalId;
        }
        if (this.activeChatModal) {
            this.activeChatModal.updateSessionBadge(finalId);
        }
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
        if (leaf && leaf.view instanceof HistoryView) {
            if (leaf.view.getActiveTab() === 'chats') {
                await leaf.view.refreshView();
            } else {
                leaf.view.updateActiveChatBadge(finalId);
            }
        }
        return finalId;
    }

    // Centralized controller to enforce a single chat instance
    public async openOrCreateChat(forceMode?: 'docked' | 'floating') {
        const mode = forceMode || this.settings.chatDisplayMode || 'docked';
        if (mode === 'docked') {
            if (this.activeChatModal) {
                this.activeChatModal.close();
            }
            await this.activateView('chat');
            return;
        }

        if (this.activeChatModal) {
            if (this.activeChatModal.isMinimized) this.activeChatModal.toggleMinimize();
            await this.activeChatModal.switchSession(this.currentSessionId);
            return;
        }
        this.activeChatModal = new ChatModal(this.app, this);
        this.activeChatModal.open();
    }

    async activateView(tab?: 'chat' | 'chats' | 'library') {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_HISTORY, active: true });
        }
        workspace.revealLeaf(leaf);
        if (tab && leaf.view instanceof HistoryView) {
            leaf.view.setActiveTab(tab);
        }
    }

    async loadSettings() {
        const loaded = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
        this.settings.apiKeys = Object.assign({}, DEFAULT_SETTINGS.apiKeys, loaded?.apiKeys);
        this.settings.agents = Object.assign({}, DEFAULT_SETTINGS.agents, loaded?.agents);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Re-initialize engine when settings change
        try {
            this.engine.initialize();
        } catch (e) {}
    }
}
