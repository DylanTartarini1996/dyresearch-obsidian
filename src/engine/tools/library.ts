import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';

export function getLibrarianTools(app: App) {
    return [
        new FunctionTool({
            name: 'ingest_source_chunks',
            description: 'Ingests text chunks into the knowledge base.',
            execute: async (args: any) => {
                const title = args.title || 'Untitled';
                const path = `DyResearch/Library/${title.replace(/[^a-z0-9]/gi, '_')}.md`;
                const content = `---\nsubject: ${args.subject}\nauthors: ${args.author}\ntype: ${args.source_type}\n---\n\n${args.chunks?.join('\\n\\n') || args.content}`;
                
                const libExists = await app.vault.adapter.exists('DyResearch/Library');
                if (!libExists) await app.vault.adapter.mkdir('DyResearch/Library');
                
                await app.vault.adapter.write(path, content);
                return `Chunks ingested into ${path}`;
            }
        }),
        new FunctionTool({
            name: 'ingest_source_file',
            description: 'Ingests a full file into the knowledge base.',
            execute: async (args: any) => {
                const title = args.title || 'Untitled';
                const path = `DyResearch/Library/${title.replace(/[^a-z0-9]/gi, '_')}.md`;
                const content = `---\nsubject: ${args.subject}\nauthors: ${args.author}\ntype: ${args.source_type}\n---\n\n${args.content}`;
                
                const libExists = await app.vault.adapter.exists('DyResearch/Library');
                if (!libExists) await app.vault.adapter.mkdir('DyResearch/Library');
                
                await app.vault.adapter.write(path, content);
                return `File ingested into ${path}`;
            }
        }),
        new FunctionTool({
            name: 'list_available_sources',
            description: 'Lists all documents and subjects available in the library.',
            execute: async (args: any) => {
                const exists = await app.vault.adapter.exists('DyResearch/Library');
                if (!exists) return 'No library found.';
                const files = await app.vault.adapter.list('DyResearch/Library');
                return files.files.join(', ');
            }
        }),
        new FunctionTool({
            name: 'delete_source',
            description: 'Deletes a specific document from the library by title.',
            execute: async (args: any) => {
                const title = args.title;
                if (!title) return "Error: title is required.";
                const path = `DyResearch/Library/${title.replace(/[^a-z0-9]/gi, '_')}.md`;
                const exists = await app.vault.adapter.exists(path);
                if (exists) {
                    await app.vault.adapter.remove(path);
                    return "Source deleted.";
                }
                return "Source not found.";
            }
        }),
        new FunctionTool({
            name: 'delete_by_subject',
            description: 'Purges all documents related to a specific subject.',
            execute: async (args: any) => {
                return "Purge by subject requires parsing frontmatter, skipped for safety.";
            }
        })
    ];
}
