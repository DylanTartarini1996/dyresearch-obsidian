import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';
import {
    LIBRARY_DIR,
    LIBRARY_INDEX_DIR,
    ensureVaultFolder,
    moveVaultFile,
    sanitizeFileName,
    sanitizeTopicFolder,
    buildIndexMarkdown,
    parseFrontmatter,
    extractMarkdownSection,
    listLibraryCatalog,
    listFilesRecursive
} from '../pdf-service';

async function upsertIndexNote(
    app: App,
    args: {
        title: string;
        subject?: string;
        topic_folder?: string;
        author?: string;
        source_type?: string;
        tags?: string[];
        abstract?: string;
        section_titles?: string[];
        summary?: string;
        conclusions?: string;
        content?: string;
        file_path?: string;
    }
): Promise<{ indexPath: string; filePath: string }> {
    await ensureVaultFolder(app, LIBRARY_DIR);
    await ensureVaultFolder(app, LIBRARY_INDEX_DIR);

    const safeBase = sanitizeFileName(args.title || 'Untitled');
    const indexPath = `${LIBRARY_INDEX_DIR}/${safeBase}.md`;

    let existingFm: Record<string, any> = {};
    let existingAbstract = '';
    let existingSections: string[] = [];
    let existingSummary = '';
    let existingConclusions = '';

    if (await app.vault.adapter.exists(indexPath)) {
        const existingMd = await app.vault.adapter.read(indexPath);
        existingFm = parseFrontmatter(existingMd);
        existingAbstract = extractMarkdownSection(existingMd, 'Abstract');
        existingSummary = extractMarkdownSection(existingMd, 'Summary & Key Takeaways');
        existingConclusions = extractMarkdownSection(existingMd, 'Conclusions');
        const rawSec = extractMarkdownSection(existingMd, 'Section Titles');
        if (rawSec && !rawSec.includes('No numbered sections detected')) {
            existingSections = rawSec
                .split('\n')
                .map(l => l.replace(/^\s*-\s*/, '').trim())
                .filter(Boolean);
        }
    }

    const topicFolder = args.topic_folder
        ? sanitizeTopicFolder(args.topic_folder)
        : (existingFm.topic_folder || (args.subject ? sanitizeTopicFolder(args.subject) : 'Uncategorized'));

    let currentFilePath: string = args.file_path || existingFm.file_path || '';
    if (!currentFilePath) {
        const allRaw = await listFilesRecursive(app, LIBRARY_DIR);
        const match = allRaw.find(p => {
            const base = (p.split('/').pop() || '').replace(/\.[^.]+$/, '');
            return base.toLowerCase() === safeBase.toLowerCase();
        });
        if (match) currentFilePath = match;
    }

    if (currentFilePath && await app.vault.adapter.exists(currentFilePath) && topicFolder && topicFolder !== 'Uncategorized') {
        const fileName = currentFilePath.split('/').pop()!;
        const targetFolder = `${LIBRARY_DIR}/${topicFolder}`;
        await ensureVaultFolder(app, targetFolder);
        const newFilePath = `${targetFolder}/${fileName}`;
        if (newFilePath !== currentFilePath) {
            await moveVaultFile(app, currentFilePath, newFilePath);
            currentFilePath = newFilePath;
        }
    }

    const subject = (args.subject || existingFm.subject || topicFolder || 'general').toLowerCase().trim();
    const authors = args.author || existingFm.authors || 'Unknown';
    const sourceType = args.source_type || existingFm.type || 'PDF';
    const pages = Number(existingFm.pages) || 1;
    const sourceUrl = existingFm.source_url || '';

    const rawTags = Array.isArray(args.tags)
        ? args.tags
        : (typeof args.tags === 'string' ? (args.tags as string).split(',').map(s => s.trim()) : []);
    const existingTags = Array.isArray(existingFm.tags) ? existingFm.tags : [];
    const mergedTags = Array.from(new Set([
        ...rawTags,
        ...existingTags,
        subject.replace(/\s+/g, '-')
    ].filter(Boolean)));

    const abstractText = args.abstract || existingAbstract;
    const sectionTitles = (args.section_titles && args.section_titles.length > 0)
        ? args.section_titles
        : existingSections;
    const summaryText = args.summary || args.content || existingSummary;
    const conclusionsText = args.conclusions || existingConclusions;

    const md = buildIndexMarkdown({
        title: args.title || existingFm.title || safeBase.replace(/_/g, ' '),
        authors,
        subject,
        topicFolder,
        tags: mergedTags,
        type: sourceType,
        pages,
        sourceUrl,
        filePath: currentFilePath,
        abstractText,
        sectionTitles,
        summary: summaryText,
        conclusionsText
    });

    await app.vault.adapter.write(indexPath, md);
    return { indexPath, filePath: currentFilePath };
}

