export interface AgentModelConfig {
    provider: 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | string;
    model: string;
}

export interface ApiKeys {
    gemini: string;
    openai: string;
    anthropic: string;
    openrouter: string;
    groq: string;
}

export interface DyResearchSettings {
    chatWidth: string;
    chatHeight: string;
    chatDisplayMode: 'docked' | 'floating';
    apiKeys: ApiKeys;
    agents: {
        coordinator: AgentModelConfig;
        professor: AgentModelConfig;
        librarian: AgentModelConfig;
        researcher: AgentModelConfig;
        notetaker: AgentModelConfig;
    };
}

export const DEFAULT_SETTINGS: DyResearchSettings = {
    chatWidth: '650px',
    chatHeight: '80vh',
    chatDisplayMode: 'docked',
    apiKeys: {
        gemini: '',
        openai: '',
        anthropic: '',
        openrouter: '',
        groq: ''
    },
    agents: {
        coordinator: { provider: 'gemini', model: 'gemini-2.5-flash' },
        professor: { provider: 'gemini', model: 'gemini-2.5-flash' },
        librarian: { provider: 'gemini', model: 'gemini-2.5-flash' },
        researcher: { provider: 'gemini', model: 'gemini-2.5-flash' },
        notetaker: { provider: 'gemini', model: 'gemini-2.5-flash' }
    }
};
