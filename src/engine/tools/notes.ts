import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';
import { ensureVaultFolder, sanitizeTag } from '../pdf-service';

/**
 * Sanitizes Mermaid code blocks inside Markdown so Obsidian's native Mermaid renderer
 * does not fail on common LLM syntax errors (e.g. unquoted parentheses/brackets/colons
 * inside flowchart node labels, raw $...$ LaTeX delimiters inside node labels, or
 * invalid characters in mindmap nodes).
 */
export function sanitizeMermaidBlocks(markdown: string): string {
    return markdown.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_fullMatch, rawBody: string) => {
        const lines = rawBody.replace(/\r\n/g, '\n').split('\n');
        const firstNonEmpty = lines.find(l => l.trim().length > 0 && !l.trim().startsWith('%%'))?.trim() || '';
        const isMindmap = /^mindmap\b/i.test(firstNonEmpty);
        const isFlowchart = /^(?:flowchart|graph)\b/i.test(firstNonEmpty);

        const cleanedLines = lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('%%')) return line;

            if (isMindmap) {
                if (/^mindmap\b/i.test(trimmed)) return line;
                // Preserve leading indentation (crucial for mindmap hierarchy)
                const indentMatch = line.match(/^(\s*)/);
                const indent = indentMatch ? indentMatch[1] : '  ';

                // Check if root node with double parens/brackets: e.g. root((Topic)) or root(("Topic"))
                const shapedMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(\(\(|\[\[|\(\)|\{\{|\(|\)|\[)\s*"?([^"\n]+?)"?\s*(\)\)|\]\]|\(\)|\}\}|\)|\])\s*$/);
                if (shapedMatch) {
                    const id = shapedMatch[1];
                    const open = shapedMatch[2];
                    const inner = shapedMatch[3].replace(/\$/g, '').replace(/"/g, "'").trim();
                    const close = shapedMatch[4];
                    return `${indent}${id}${open}"${inner}"${close}`;
                }

                // Plain mindmap node line: remove colons, brackets, and raw $ that break Mermaid mindmap parser
                const cleanNode = trimmed
                    .replace(/\$/g, '')
                    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p1, p2) => p2 || p1)
                    .replace(/[:;[\]{}()"]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                return `${indent}${cleanNode}`;
            }

            if (isFlowchart) {
                if (/^(?:flowchart|graph|subgraph|end|direction|style|classDef|class|click|linkStyle)\b/i.test(trimmed)) {
                    // Quote subgraph titles if they contain parentheses or colons
                    const subMatch = line.match(/^(\s*subgraph\s+)([A-Za-z0-9_]+)\s*\[\s*(?!")([^\]]+)\]\s*$/);
                    if (subMatch) {
                        const safeTitle = subMatch[3].replace(/\$/g, '').replace(/"/g, "'").trim();
                        return `${subMatch[1]}${subMatch[2]}["${safeTitle}"]`;
                    }
                    return line;
                }

                // Strip [[Wikilinks]] and raw $ math delimiters inside flowchart lines
                let updated = line
                    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p1, p2) => p2 || p1)
                    .replace(/\$([^$]+)\$/g, '$1');

                // Auto-quote unquoted rectangular node labels: id[Label with (parens) or : colons] -> id["Label with (parens) or : colons"]
                updated = updated.replace(
                    /\b([A-Za-z0-9_]+)\[\s*(?![/"\\[])([^\]\n]+?)\s*\]/g,
                    (_m, id: string, label: string) => {
                        const safeLabel = label.replace(/"/g, "'").trim();
                        return `${id}["${safeLabel}"]`;
                    }
                );

                // Auto-quote unquoted rounded node labels that contain nested parentheses or colons: id(Label: detail) -> id("Label: detail")
                updated = updated.replace(
                    /\b([A-Za-z0-9_]+)\(\s*(?![("[\]])([^)\n]+?)\s*\)/g,
                    (_m, id: string, label: string) => {
                        const safeLabel = label.replace(/"/g, "'").trim();
                        return `${id}("${safeLabel}")`;
                    }
                );

                return updated;
            }

            return line;
        });

        return '```mermaid\n' + cleanedLines.join('\n').trimEnd() + '\n```';
    });
}

/**
 * Ensures any YAML frontmatter tags in the note are valid Obsidian kebab-case tags
 * (no spaces), and optionally injects frontmatter if `tags` or `status` were passed separately.
 */
export function normalizeNoteFrontmatter(
    content: string,
    extraTags?: string[],
    status?: string
): string {
    const cleanExtraTags = (extraTags || []).map(sanitizeTag).filter(Boolean);
    const cleanStatus = status ? sanitizeTag(status) : '';

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!fmMatch) {
        if (cleanExtraTags.length === 0 && !cleanStatus) {
            return content;
        }
        const allTags = Array.from(new Set([...cleanExtraTags, ...(cleanStatus ? [cleanStatus] : [])]));
        const fmLines = ['---'];
        if (cleanStatus) fmLines.push(`status: "${cleanStatus}"`);
        if (allTags.length > 0) {
            fmLines.push('tags:');
            allTags.forEach(t => fmLines.push(`  - ${t}`));
        }
        fmLines.push(`updated_at: "${new Date().toISOString()}"`, '---', '');
        return fmLines.join('\n') + content;
    }

    const rawYaml = fmMatch[1];
    const body = content.slice(fmMatch[0].length);
    const lines = rawYaml.split(/\r?\n/);
    const outLines: string[] = [];
    let inTagsList = false;
    const collectedTags: string[] = [];

    for (const line of lines) {
        if (inTagsList) {
            if (/^\s*-\s+(.+)$/.test(line)) {
                const rawTag = line.replace(/^\s*-\s+/, '').trim();
                const cleaned = sanitizeTag(rawTag);
                if (cleaned) collectedTags.push(cleaned);
                continue;
            } else {
                // Flush sanitized tags before moving on
                const merged = Array.from(new Set([...collectedTags, ...cleanExtraTags]));
                merged.forEach(t => outLines.push(`  - ${t}`));
                inTagsList = false;
            }
        }

        const inlineTagsMatch = line.match(/^tags:\s*\[([^\]]*)\]\s*$/);
        if (inlineTagsMatch) {
            const inlineItems = inlineTagsMatch[1]
                .split(',')
                .map(s => sanitizeTag(s.replace(/['"]/g, '')))
                .filter(Boolean);
            const merged = Array.from(new Set([...inlineItems, ...cleanExtraTags]));
            outLines.push('tags:');
            merged.forEach(t => outLines.push(`  - ${t}`));
            continue;
        }

        const singleLineTagsMatch = line.match(/^tags:\s*(.+)$/);
        if (singleLineTagsMatch && !singleLineTagsMatch[1].trim().startsWith('[')) {
            const items = singleLineTagsMatch[1]
                .split(/[,;]+/)
                .map(s => sanitizeTag(s))
                .filter(Boolean);
            const merged = Array.from(new Set([...items, ...cleanExtraTags]));
            outLines.push('tags:');
            merged.forEach(t => outLines.push(`  - ${t}`));
            continue;
        }

        if (/^tags:\s*$/.test(line)) {
            outLines.push('tags:');
            inTagsList = true;
            continue;
        }

        outLines.push(line);
    }

    if (inTagsList) {
        const merged = Array.from(new Set([...collectedTags, ...cleanExtraTags]));
        merged.forEach(t => outLines.push(`  - ${t}`));
    }

    return `---\n${outLines.join('\n')}\n---\n${body}`;
}

export function getNoteTakingTools(app: App) {
    return [
        new FunctionTool({
            name: 'create_obsidian_note',
            description: 'Creates a new note in the Obsidian Vault (supporting Markdown, LaTeX, Callouts, and Mermaid diagrams/mindmaps).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Title or relative path of the note (e.g. "Game Theory/Nash Equilibrium").' },
                    content: { type: 'STRING' as any, description: 'Markdown content of the note (including optional Mermaid diagrams, mindmaps, callouts, and [[Backlinks]]).' },
                    tags: {
                        type: 'ARRAY' as any,
                        items: { type: 'STRING' as any },
                        description: 'Optional list of tags (automatically converted to kebab-case Obsidian tags).'
                    },
                    status: { type: 'STRING' as any, description: 'Optional note maturity status (e.g. "seed", "branch", "evergreen").' }
                },
                required: ['title', 'content']
            },
            execute: async (args: any) => {
                const title = (args.title || 'Untitled Note').trim();
                const rawContent = args.content || '';
                const path = `${title.endsWith('.md') ? title : title + '.md'}`;

                if (path.includes('/')) {
                    const folder = path.split('/').slice(0, -1).join('/');
                    if (folder) await ensureVaultFolder(app, folder);
                }

                const exists = await app.vault.adapter.exists(path);
                if (exists) return `Error: Note ${path} already exists. Use update_obsidian_note instead.`;

                const tags = Array.isArray(args.tags) ? args.tags : undefined;
                const preparedContent = normalizeNoteFrontmatter(
                    sanitizeMermaidBlocks(rawContent),
                    tags,
                    args.status
                );

                if (typeof app.vault.create === 'function') {
                    await app.vault.create(path, preparedContent);
                } else {
                    await app.vault.adapter.write(path, preparedContent);
                }
                return `Note ${path} created successfully.`;
            }
        }),
        new FunctionTool({
            name: 'update_obsidian_note',
            description: 'Updates an existing note in the Obsidian Vault. mode="append" or "overwrite" (preserves existing YAML frontmatter if omitted).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path: { type: 'STRING' as any, description: 'Path of the existing note.' },
                    content: { type: 'STRING' as any, description: 'Markdown content to append or overwrite (supports Mermaid flowcharts, mindmaps, sequence diagrams, and callouts).' },
                    mode: { type: 'STRING' as any, description: 'Update mode: "append" or "overwrite".' }
                },
                required: ['path', 'content']
            },
            execute: async (args: any) => {
                const rawPath = (args.path || '').trim();
                const rawContent = args.content;
                const mode = args.mode || 'append';

                if (!rawPath || !rawContent) return "Error: path and content are required.";
                const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;

                const exists = await app.vault.adapter.exists(path);
                if (!exists) return `Error: Note ${path} does not exist. Use create_obsidian_note instead.`;

                const existingContent = await app.vault.adapter.read(path);
                const sanitizedNew = sanitizeMermaidBlocks(rawContent);

                if (mode === 'overwrite') {
                    let finalContent = sanitizedNew;
                    const existingFmMatch = existingContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
                    const newHasFm = /^---\r?\n[\s\S]*?\r?\n---/.test(sanitizedNew);
                    if (existingFmMatch && !newHasFm) {
                        finalContent = `${existingFmMatch[0].trimEnd()}\n\n${sanitizedNew}`;
                    }
                    finalContent = normalizeNoteFrontmatter(finalContent);
                    await app.vault.adapter.write(path, finalContent);
                } else {
                    const combined = normalizeNoteFrontmatter(existingContent + '\n\n' + sanitizedNew);
                    await app.vault.adapter.write(path, combined);
                }
                return `Note ${path} updated successfully.`;
            }
        }),
        new FunctionTool({
            name: 'delete_obsidian_note',
            description: 'Deletes a note from the Obsidian Vault by path.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path: { type: 'STRING' as any, description: 'Path of the note to delete.' }
                },
                required: ['path']
            },
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
            description: 'Lists all markdown notes available in the Obsidian Vault (excluding internal session logs).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {}
            },
            execute: async () => {
                const files = app.vault.getMarkdownFiles()
                    .filter(f => !f.path.startsWith('DyResearch/Sessions/'));
                return files.map(f => f.path).join(', ');
            }
        }),
        new FunctionTool({
            name: 'read_obsidian_note',
            description: 'Reads the exact text of a specific Obsidian note by path.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path: { type: 'STRING' as any, description: 'Path of the note to read.' }
                },
                required: ['path']
            },
            execute: async (args: any) => {
                const rawPath = (args.path || '').trim();
                if (!rawPath) return "Error: path is required.";
                const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
                const exists = await app.vault.adapter.exists(path);
                if (!exists) return `Error: Note ${path} not found.`;
                const content = await app.vault.adapter.read(path);
                return content;
            }
        })
    ];
}
