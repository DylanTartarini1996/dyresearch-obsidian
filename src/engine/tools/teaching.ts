import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';
import {
    LIBRARY_DIR,
    LIBRARY_INDEX_DIR,
    listFilesRecursive,
    parseFrontmatter,
    sanitizeFileName,
    queryPdfPagesOnDemand,
    areAuthorsEquivalent,
    cleanSingleAuthorName
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
                return await app.vault.adapter.read(path);
            }
        }),
        new FunctionTool({
            name: 'search_knowledge_base',
            description: 'Searches DyResearch/Library Index/ for indexed documents by keyword, document kind (Paper, Book, Document), topic/subject, or author(s).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    query: { type: 'STRING' as any, description: 'Optional keyword or phrase to search in the Library Index.' },
                    doc_kind_filter: { type: 'STRING' as any, description: 'Optional document kind filter: "Paper", "Book", or "Document".' },
                    subject_filter: { type: 'STRING' as any, description: 'Optional subject or topic folder filter (e.g. "machine learning", "Game Theory").' },
                    author_filter: { type: 'STRING' as any, description: 'Optional author name filter (e.g. "Vaswani", "Ashish Vaswani").' }
                }
            },
            execute: async (args: any) => {
                const rawQuery = (args.query || "").trim().toLowerCase();
                const kindFilter = (args.doc_kind_filter || "").trim().toLowerCase();
                const subjectFilter = (args.subject_filter || "").trim().toLowerCase();
                const authorFilter = (args.author_filter || "").trim();

                const indexFiles = await listFilesRecursive(app, LIBRARY_INDEX_DIR);
                const legacyFiles = (await listFilesRecursive(app, LIBRARY_DIR)).filter(f => f.endsWith('.md'));
                const allMdFiles = Array.from(new Set([...indexFiles.filter(f => f.endsWith('.md')), ...legacyFiles]));

                if (allMdFiles.length === 0) return "Knowledge base (DyResearch/Library Index) is empty.";

                const keywords = rawQuery.split(/\s+/).filter(k => k.length > 2);
                const matches = [];

                for (const path of allMdFiles) {
                    const content = await app.vault.adapter.read(path);
                    const fm = parseFrontmatter(content);

                    if (kindFilter) {
                        const docKind = (fm.doc_kind || 'Paper').toLowerCase();
                        const docType = (fm.type || '').toLowerCase();
                        if (docKind !== kindFilter && docType !== kindFilter) {
                            continue;
                        }
                    }

                    if (subjectFilter) {
                        const docSubject = (fm.subject || '').toLowerCase();
                        const docTopic = (fm.topic_folder || '').toLowerCase();
                        const docTags = Array.isArray(fm.tags) ? fm.tags.join(' ').toLowerCase() : '';
                        if (!docSubject.includes(subjectFilter) && !docTopic.includes(subjectFilter) && !docTags.includes(subjectFilter)) {
                            continue;
                        }
                    }

                    if (authorFilter) {
                        const docAuthorsRaw = String(fm.authors || '');
                        const lowerFilter = authorFilter.toLowerCase();
                        const docAuthorList = docAuthorsRaw.split(',').map(a => cleanSingleAuthorName(a)).filter(Boolean);
                        const hasAuthorMatch =
                            docAuthorsRaw.toLowerCase().includes(lowerFilter) ||
                            docAuthorList.some(a => areAuthorsEquivalent(a, authorFilter));
                        if (!hasAuthorMatch) {
                            continue;
                        }
                    }

                    const lower = content.toLowerCase();
                    let matchIdx = rawQuery ? lower.indexOf(rawQuery) : 0;
                    if (rawQuery && matchIdx === -1 && keywords.length > 0) {
                        for (const kw of keywords) {
                            matchIdx = lower.indexOf(kw);
                            if (matchIdx !== -1) break;
                        }
                    }

                    if (!rawQuery || matchIdx !== -1 || path.toLowerCase().includes(rawQuery)) {
                        const start = matchIdx > 0 ? Math.max(0, matchIdx - 150) : 0;
                        const snippet = content.substring(start, start + 500).replace(/\s+/g, ' ').trim();
                        matches.push({
                            index_path: path,
                            title: fm.title || path.split('/').pop(),
                            doc_kind: fm.doc_kind || 'Paper',
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
            description: 'Reads an indexed document in DyResearch/Library Index/ AND can read specific pages or search sections directly from its linked raw PDF in DyResearch/Library/.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    path_or_title: { type: 'STRING' as any, description: 'Exact index_path (e.g. "DyResearch/Library Index/Attention_Is_All_You_Need.md") or document title.' },
                    page: { type: 'NUMBER' as any, description: 'Optional 1-based page number to read directly from the PDF in DyResearch/Library/.' },
                    section_query: { type: 'STRING' as any, description: 'Optional keyword, section title, or equation name (e.g. "Scaled Dot-Product Attention", "3.2") to read matching passages directly from the PDF.' }
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

                const indexContent = await app.vault.adapter.read(resolvedPath);
                const fm = parseFrontmatter(indexContent);
                const pdfPath = fm.file_path || '';

                // If page or section_query is requested, extract targeted page(s) from the linked PDF on demand
                if ((args.page || args.section_query) && pdfPath && pdfPath.toLowerCase().endsWith('.pdf') && await app.vault.adapter.exists(pdfPath)) {
                    try {
                        const pdfBuffer = await app.vault.adapter.readBinary(pdfPath);
                        const matchedText = await queryPdfPagesOnDemand(pdfBuffer, {
                            page: typeof args.page === 'number' ? args.page : undefined,
                            sectionQuery: typeof args.section_query === 'string' ? args.section_query : undefined
                        });
                        if (matchedText) {
                            const header = args.page
                                ? `### PDF Page ${args.page} (${pdfPath}):`
                                : `### PDF Passages matching "${args.section_query}" (${pdfPath}):`;
                            return `${indexContent}\n\n---\n${header}\n\n${matchedText}`;
                        }
                    } catch (e) {
                        console.error("Failed to read PDF on the fly:", e);
                    }
                }

                return indexContent;
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
