import { App, PluginSettingTab, Setting } from 'obsidian';
import type DyResearchPlugin from './main';

export class DyResearchSettingTab extends PluginSettingTab {
    plugin: DyResearchPlugin;

    constructor(app: App, plugin: DyResearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'DyResearch Local Engine Settings' });

        new Setting(containerEl)
            .setName('Chat Display Mode')
            .setDesc('Choose whether the chat opens docked in the right sidebar or as a floating window.')
            .addDropdown(d => d
                .addOptions({
                    'docked': 'Docked in Right Sidebar',
                    'floating': 'Floating Window'
                })
                .setValue(this.plugin.settings.chatDisplayMode || 'docked')
                .onChange(async (val: 'docked' | 'floating') => {
                    await this.plugin.setChatMode(val);
                }));

        // API KEYS
        containerEl.createEl('h3', { text: 'API Keys' });
        
        new Setting(containerEl)
            .setName('Gemini API Key')
            .addText(text => text
                .setPlaceholder('AIzaSy...')
                .setValue(this.plugin.settings.apiKeys.gemini)
                .onChange(async (val) => { 
                    this.plugin.settings.apiKeys.gemini = val;
                    await this.plugin.saveSettings();
                }));
                
        new Setting(containerEl)
            .setName('OpenAI API Key')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.apiKeys.openai)
                .onChange(async (val) => { 
                    this.plugin.settings.apiKeys.openai = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Anthropic API Key')
            .addText(text => text
                .setPlaceholder('sk-ant-...')
                .setValue(this.plugin.settings.apiKeys.anthropic)
                .onChange(async (val) => { 
                    this.plugin.settings.apiKeys.anthropic = val;
                    await this.plugin.saveSettings();
                }));

        // AGENT CONFIGURATIONS
        containerEl.createEl('h3', { text: 'Agent Configurations' });
        const agents: Array<keyof typeof this.plugin.settings.agents> = ['coordinator', 'professor', 'librarian', 'researcher', 'notetaker'];
        
        agents.forEach(agentName => {
            const agentCfg = this.plugin.settings.agents[agentName];
            const details = containerEl.createEl('details');
            details.createEl('summary', { text: `Settings for ${agentName.toUpperCase()}` });
            
            new Setting(details)
                .setName('Provider')
                .addDropdown(d => d
                    .addOptions({ 'gemini': 'Google Gemini', 'openai': 'OpenAI', 'anthropic': 'Anthropic' })
                    .setValue(agentCfg.provider)
                    .onChange(async (v) => { 
                        agentCfg.provider = v;
                        await this.plugin.saveSettings();
                    }));

            new Setting(details)
                .setName('Model')
                .addText(t => t
                    .setValue(agentCfg.model)
                    .onChange(async (v) => {
                        agentCfg.model = v;
                        await this.plugin.saveSettings();
                    }));
        });
    }
}
