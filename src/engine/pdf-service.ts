import { App } from 'obsidian';
import { PDFParse } from 'pdf-parse';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

export const LIBRARY_DIR = 'DyResearch/Library';
export const LIBRARY_INDEX_DIR = 'DyResearch/Library Index';

// Ensure in-process worker is registered for Electron renderer environment in Obsidian
if (typeof globalThis !== 'undefined' && !(globalThis as any).pdfjsWorker) {
    (globalThis as any).pdfjsWorker = pdfjsWorker;
}

export async function ensureVaultFolder(app: App, folderPath: string) {
    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const exists = await app.vault.adapter.exists(current);
        if (!exists) {
            await app.vault.adapter.mkdir(current);
        }
    }
}

export function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'Document';
}

export function sanitizeTopicFolder(topic: string): string {
    return topic
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export interface ExtractedPdfData {
    text: string;
    totalPages: number;
    infoTitle?: string;
    infoAuthor?: string;
}

export async function extractPdfTextAndInfo(buffer: ArrayBuffer): Promise<ExtractedPdfData> {
    if (typeof globalThis !== 'undefined' && !(globalThis as any).pdfjsWorker) {
        (globalThis as any).pdfjsWorker = pdfjsWorker;
    }

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        let infoTitle: string | undefined;
        let infoAuthor: string | undefined;
        try {
            const infoRes = await parser.getInfo();
            if (infoRes?.info?.Title && typeof infoRes.info.Title === 'string') {
                infoTitle = infoRes.info.Title.trim();
            }
            if (infoRes?.info?.Author && typeof infoRes.info.Author === 'string') {
                infoAuthor = infoRes.info.Author.trim();
            }
        } catch {
            // Ignore metadata errors if PDF only has raw pages
        }

        const textRes = await parser.getText();
        return {
            text: (textRes?.text || '').trim(),
            totalPages: textRes?.total || 0,
            infoTitle,
            infoAuthor
        };
    } finally {
        await parser.destroy();
    }
}

export interface SaveAndIndexOptions {
    buffer: ArrayBuffer;
    filename: string;
    title?: string;
    authors?: string;
    subject?: string;
    topicFolder?: string;
    tags?: string[];
    summary?: string;
    sourceUrl?: string;
}

export interface SaveAndIndexResult {
    filePath: string;
    indexPath: string;
    title: string;
    authors: string;
    subject: string;
    topicFolder: string;
    totalPages: number;
    totalChars: number;
    textPreview: string;
}

