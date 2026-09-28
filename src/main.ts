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

        this.addRibbonIcon('history', 'View History', () => {
            this.activateView();
        });
    }

    // Centralized controller to enforce a single chat instance
    public openOrCreateChat() {
        if (this.activeChatModal) {
            if (this.activeChatModal.isMinimized) this.activeChatModal.toggleMinimize();
            return;
        }
        this.activeChatModal = new ChatModal(this.app, this);
        this.activeChatModal.open();
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Re-initialize engine when settings change
        try {
            this.engine.initialize();
        } catch (e) {}
    }
}
