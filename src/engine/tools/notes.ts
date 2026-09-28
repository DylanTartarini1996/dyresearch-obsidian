import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';

export function getNoteTakingTools(app: App) {
    return [
        new FunctionTool({
            name: 'create_obsidian_note',
            description: 'Creates a new note in the Obsidian Vault. Provide title and content.',
            execute: async (args: any) => {
                const title = args.title || 'Untitled Note';
                const content = args.content || '';
                const path = `${title.endsWith('.md') ? title : title + '.md'}`;
                const exists = await app.vault.adapter.exists(path);
                if (exists) return `Error: Note ${path} already exists. Use update_obsidian_note instead.`;
                await app.vault.create(path, content);
                return `Note ${path} created successfully.`;
            }
        }),
        new FunctionTool({
            name: 'update_obsidian_note',
            description: 'Updates an existing note in the Obsidian Vault. mode="append" or "overwrite".',
            execute: async (args: any) => {
                const path = args.path;
                const content = args.content;
                const mode = args.mode || 'append';
                
                if (!path || !content) return "Error: path and content are required.";
                
                const exists = await app.vault.adapter.exists(path);
                if (!exists) return `Error: Note ${path} does not exist. Use create_obsidian_note instead.`;
                
                if (mode === 'overwrite') {
                    await app.vault.adapter.write(path, content);
                } else {
                    const existingContent = await app.vault.adapter.read(path);
                    await app.vault.adapter.write(path, existingContent + '\n\n' + content);
                }
                return `Note ${path} updated successfully.`;
            }
        }),
        new FunctionTool({
            name: 'delete_obsidian_note',
            description: 'Deletes a note from the Obsidian Vault by path.',
            execute: async (args: any) => {
                const path = args.path;
                if (!path) return "Error: path is required.";
                const exists = await app.vault.adapter.exists(path);
                if (exists) {
                    await app.vault.adapter.remove(path);
                    return `Note ${path} deleted successfully.`;
                }
                return `Error: Note ${path} not found.`;
            }
        }),
        new FunctionTool({
            name: 'list_obsidian_notes',
            description: 'Lists all markdown notes available in the Obsidian Vault.',
            execute: async (args: any) => {
                const files = app.vault.getMarkdownFiles();
                return files.map(f => f.path).join(', ');
            }
        }),
        new FunctionTool({
            name: 'read_obsidian_note',
            description: 'Reads the exact text of a specific Obsidian note by path.',
            execute: async (args: any) => {
                const path = args.path;
                if (!path) return "Error: path is required.";
                const exists = await app.vault.adapter.exists(path);
                if (!exists) return `Error: Note ${path} not found.`;
                const content = await app.vault.adapter.read(path);
                return content;
            }
        })
    ];
}