export async function saveAndIndexDocument(
    app: App,
    options: SaveAndIndexOptions
): Promise<SaveAndIndexResult> {
    await ensureVaultFolder(app, LIBRARY_DIR);
    await ensureVaultFolder(app, LIBRARY_INDEX_DIR);

    const extMatch = options.filename.match(/\.(pdf|docx|md|txt)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'pdf';
    const rawBaseName = options.filename.replace(/\.(pdf|docx|md|txt)$/i, '');

    let extractedText = '';
    let totalPages = 1;
    let detectedTitle = options.title?.trim() || '';
    let detectedAuthors = options.authors?.trim() || '';

    if (ext === 'pdf') {
        const pdfData = await extractPdfTextAndInfo(options.buffer);
        extractedText = pdfData.text;
        totalPages = pdfData.totalPages;
        if (!detectedTitle && pdfData.infoTitle && pdfData.infoTitle.length > 2) {
            detectedTitle = pdfData.infoTitle;
        }
        if (!detectedAuthors && pdfData.infoAuthor && pdfData.infoAuthor.length > 1) {
            detectedAuthors = pdfData.infoAuthor;
        }
    } else if (ext === 'md' || ext === 'txt') {
        extractedText = new TextDecoder('utf-8').decode(options.buffer);
    }

    const finalTitle = detectedTitle || rawBaseName.replace(/_/g, ' ') || 'Untitled Document';
    const finalAuthors = detectedAuthors || 'Unknown';
    const topicFolder = options.topicFolder ? sanitizeTopicFolder(options.topicFolder) : '';
    const subject = (options.subject || topicFolder || 'general').toLowerCase().trim();

    const safeBase = sanitizeFileName(options.title || rawBaseName);
    const targetFolder = topicFolder ? `${LIBRARY_DIR}/${topicFolder}` : LIBRARY_DIR;
    await ensureVaultFolder(app, targetFolder);

    const filePath = `${targetFolder}/${safeBase}.${ext}`;
    await app.vault.adapter.writeBinary(filePath, options.buffer);

    const defaultTags = [
        subject.replace(/\s+/g, '-').replace(/[^a-z0-9-_]/gi, ''),
        ext
    ].filter(Boolean);
    const allTags = Array.from(new Set([...(options.tags || []), ...defaultTags]));

    const indexPath = `${LIBRARY_INDEX_DIR}/${safeBase}.md`;
    const indexMarkdown = buildIndexMarkdown({
        title: finalTitle,
        authors: finalAuthors,
        subject,
        topicFolder: topicFolder || 'Uncategorized',
        tags: allTags,
        type: ext.toUpperCase(),
        pages: totalPages,
        sourceUrl: options.sourceUrl || '',
        filePath,
        summary: options.summary || '*(Full text extracted automatically. Librarian can enrich this summary.)*',
        extractedText: extractedText || '*(No extractable text found in binary file.)*'
    });

    await app.vault.adapter.write(indexPath, indexMarkdown);

    return {
        filePath,
        indexPath,
        title: finalTitle,
        authors: finalAuthors,
        subject,
        topicFolder: topicFolder || 'Uncategorized',
        totalPages,
        totalChars: extractedText.length,
        textPreview: extractedText.substring(0, 6000)
    };
}

export interface IndexMarkdownFields {
    title: string;
    authors: string;
    subject: string;
    topicFolder: string;
    tags: string[];
    type: string;
    pages: number;
    sourceUrl: string;
    filePath: string;
    summary: string;
    extractedText: string;
}

export function buildIndexMarkdown(fields: IndexMarkdownFields): string {
    const tagLines = fields.tags.length > 0
        ? fields.tags.map(t => `  - ${t.replace(/^#/, '').trim()}`).join('\n')
        : '  - research';

    return [
        '---',
        `title: "${fields.title.replace(/"/g, '\\"')}"`,
        `authors: "${fields.authors.replace(/"/g, '\\"')}"`,
        `subject: "${fields.subject.toLowerCase()}"`,
        `topic_folder: "${fields.topicFolder.replace(/"/g, '\\"')}"`,
        'tags:',
        tagLines,
        `type: "${fields.type}"`,
        `pages: ${fields.pages}`,
        `source_url: "${fields.sourceUrl}"`,
        `file_path: "${fields.filePath}"`,
        `indexed_at: "${new Date().toISOString()}"`,
        '---',
        '',
        `# ${fields.title}`,
        '',
        `- **Original File**: [[${fields.filePath}|${fields.filePath.split('/').pop()}]]`,
        `- **Topic Folder**: ${fields.topicFolder}`,
        `- **Subject**: ${fields.subject}`,
        `- **Authors**: ${fields.authors}`,
        `- **Pages**: ${fields.pages}`,
        fields.sourceUrl ? `- **Source URL**: ${fields.sourceUrl}` : '',
        '',
        '## Summary & Key Takeaways',
        fields.summary.trim(),
        '',
        '## Extracted Full Text',
        fields.extractedText.trim()
    ].filter(line => line !== undefined).join('\n');
}

export function parseFrontmatter(mdContent: string): Record<string, any> {
    const match = mdContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const yaml = match[1];
    const result: Record<string, any> = {};
    const lines = yaml.split('\n');
    let currentListKey: string | null = null;

    for (const line of lines) {
        if (/^\s*-\s+(.+)$/.test(line) && currentListKey) {
            const val = line.replace(/^\s*-\s+/, '').trim();
            result[currentListKey].push(val);
            continue;
        }
        currentListKey = null;
        const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
        if (kv) {
            const key = kv[1];
            const rawVal = kv[2].trim();
            if (!rawVal) {
                currentListKey = key;
                result[key] = [];
            } else {
                result[key] = rawVal.replace(/^["']|["']$/g, '');
            }
        }
    }
    return result;
}

export function extractFullTextSection(mdContent: string): string {
    const marker = '## Extracted Full Text';
    const idx = mdContent.indexOf(marker);
    if (idx === -1) return '';
    return mdContent.slice(idx + marker.length).trim();
}

export async function listFilesRecursive(app: App, folderPath: string): Promise<string[]> {
    const exists = await app.vault.adapter.exists(folderPath);
    if (!exists) return [];
    const listed = await app.vault.adapter.list(folderPath);
    let results = [...listed.files];
    for (const sub of listed.folders) {
        const subFiles = await listFilesRecursive(app, sub);
        results = results.concat(subFiles);
    }
    return results;
}

export interface LibraryDocumentEntry {
    title: string;
    authors: string;
    subject: string;
    topicFolder: string;
    type: string;
    pages: number;
    filePath: string;
    indexPath: string;
    tags: string[];
}

export async function listLibraryCatalog(app: App): Promise<LibraryDocumentEntry[]> {
    await ensureVaultFolder(app, LIBRARY_DIR);
    await ensureVaultFolder(app, LIBRARY_INDEX_DIR);

    const entriesMap = new Map<string, LibraryDocumentEntry>();

    // 1. Read indexed markdown notes in DyResearch/Library Index
    const indexFiles = await listFilesRecursive(app, LIBRARY_INDEX_DIR);
    for (const idxPath of indexFiles) {
        if (!idxPath.endsWith('.md')) continue;
        try {
            const content = await app.vault.adapter.read(idxPath);
            const fm = parseFrontmatter(content);
            const baseName = idxPath.split('/').pop()!.replace(/\.md$/i, '');
            const filePath = fm.file_path || '';
            entriesMap.set(baseName.toLowerCase(), {
                title: fm.title || baseName.replace(/_/g, ' '),
                authors: fm.authors || 'Unknown',
                subject: fm.subject || 'general',
                topicFolder: fm.topic_folder || 'Uncategorized',
                type: fm.type || 'PDF',
                pages: Number(fm.pages) || 1,
                filePath,
                indexPath: idxPath,
                tags: Array.isArray(fm.tags) ? fm.tags : []
            });
        } catch {
            // Skip unreadable file
        }
    }

    // 2. Also discover any raw files in DyResearch/Library that might not have an index entry yet
    const rawFiles = await listFilesRecursive(app, LIBRARY_DIR);
    for (const rawPath of rawFiles) {
        const fileName = rawPath.split('/').pop() || '';
        if (fileName.startsWith('.')) continue;
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const key = baseName.toLowerCase();

        // Determine topic subfolder relative to DyResearch/Library
        const rel = rawPath.slice(LIBRARY_DIR.length + 1);
        const relParts = rel.split('/');
        const topicFolder = relParts.length > 1 ? relParts.slice(0, -1).join('/') : 'Uncategorized';
        const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';

        const existing = entriesMap.get(key);
        if (existing) {
            existing.filePath = rawPath;
            if (topicFolder !== 'Uncategorized') {
                existing.topicFolder = topicFolder;
            }
        } else {
            entriesMap.set(key, {
                title: baseName.replace(/_/g, ' '),
                authors: 'Unknown',
                subject: topicFolder.toLowerCase(),
                topicFolder,
                type: ext,
                pages: 1,
                filePath: rawPath,
                indexPath: '',
                tags: []
            });
        }
    }

    return Array.from(entriesMap.values());
}

