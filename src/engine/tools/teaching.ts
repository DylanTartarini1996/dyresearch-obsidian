import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';
import {
    LIBRARY_DIR,
    LIBRARY_INDEX_DIR,
    listFilesRecursive,
    parseFrontmatter,
    sanitizeFileName
} from '../pdf-service';

export function getTeachingTools(app: App) {
    return [
        new FunctionTool({
            name: 'search_obsidian_vault',
            description: 'Searches the local Obsidian vault (excluding internal DyResearch folders) for relevant user notes and concepts.',
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
                    if (file.path.startsWith('DyResearch/')) continue;
                    const content = await app.vault.read(file);
                    const idx = content.toLowerCase().indexOf(query);
                    if (idx !== -1 || file.path.toLowerCase().includes(query)) {
                        const start = idx !== -1 ? Math.max(0, idx - 100) : 0;
                        const snippet = content.substring(start, start + 300) + '...';
                        matches.push({ path: file.path, snippet });
                    }
                }
                return matches.length > 0 ? JSON.stringify(matches, null, 2) : "No matches found in Vault.";
            }
        }),
        new FunctionTool({
            name: 'read_obsidian_note',
            description: 'Reads the exact text of a specific Obsidian note or Library Index note by path.',
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
                const content = await app.vault.adapter.read(path);
                return content.length > 18000
                    ? content.substring(0, 18000) + `\n\n...[Truncated at 18,000 chars out of ${content.length}. Use read_library_document with page or section_query to read further sections.]`
                    : content;
            }
        }),
        new FunctionTool({
            name: 'search_knowledge_base',
            description: 'Searches DyResearch/Library Index/ for indexed PDFs and documents by keyword and optional subject/topic filter.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    query: { type: 'STRING' as any, description: 'Keyword or phrase to search in the indexed library notes and full PDF text.' },
                    subject_filter: { type: 'STRING' as any, description: 'Optional subject or topic folder filter (e.g. "machine learning").' }
                },
                required: ['query']
            },
            execute: async (args: any) => {
                const rawQuery = (args.query || "").trim().toLowerCase();
                const subjectFilter = (args.subject_filter || "").trim().toLowerCase();

                const indexFiles = await listFilesRecursive(app, LIBRARY_INDEX_DIR);
                const legacyFiles = (await listFilesRecursive(app, LIBRARY_DIR)).filter(f => f.endsWith('.md'));
                const allMdFiles = Array.from(new Set([...indexFiles.filter(f => f.endsWith('.md')), ...legacyFiles]));

                if (allMdFiles.length === 0) return "Knowledge base (DyResearch/Library Index) is empty.";

                const keywords = rawQuery.split(/\s+/).filter(k => k.length > 2);
                const matches = [];

                for (const path of allMdFiles) {
                    const content = await app.vault.adapter.read(path);
                    const fm = parseFrontmatter(content);

                    if (subjectFilter) {
                        const docSubject = (fm.subject || '').toLowerCase();
                        const docTopic = (fm.topic_folder || '').toLowerCase();
                        const docTags = Array.isArray(fm.tags) ? fm.tags.join(' ').toLowerCase() : '';
                        if (!docSubject.includes(subjectFilter) && !docTopic.includes(subjectFilter) && !docTags.includes(subjectFilter)) {
                            continue;
                        }
                    }

                    const lower = content.toLowerCase();
                    let matchIdx = lower.indexOf(rawQuery);
                    if (matchIdx === -1 && keywords.length > 0) {
                        for (const kw of keywords) {
                            matchIdx = lower.indexOf(kw);
                            if (matchIdx !== -1) break;
                        }
                    }

                    if (matchIdx !== -1 || path.toLowerCase().includes(rawQuery)) {
                        const start = matchIdx !== -1 ? Math.max(0, matchIdx - 150) : 0;
                        const snippet = content.substring(start, start + 500).replace(/\s+/g, ' ').trim();
                        matches.push({
                            index_path: path,
                            title: fm.title || path.split('/').pop(),
                            authors: fm.authors || 'Unknown',
                            subject: fm.subject || 'general',
                            topic_folder: fm.topic_folder || 'Uncategorized',
                            pdf_path: fm.file_path || '',
                            pages: fm.pages || 1,
                            matching_excerpt: snippet + '...'
                        });
                    }
                }

                return matches.length > 0
                    ? JSON.stringify(matches, null, 2)
                    : "No matching documents found in Library Index.";
            }
        }),
        new FunctionTool({
            name: 'read_library_document',
            description: 'Reads the indexed Markdown note (summary, metadata, and extracted PDF text) from DyResearch/Library Index/ by path or title. Supports reading a specific PDF page number or searching for a specific section/term inside the full PDF text.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path_or_title: { type: 'STRING' as any, description: 'Exact index_path (e.g. "DyResearch/Library Index/Attention_Is_All_You_Need.md") or document title.' },
                    page: { type: 'NUMBER' as any, description: 'Optional 1-based page number to read from the extracted PDF text.' },
                    section_query: { type: 'STRING' as any, description: 'Optional keyword/heading (e.g. "Scaled Dot-Product Attention", "Table 1") to extract all matching passages from the full PDF text.' }
                },
                required: ['path_or_title']
            },
            execute: async (args: any) => {
                const target = (args.path_or_title || '').trim();
                if (!target) return "Error: path_or_title is required.";

                let resolvedPath = target;
                if (!(await app.vault.adapter.exists(resolvedPath))) {
                    const candidate = `${LIBRARY_INDEX_DIR}/${sanitizeFileName(target.replace(/\.md$/i, ''))}.md`;
                    if (await app.vault.adapter.exists(candidate)) {
                        resolvedPath = candidate;
                    } else {
                        const allIndex = await listFilesRecursive(app, LIBRARY_INDEX_DIR);
                        const found = allIndex.find(p => p.toLowerCase().includes(sanitizeFileName(target).toLowerCase()));
                        if (found) resolvedPath = found;
                    }
                }

                if (!(await app.vault.adapter.exists(resolvedPath))) {
                    return `Document "${target}" not found in ${LIBRARY_INDEX_DIR}.`;
                }

                const content = await app.vault.adapter.read(resolvedPath);

                // If a specific page is requested, locate `-- <page> of <total> --`
                if (args.page && typeof args.page === 'number') {
                    const pageNum = args.page;
                    const pageMarkerRegex = new RegExp(`([\\s\\S]*?)\\n-- ${pageNum} of \\d+ --`, 'i');
                    const prevPageMarker = pageNum > 1 ? new RegExp(`-- ${pageNum - 1} of \\d+ --\\n([\\s\\S]*?)\\n-- ${pageNum} of \\d+ --`, 'i') : null;

                    if (prevPageMarker) {
                        const m = content.match(prevPageMarker);
                        if (m) return `### Page ${pageNum} of ${resolvedPath}\n\n${m[1].trim()}`;
                    } else {
                        const fullTextIdx = content.indexOf('## Extracted Full Text');
                        const body = fullTextIdx !== -1 ? content.slice(fullTextIdx) : content;
                        const m = body.match(pageMarkerRegex);
                        if (m) return `### Page ${pageNum} of ${resolvedPath}\n\n${m[1].trim()}`;
                    }
                }

                // If a section_query is provided, return header/summary + all matching windows in the full text
                if (args.section_query && typeof args.section_query === 'string') {
                    const q = args.section_query.toLowerCase().trim();
                    const fullTextIdx = content.indexOf('## Extracted Full Text');
                    const headerPart = fullTextIdx !== -1 ? content.slice(0, fullTextIdx) : content.slice(0, 2000);
                    const lower = content.toLowerCase();
                    const excerpts: string[] = [];
                    let pos = 0;
                    while (excerpts.length < 6) {
                        const foundIdx = lower.indexOf(q, pos);
                        if (foundIdx === -1) break;
                        const start = Math.max(0, foundIdx - 300);
                        const end = Math.min(content.length, foundIdx + 900);
                        excerpts.push(`...\n${content.slice(start, end).trim()}\n...`);
                        pos = foundIdx + q.length + 400;
                    }
                    if (excerpts.length > 0) {
                        return `${headerPart}\n### Passages matching "${args.section_query}":\n\n${excerpts.join('\n\n---\n\n')}`;
                    }
                }

                return content.length > 18000
                    ? content.substring(0, 18000) + `\n\n...[Showing first 18,000 of ${content.length} chars. Call read_library_document with page=N or section_query="..." to read specific pages or sections.]`
                    : content;
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
                const title = (args.title || '').toLowerCase();
                if (!title) return "Provide a title to search backlinks.";
                const files = app.vault.getMarkdownFiles();
                const related = [];
                for (const file of files) {
                    if (file.path.toLowerCase().includes(title)) {
                        related.push(file.path);
                    }
                }
                return related.length > 0 ? `Related Vault notes: ${related.join(', ')}` : "No direct backlinks found in Vault.";
            }
        })
    ];
}
