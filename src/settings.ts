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

        new Setting(containerEl)
            .setName('OpenRouter API Key')
            .setDesc('Supports free & paid models on openrouter.ai (e.g. meta-llama/llama-3.3-70b-instruct:free)')
            .addText(text => text
                .setPlaceholder('sk-or-v1-...')
                .setValue(this.plugin.settings.apiKeys.openrouter || '')
                .onChange(async (val) => { 
                    this.plugin.settings.apiKeys.openrouter = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Groq API Key')
            .setDesc('Fast inference with free tier on console.groq.com (e.g. llama-3.3-70b-versatile)')
            .addText(text => text
                .setPlaceholder('gsk_...')
                .setValue(this.plugin.settings.apiKeys.groq || '')
                .onChange(async (val) => { 
                    this.plugin.settings.apiKeys.groq = val;
                    await this.plugin.saveSettings();
                }));

        // AGENT CONFIGURATIONS
        containerEl.createEl('h3', { text: 'Agent Configurations' });
        const agents: Array<keyof typeof this.plugin.settings.agents> = ['coordinator', 'professor', 'librarian', 'researcher', 'notetaker'];
        
        agents.forEach(agentName => {
            const agentCfg = this.plugin.settings.agents[agentName];
            const details = containerEl.createEl('details');
            details.createEl('summary', { text: `Settings for ${agentName.toUpperCase()}` });
            
            let modelInputRef: any = null;
            const defaultModelByProvider: Record<string, string> = {
                gemini: 'gemini-2.5-flash',
                openai: 'gpt-4o',
                anthropic: 'claude-sonnet-4-20250514',
                openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
                groq: 'llama-3.3-70b-versatile'
            };

            new Setting(details)
                .setName('Provider')
                .addDropdown(d => d
                    .addOptions({
                        'gemini': 'Google Gemini',
                        'openai': 'OpenAI',
                        'anthropic': 'Anthropic',
                        'openrouter': 'OpenRouter',
                        'groq': 'Groq'
                    })
                    .setValue(agentCfg.provider)
                    .onChange(async (v) => { 
                        const prevDefault = defaultModelByProvider[agentCfg.provider];
                        agentCfg.provider = v;
                        if (!agentCfg.model || agentCfg.model === prevDefault) {
                            agentCfg.model = defaultModelByProvider[v] || 'gemini-2.5-flash';
                            if (modelInputRef) {
                                modelInputRef.setValue(agentCfg.model);
                            }
                        }
                        await this.plugin.saveSettings();
                    }));

            new Setting(details)
                .setName('Model')
                .setDesc('e.g. gemini-2.5-flash, gpt-4o, claude-sonnet-4-20250514, llama-3.3-70b-versatile')
                .addText(t => {
                    modelInputRef = t;
                    t.setValue(agentCfg.model)
                        .onChange(async (v) => {
                            agentCfg.model = v;
                            await this.plugin.saveSettings();
                        });
                });
        });
    }
}
