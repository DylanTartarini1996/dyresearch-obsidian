import { App } from 'obsidian';
import { FunctionTool } from '@google/adk';
import {
    LIBRARY_DIR,
    LIBRARY_INDEX_DIR,
    DocumentKind,
    ensureVaultFolder,
    moveVaultFile,
    sanitizeFileName,
    buildIndexMarkdown,
    parseFrontmatter,
    extractMarkdownSection,
    listLibraryCatalog,
    listFilesRecursive,
    getExistingLibraryTaxonomy,
    normalizeAndDeduplicateAuthors,
    resolveConsistentTopicFolder,
    sanitizeTag,
    areAuthorsEquivalent,
    cleanSingleAuthorName
} from '../pdf-service';

async function upsertIndexNote(
    app: App,
    args: {
        title: string;
        doc_kind?: DocumentKind;
        subject?: string;
        topic_folder?: string;
        author?: string | string[];
        source_type?: string;
        tags?: string[];
        abstract?: string;
        section_titles?: string[];
        summary?: string;
        conclusions?: string;
        content?: string;
        file_path?: string;
    }
): Promise<{ indexPath: string; filePath: string; topicFolder: string; authors: string }> {
    await ensureVaultFolder(app, LIBRARY_DIR);
    await ensureVaultFolder(app, LIBRARY_INDEX_DIR);

    const taxonomy = await getExistingLibraryTaxonomy(app);

    // Locate any existing index note by file_path or title
    const safeBase = sanitizeFileName(args.title || 'Untitled');
    let indexPath = `${LIBRARY_INDEX_DIR}/${safeBase}.md`;

    if (!(await app.vault.adapter.exists(indexPath)) && args.file_path) {
        const fileBase = sanitizeFileName((args.file_path.split('/').pop() || '').replace(/\.[^.]+$/, ''));
        const candidatePath = `${LIBRARY_INDEX_DIR}/${fileBase}.md`;
        if (await app.vault.adapter.exists(candidatePath)) {
            indexPath = candidatePath;
        }
    }

    let existingFm: Record<string, any> = {};
    let existingAbstract = '';
    let existingSections: string[] = [];
    let existingSummary = '';
    let existingConclusions = '';

    if (await app.vault.adapter.exists(indexPath)) {
        const existingMd = await app.vault.adapter.read(indexPath);
        existingFm = parseFrontmatter(existingMd);
        existingAbstract =
            extractMarkdownSection(existingMd, 'Abstract') ||
            extractMarkdownSection(existingMd, 'Book Overview') ||
            extractMarkdownSection(existingMd, 'Overview');
        existingSummary = extractMarkdownSection(existingMd, 'Summary & Key Takeaways');
        existingConclusions = extractMarkdownSection(existingMd, 'Conclusions');
        const rawSec =
            extractMarkdownSection(existingMd, 'Section Titles') ||
            extractMarkdownSection(existingMd, 'Chapters & Table of Contents') ||
            extractMarkdownSection(existingMd, 'Key Sections & Outline');
        if (rawSec && !rawSec.includes('No numbered sections detected')) {
            existingSections = rawSec
                .split('\n')
                .map(l => l.replace(/^\s*-\s*/, '').trim())
                .filter(Boolean);
        }
    }

    const rawCandidateTopic = args.topic_folder || existingFm.topic_folder || args.subject || 'Uncategorized';
    const topicFolder = resolveConsistentTopicFolder(rawCandidateTopic, taxonomy.topicFolders);

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

    // If title was refined by the Librarian, rename the index file to match the clean title if needed
    const desiredIndexPath = `${LIBRARY_INDEX_DIR}/${safeBase}.md`;
    if (indexPath !== desiredIndexPath && await app.vault.adapter.exists(indexPath)) {
        await app.vault.adapter.remove(indexPath);
        indexPath = desiredIndexPath;
    }

    const docKind: DocumentKind = args.doc_kind || (existingFm.doc_kind as DocumentKind) || 'Paper';
    const subject = (args.subject || existingFm.subject || topicFolder || 'general').toLowerCase().trim();
    const rawAuthorInput = args.author || existingFm.authors || 'Unknown';
    const authors = normalizeAndDeduplicateAuthors(rawAuthorInput, taxonomy.canonicalAuthors);
    const sourceType = args.source_type || existingFm.type || 'PDF';
    const pages = Number(existingFm.pages) || 1;
    const sourceUrl = existingFm.source_url || '';

    const rawTags = Array.isArray(args.tags)
        ? args.tags
        : (typeof args.tags === 'string' ? (args.tags as string).split(/[,;]+/).map(s => s.trim()) : []);
    const existingTags = Array.isArray(existingFm.tags) ? existingFm.tags : [];
    const mergedTags = Array.from(new Set([
        sanitizeTag(docKind),
        ...rawTags.map(sanitizeTag),
        ...existingTags.map(sanitizeTag),
        sanitizeTag(subject)
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
        docKind,
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
    return { indexPath, filePath: currentFilePath, topicFolder, authors };
}

export function getLibrarianTools(app: App) {
    return [
        new FunctionTool({
            name: 'organize_and_index_document',
            description: 'Organizes a downloaded/uploaded Paper, Book, or Document into a consistent topic subfolder in DyResearch/Library/<Topic>/, deduplicates author names against the existing Library catalog, and writes its concise index note in DyResearch/Library Index/.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Clean document title.' },
                    doc_kind: {
                        type: 'STRING' as any,
                        description: 'Document kind: "Paper", "Book", or "Document".'
                    },
                    topic_folder: {
                        type: 'STRING' as any,
                        description: 'Consistent topic subfolder name inside Library (reuse an existing folder if applicable, e.g., "Machine Learning", "Game Theory").'
                    },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category (e.g., "machine learning").' },
                    author: {
                        type: 'STRING' as any,
                        description: 'Comma-separated author names in "First Last" format (automatically deduplicated against existing authors).'
                    },
                    tags: {
                        type: 'ARRAY' as any,
                        items: { type: 'STRING' as any },
                        description: 'List of relevant tags (e.g. ["transformers", "attention", "nlp"]).'
                    },
                    abstract: { type: 'STRING' as any, description: 'The paper abstract or book/document overview.' },
                    section_titles: {
                        type: 'ARRAY' as any,
                        items: { type: 'STRING' as any },
                        description: 'List of section or chapter titles in the document.'
                    },
                    summary: { type: 'STRING' as any, description: 'Concise structured summary of the document (key contributions and takeaways).' },
                    conclusions: { type: 'STRING' as any, description: 'Conclusions and key takeaways of the document.' },
                    file_path: { type: 'STRING' as any, description: 'Optional current path to the raw file in DyResearch/Library/.' }
                },
                required: ['title', 'topic_folder', 'summary']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    doc_kind: args.doc_kind as DocumentKind,
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
                return `Organized raw file into "${res.filePath || 'N/A'}" (Topic: "${res.topicFolder}", Authors: "${res.authors}") and saved clean index card at "${res.indexPath}".`;
            }
        }),
        new FunctionTool({
            name: 'ingest_source_chunks',
            description: 'Ingests summary and metadata into DyResearch/Library Index/ (and organizes any matching PDF in DyResearch/Library/).',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    title: { type: 'STRING' as any, description: 'Document title.' },
                    doc_kind: { type: 'STRING' as any, description: '"Paper", "Book", or "Document".' },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category.' },
                    topic_folder: { type: 'STRING' as any, description: 'Optional topic subfolder in DyResearch/Library (e.g. "Machine Learning").' },
                    author: { type: 'STRING' as any, description: 'Author name(s).' },
                    source_type: { type: 'STRING' as any, description: 'Source type (PDF, Book, Web, Article).' },
                    content: { type: 'STRING' as any, description: 'Summary content to index.' }
                },
                required: ['title', 'subject']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    doc_kind: args.doc_kind as DocumentKind,
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
                    doc_kind: { type: 'STRING' as any, description: '"Paper", "Book", or "Document".' },
                    subject: { type: 'STRING' as any, description: 'Lowercase subject category.' },
                    topic_folder: { type: 'STRING' as any, description: 'Optional topic subfolder in DyResearch/Library (e.g. "Machine Learning").' },
                    author: { type: 'STRING' as any, description: 'Author name(s).' },
                    source_type: { type: 'STRING' as any, description: 'Source type (PDF, Book, Web, Article).' },
                    content: { type: 'STRING' as any, description: 'Structured summary content.' }
                },
                required: ['title', 'subject', 'content']
            },
            execute: async (args: any) => {
                const res = await upsertIndexNote(app, {
                    title: args.title,
                    doc_kind: args.doc_kind as DocumentKind,
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
            description: 'Lists and filters documents, existing topic subfolders in DyResearch/Library, canonical authors, and indexed notes in DyResearch/Library Index.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    doc_kind_filter: { type: 'STRING' as any, description: 'Optional filter by document kind: "Paper", "Book", or "Document".' },
                    topic_filter: { type: 'STRING' as any, description: 'Optional filter by topic folder or subject (e.g. "Machine Learning").' },
                    author_filter: { type: 'STRING' as any, description: 'Optional filter by author name (e.g. "Vaswani").' },
                    query: { type: 'STRING' as any, description: 'Optional keyword filter across title, authors, topic, and tags.' }
                }
            },
            execute: async (args: any = {}) => {
                const allEntries = await listLibraryCatalog(app);
                const taxonomy = await getExistingLibraryTaxonomy(app);

                const kindFilter = (args.doc_kind_filter || '').trim().toLowerCase();
                const topicFilter = (args.topic_filter || '').trim().toLowerCase();
                const authorFilter = (args.author_filter || '').trim();
                const queryFilter = (args.query || '').trim().toLowerCase();

                const filtered = allEntries.filter(doc => {
                    if (kindFilter && doc.docKind.toLowerCase() !== kindFilter && doc.type.toLowerCase() !== kindFilter) {
                        return false;
                    }
                    if (topicFilter) {
                        const inTopic = doc.topicFolder.toLowerCase().includes(topicFilter);
                        const inSubject = doc.subject.toLowerCase().includes(topicFilter);
                        const inTags = doc.tags.some(t => t.toLowerCase().includes(topicFilter));
                        if (!inTopic && !inSubject && !inTags) return false;
                    }
                    if (authorFilter) {
                        const docAuthors = doc.authors.split(',').map(a => cleanSingleAuthorName(a)).filter(Boolean);
                        const matched =
                            doc.authors.toLowerCase().includes(authorFilter.toLowerCase()) ||
                            docAuthors.some(a => areAuthorsEquivalent(a, authorFilter));
                        if (!matched) return false;
                    }
                    if (queryFilter) {
                        const hay = `${doc.title} ${doc.authors} ${doc.topicFolder} ${doc.subject} ${doc.docKind} ${doc.tags.join(' ')}`.toLowerCase();
                        if (!hay.includes(queryFilter)) return false;
                    }
                    return true;
                });

                return JSON.stringify({
                    existing_topic_folders: taxonomy.topicFolders,
                    canonical_authors: taxonomy.canonicalAuthors,
                    total_documents: allEntries.length,
                    matching_documents: filtered.length,
                    documents: filtered
                }, null, 2);
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
