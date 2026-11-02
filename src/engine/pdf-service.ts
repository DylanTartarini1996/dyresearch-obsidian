import { App, loadPdfJs } from 'obsidian';

export const LIBRARY_DIR = 'DyResearch/Library';
export const LIBRARY_INDEX_DIR = 'DyResearch/Library Index';

export async function ensureVaultFolder(app: App, folderPath: string) {
    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const exists = await app.vault.adapter.exists(current);
        if (!exists) {
            if (typeof (app.vault as any).createFolder === 'function') {
                try {
                    await (app.vault as any).createFolder(current);
                } catch {
                    await app.vault.adapter.mkdir(current);
                }
            } else {
                await app.vault.adapter.mkdir(current);
            }
        }
    }
}

export async function writeVaultBinary(app: App, filePath: string, buffer: ArrayBuffer) {
    const copy = buffer.slice(0);
    if (typeof (app.vault as any).getAbstractFileByPath === 'function') {
        const existing = (app.vault as any).getAbstractFileByPath(filePath);
        if (existing && typeof (app.vault as any).modifyBinary === 'function') {
            await (app.vault as any).modifyBinary(existing, copy);
            return;
        }
        if (!existing && typeof (app.vault as any).createBinary === 'function') {
            try {
                await (app.vault as any).createBinary(filePath, copy);
                return;
            } catch {
                // Fall back to adapter if file exists on disk but not yet in cache
            }
        }
    }
    await app.vault.adapter.writeBinary(filePath, copy);
}

export async function moveVaultFile(app: App, oldPath: string, newPath: string) {
    if (oldPath === newPath) return;
    if (typeof (app.vault as any).getAbstractFileByPath === 'function' && typeof (app.vault as any).rename === 'function') {
        const existing = (app.vault as any).getAbstractFileByPath(oldPath);
        if (existing) {
            try {
                await (app.vault as any).rename(existing, newPath);
                return;
            } catch {
                // Fall back to adapter copy + remove
            }
        }
    }
    const bin = await app.vault.adapter.readBinary(oldPath);
    await writeVaultBinary(app, newPath, bin);
    await app.vault.adapter.remove(oldPath);
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
    abstractText: string;
    sectionTitles: string[];
    conclusionsText: string;
}

/**
 * Extracts structured academic sections (Abstract, Section Titles, Conclusions) from raw PDF text.
 */