export function getLibrarianTools(app: App) {
    return [
        new FunctionTool({
            name: 'organize_and_index_document',
            description: 'Organizes a downloaded/uploaded PDF or document into a topic-specific subfolder in DyResearch/Library/<Topic>/ and writes its concise index note in DyResearch/Library Index/ (containing ONLY metadata, abstract, summary, section titles, conclusions, and tags—never raw full text).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Document title.' },
                    topic_folder: { type: 'STRING' as any, description: 'Topic subfolder name inside Library (e.g., "Machine Learning", "Game Theory").' },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category (e.g., "machine learning").' },
                    author: { type: 'STRING' as any, description: 'Author name(s).' },
                    tags: {
                        type: 'ARRAY' as any,
                        items: { type: 'STRING' as any },
                        description: 'List of relevant tags (e.g. ["transformers", "attention", "nlp"]).'
                    },
                    abstract: { type: 'STRING' as any, description: 'The paper abstract.' },
                    section_titles: {
                        type: 'ARRAY' as any,
                        items: { type: 'STRING' as any },
                        description: 'List of section titles in the document (e.g. ["1 Introduction", "2 Background", "3 Model Architecture"]).'
                    },
                    summary: { type: 'STRING' as any, description: 'Concise structured summary of the document (key contributions and takeaways).' },
                    conclusions: { type: 'STRING' as any, description: 'Conclusions and future work of the document.' },
                    file_path: { type: 'STRING' as any, description: 'Optional current path to the raw PDF in DyResearch/Library/.' }
                },
                required: ['title', 'topic_folder', 'summary']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    topic_folder: args.topic_folder,
                    subject: args.subject || args.topic_folder?.toLowerCase(),
                    author: args.author,
                    tags: args.tags,
                    abstract: args.abstract,
                    section_titles: args.section_titles,
                    summary: args.summary,
                    conclusions: args.conclusions,
                    file_path: args.file_path
                });
                return `Organized raw file at "${res.filePath || 'N/A'}" and saved clean index card at "${res.indexPath}".`;
            }
        }),
        new FunctionTool({
            name: 'ingest_source_chunks',
            description: 'Ingests summary and metadata into DyResearch/Library Index/ (and organizes any matching PDF in DyResearch/Library/).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Document title.' },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category.' },
                    topic_folder: { type: 'STRING' as any, description: 'Optional topic subfolder in DyResearch/Library (e.g. "Machine Learning").' },
                    author: { type: 'STRING' as any, description: 'Author name.' },
                    source_type: { type: 'STRING' as any, description: 'Source type (PDF, Book, Web, Article).' },
                    content: { type: 'STRING' as any, description: 'Summary content to index.' }
                },
                required: ['title', 'subject']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    subject: args.subject,
                    topic_folder: args.topic_folder,
                    author: args.author,
                    source_type: args.source_type,
                    content: args.chunks?.join('\n\n') || args.content
                });
                return `Indexed into ${res.indexPath}` + (res.filePath ? ` (linked to ${res.filePath})` : '');
            }
        }),
        new FunctionTool({
            name: 'ingest_source_file',
            description: 'Ingests a document summary and metadata into DyResearch/Library Index/.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Document title.' },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category.' },
                    topic_folder: { type: 'STRING' as any, description: 'Optional topic subfolder in DyResearch/Library (e.g. "Machine Learning").' },
                    author: { type: 'STRING' as any, description: 'Author name.' },
                    source_type: { type: 'STRING' as any, description: 'Source type (PDF, Book, Web, Article).' },
                    content: { type: 'STRING' as any, description: 'Structured summary content.' }
                },
                required: ['title', 'subject', 'content']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    subject: args.subject,
                    topic_folder: args.topic_folder,
                    author: args.author,
                    source_type: args.source_type,
                    content: args.content
                });
                return `Document indexed into ${res.indexPath}` + (res.filePath ? ` (linked to ${res.filePath})` : '');
            }
        }),
        new FunctionTool({
            name: 'list_available_sources',
            description: 'Lists all documents, topic folders in DyResearch/Library, and indexed notes in DyResearch/Library Index.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {}
            },
            execute: async () => {
                const entries = await listLibraryCatalog(app);
                if (entries.length === 0) return 'No documents found in Library or Library Index.';
                return JSON.stringify(entries, null, 2);
            }
        }),
        new FunctionTool({
            name: 'delete_source',
            description: 'Deletes a specific document from both DyResearch/Library and DyResearch/Library Index by title.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Title of the document to delete.' }
                },
                required: ['title']
            },
            execute: async (args: any) => {
                const title = args.title;
                if (!title) return "Error: title is required.";
                const safeBase = sanitizeFileName(title).toLowerCase();
                const entries = await listLibraryCatalog(app);
                const match = entries.find(e =>
                    e.title.toLowerCase() === title.toLowerCase() ||
                    sanitizeFileName(e.title).toLowerCase() === safeBase
                );

                let removedAny = false;
                if (match) {
                    if (match.indexPath && await app.vault.adapter.exists(match.indexPath)) {
                        await app.vault.adapter.remove(match.indexPath);
                        removedAny = true;
                    }
                    if (match.filePath && await app.vault.adapter.exists(match.filePath)) {
                        await app.vault.adapter.remove(match.filePath);
                        removedAny = true;
                    }
                } else {
                    const fallbackIdx = `${LIBRARY_INDEX_DIR}/${sanitizeFileName(title)}.md`;
                    if (await app.vault.adapter.exists(fallbackIdx)) {
                        await app.vault.adapter.remove(fallbackIdx);
                        removedAny = true;
                    }
                }
                return removedAny ? `Deleted "${title}" from Library and Library Index.` : `Source "${title}" not found.`;
            }
        }),
        new FunctionTool({
            name: 'delete_by_subject',
            description: 'Purges all documents related to a specific subject from Library and Library Index.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    subject: { type: 'STRING' as any, description: 'Subject category to purge.' }
                },
                required: ['subject']
            },
            execute: async (args: any) => {
                const targetSubject = (args.subject || '').toLowerCase().trim();
                if (!targetSubject) return "Error: subject is required.";
                const entries = await listLibraryCatalog(app);
                let deletedCount = 0;
                for (const entry of entries) {
                    if (entry.subject.toLowerCase() === targetSubject || entry.topicFolder.toLowerCase() === targetSubject) {
                        if (entry.indexPath && await app.vault.adapter.exists(entry.indexPath)) {
                            await app.vault.adapter.remove(entry.indexPath);
                        }
                        if (entry.filePath && await app.vault.adapter.exists(entry.filePath)) {
                            await app.vault.adapter.remove(entry.filePath);
                        }
                        deletedCount++;
                    }
                }
                return `Purged ${deletedCount} document(s) matching subject "${targetSubject}".`;
            }
        })
    ];
}
