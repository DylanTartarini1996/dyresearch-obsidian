import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';

export function getTeachingTools(app: App) {
    return [
        new FunctionTool({
            name: 'search_obsidian_vault',
            description: 'Searches the local Obsidian vault for relevant notes and concepts.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    query: { type: 'STRING' as any, description: 'Search query or keyword to look for in the Vault.' }
                },
                required: ['query']
            },
            execute: async (args: any) => {
                const query = (args.query || "").toLowerCase();
                const files = app.vault.getMarkdownFiles();
                const matches = [];
                for (const file of files) {
                    if (file.path.startsWith('DyResearch/')) continue; // Skip internal library
                    const content = await app.vault.read(file);
                    if (content.toLowerCase().includes(query) || file.path.toLowerCase().includes(query)) {
                        matches.push({ path: file.path, snippet: content.substring(0, 150) + '...' });
                    }
                }
                return matches.length > 0 ? JSON.stringify(matches) : "No matches found in Vault.";
            }
        }),
        new FunctionTool({
            name: 'read_obsidian_note',
            description: 'Reads the exact text of a specific Obsidian note by path.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path: { type: 'STRING' as any, description: 'Exact path to the markdown note in the Vault.' }
                },
                required: ['path']
            },
            execute: async (args: any) => {
                const path = args.path;
                const exists = await app.vault.adapter.exists(path);
                if (!exists) return `Note not found at ${path}`;
                return await app.vault.adapter.read(path);
            }
        }),
        new FunctionTool({
            name: 'search_knowledge_base',
            description: 'Searches the external library/knowledge base for documents.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    query: { type: 'STRING' as any, description: 'Query to search in the library.' },
                    subject_filter: { type: 'STRING' as any, description: 'Optional subject category filter.' }
                },
                required: ['query']
            },
            execute: async (args: any) => {
                const query = (args.query || "").toLowerCase();
                const exists = await app.vault.adapter.exists('DyResearch/Library');
                if (!exists) return "Knowledge base is empty.";
                const files = await app.vault.adapter.list('DyResearch/Library');
                const matches = [];
                for (const path of files.files) {
                    if (!path.endsWith('.md')) continue;
                    const content = await app.vault.adapter.read(path);
                    if (content.toLowerCase().includes(query)) {
                        matches.push({ path, snippet: content.substring(0, 150) + '...' });
                    }
                }
                return matches.length > 0 ? JSON.stringify(matches) : "No matches found in Library.";
            }
        }),
        new FunctionTool({
            name: 'get_obsidian_relations',
            description: 'Finds related notes or backlinks to a specific concept in the Vault.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Title or concept to find relations for.' }
                }
            },
            execute: async (args: any) => {
                return "Backlink mapping requires DataView or Obsidian API internal link caches (not implemented in this mock).";
            }
        })
    ];
}