export function parseAcademicStructure(rawText: string): {
    abstractText: string;
    sectionTitles: string[];
    conclusionsText: string;
} {
    const cleanText = rawText.replace(/\r\n/g, '\n');

    // 1. Extract Abstract
    let abstractText = '';
    const absMatch = cleanText.match(/(?:^|\n)\s*Abstract\s*\n([\s\S]{80,2500}?)(?=\n\s*(?:1\.?\s+Introduction|I\.?\s+Introduction|Keywords|Index Terms|-- 1 of|\n\n\d+\s+[A-Z]))/i);
    if (absMatch) {
        abstractText = absMatch[1]
            .split('\n')
            .filter(line => !/^[∗†‡]\s*(Equal contribution|Work performed)/i.test(line.trim()))
            .filter(line => !/Conference on Neural Information Processing|arXiv:/i.test(line.trim()))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 2. Extract numbered section and subsection titles (e.g., "1 Introduction", "3.2.1 Scaled Dot-Product Attention")
    const sectionTitles: string[] = [];
    const seenSections = new Set<string>();
    const lines = cleanText.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length < 4 || line.length > 85) continue;
        const secMatch = line.match(/^(\d+(?:\.\d+){0,2})\.?\s+([A-Z][A-Za-z0-9\s\-:,()]+)$/);
        if (secMatch) {
            const num = secMatch[1];
            const topNum = parseInt(num.split('.')[0], 10);
            if (topNum >= 1 && topNum <= 20) {
                const heading = `${num} ${secMatch[2].trim()}`;
                const norm = heading.toLowerCase();
                if (!seenSections.has(norm)) {
                    seenSections.add(norm);
                    sectionTitles.push(heading);
                }
            }
        }
    }

    // 3. Extract Conclusions
    let conclusionsText = '';
    const concMatch = cleanText.match(/(?:^|\n)\s*(?:\d+\.?\s+)?Conclusions?(?:\s+and\s+Future\s+Work)?\s*\n([\s\S]{80,2500}?)(?=\n\s*(?:Acknowledgements?|Acknowledgments?|References|Bibliography|Appendix|-- \d+ of))/i);
    if (concMatch) {
        conclusionsText = concMatch[1]
            .replace(/\n-- \d+ of \d+ --\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return {
        abstractText,
        sectionTitles,
        conclusionsText
    };
}

export async function extractPdfTextAndInfo(buffer: ArrayBuffer): Promise<ExtractedPdfData> {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument(buffer.slice(0));
    const doc = await loadingTask.promise;

    try {
        let infoTitle: string | undefined;
        let infoAuthor: string | undefined;
        try {
            const meta = await doc.getMetadata();
            if (meta?.info?.Title && typeof meta.info.Title === 'string') {
                infoTitle = meta.info.Title.trim();
            }
            if (meta?.info?.Author && typeof meta.info.Author === 'string') {
                infoAuthor = meta.info.Author.trim();
            }
        } catch {
            // Ignore metadata errors if PDF only has raw pages
        }

        const totalPages = doc.numPages || 0;
        const pageTexts: string[] = [];

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await doc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const items = textContent?.items || [];
            let pageStr = '';
            for (const item of items) {
                if ('str' in item) {
                    pageStr += item.str + (item.hasEOL ? '\n' : ' ');
                }
            }
            pageTexts.push(`${pageStr.trim()}\n-- ${pageNum} of ${totalPages} --`);
            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }

        const fullText = pageTexts.join('\n\n').trim();
        const structure = parseAcademicStructure(fullText);

        return {
            text: fullText,
            totalPages,
            infoTitle,
            infoAuthor,
            abstractText: structure.abstractText,
            sectionTitles: structure.sectionTitles,
            conclusionsText: structure.conclusionsText
        };
    } finally {
        if (typeof doc.destroy === 'function') {
            await doc.destroy();
        }
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
    abstractText: string;
    sectionTitles: string[];
    conclusionsText: string;
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
    let abstractText = '';
    let sectionTitles: string[] = [];
    let conclusionsText = '';

    if (ext === 'pdf') {
        const pdfData = await extractPdfTextAndInfo(options.buffer.slice(0));
        extractedText = pdfData.text;
        totalPages = pdfData.totalPages;
        abstractText = pdfData.abstractText;
        sectionTitles = pdfData.sectionTitles;
        conclusionsText = pdfData.conclusionsText;
        if (!detectedTitle && pdfData.infoTitle && pdfData.infoTitle.length > 2) {
            detectedTitle = pdfData.infoTitle;
        }
        if (!detectedAuthors && pdfData.infoAuthor && pdfData.infoAuthor.length > 1) {
            detectedAuthors = pdfData.infoAuthor;
        }
    } else if (ext === 'md' || ext === 'txt') {
        extractedText = new TextDecoder('utf-8').decode(options.buffer.slice(0));
        const structure = parseAcademicStructure(extractedText);
        abstractText = structure.abstractText;
        sectionTitles = structure.sectionTitles;
        conclusionsText = structure.conclusionsText;
    }

    const finalTitle = detectedTitle || rawBaseName.replace(/_/g, ' ') || 'Untitled Document';
    const finalAuthors = detectedAuthors || 'Unknown';
    const topicFolder = options.topicFolder ? sanitizeTopicFolder(options.topicFolder) : '';
    const subject = (options.subject || topicFolder || 'general').toLowerCase().trim();

    const safeBase = sanitizeFileName(options.title || rawBaseName);
    const targetFolder = topicFolder ? `${LIBRARY_DIR}/${topicFolder}` : LIBRARY_DIR;
    await ensureVaultFolder(app, targetFolder);

    const filePath = `${targetFolder}/${safeBase}.${ext}`;
    await writeVaultBinary(app, filePath, options.buffer);

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
        abstractText,
        sectionTitles,
        summary: options.summary || '',
        conclusionsText
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
        abstractText,
        sectionTitles,
        conclusionsText,
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
    abstractText?: string;
    sectionTitles?: string[];
    summary?: string;
    conclusionsText?: string;
}

/**
 * Builds a clean, concise Library Index card (Metadata, Abstract, Section Titles, Summary, Conclusions, Tags)
 * without dumping raw pages of text.
 */
export function buildIndexMarkdown(fields: IndexMarkdownFields): string {
    const tagLines = fields.tags.length > 0
        ? fields.tags.map(t => `  - ${t.replace(/^#/, '').trim()}`).join('\n')
        : '  - research';

    const sectionsList = fields.sectionTitles && fields.sectionTitles.length > 0
        ? fields.sectionTitles.map(s => `- ${s}`).join('\n')
        : '- *(No numbered sections detected)*';

    const blocks: string[] = [
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
        ''
    ];

    if (fields.abstractText && fields.abstractText.trim()) {
        blocks.push('## Abstract', fields.abstractText.trim(), '');
    }

    if (fields.summary && fields.summary.trim()) {
        blocks.push('## Summary & Key Takeaways', fields.summary.trim(), '');
    }

    blocks.push('## Section Titles', sectionsList, '');

    if (fields.conclusionsText && fields.conclusionsText.trim()) {
        blocks.push('## Conclusions', fields.conclusionsText.trim(), '');
    }

    return blocks.filter(line => line !== undefined).join('\n').trim() + '\n';
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

export function extractMarkdownSection(mdContent: string, heading: string): string {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
    const m = mdContent.match(regex);
    return m ? m[1].trim() : '';
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

    const rawFiles = await listFilesRecursive(app, LIBRARY_DIR);
    for (const rawPath of rawFiles) {
        const fileName = rawPath.split('/').pop() || '';
        if (fileName.startsWith('.')) continue;
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const key = baseName.toLowerCase();

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
