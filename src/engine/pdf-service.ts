import { App, loadPdfJs } from 'obsidian';

export const LIBRARY_DIR = 'DyResearch/Library';
export const LIBRARY_INDEX_DIR = 'DyResearch/Library Index';

export type DocumentKind = 'Paper' | 'Book' | 'Document';

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
        .replace(/[\\/:*?"<>|_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalizes a tag string into a valid Obsidian tag:
 * - Obsidian tags cannot contain spaces (must use hyphens, e.g. "large-language-models")
 * - Obsidian tags cannot contain special symbols (slashes, commas, colons, brackets, etc.)
 * - Strips leading '#'
 */
export function sanitizeTag(rawTag: string): string {
    return rawTag
        .replace(/^#+/, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9\-\/]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Cleans a single raw author name string:
 * - Removes footnote symbols (*, ∗, †, ‡, §, numbers) and emails
 * - Converts "Last, First" into "First Last"
 */
export function cleanSingleAuthorName(raw: string): string {
    let cleaned = raw
        .replace(/\S+@\S+\.\S+/g, '')
        .replace(/\bet\s+al\.?/gi, ' ')
        .replace(/[∗*†‡§¶∥#0-9]+/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleaned.includes(',')) {
        const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 2 && !/^(Jr\.?|Sr\.?|II|III|IV|Ph\.?D\.?|MD)$/i.test(parts[1])) {
            cleaned = `${parts[1]} ${parts[0]}`;
        }
    }

    return cleaned.replace(/^[,.\-\s]+|[,.\-\s]+$/g, '').trim();
}

function parseNameTokens(name: string): { first: string; middle: string[]; last: string } | null {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const first = parts[0].replace(/\./g, '').toLowerCase();
    const last = parts[parts.length - 1].replace(/\./g, '').toLowerCase();
    const middle = parts.slice(1, -1).map(m => m.replace(/\./g, '').toLowerCase());
    return { first, middle, last };
}

/**
 * Checks if two author names refer to the same person (e.g., "A. Vaswani" and "Ashish Vaswani",
 * or "A. N. Gomez" and "Aidan N. Gomez").
 */
export function areAuthorsEquivalent(nameA: string, nameB: string): boolean {
    const normA = nameA.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const normB = nameB.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (normA === normB) return true;

    const tokA = parseNameTokens(nameA);
    const tokB = parseNameTokens(nameB);
    if (!tokA || !tokB) return false;

    // Last names must match exactly
    if (tokA.last !== tokB.last) return false;

    // First name must match or one must be an initial of the other
    const firstMatch =
        tokA.first === tokB.first ||
        (tokA.first.length === 1 && tokB.first.startsWith(tokA.first)) ||
        (tokB.first.length === 1 && tokA.first.startsWith(tokB.first));
    if (!firstMatch) return false;

    // If both have middle tokens, their first initials must be compatible
    if (tokA.middle.length > 0 && tokB.middle.length > 0) {
        const mA = tokA.middle[0];
        const mB = tokB.middle[0];
        if (mA[0] !== mB[0]) return false;
    }

    return true;
}

/**
 * Normalizes and deduplicates a list or comma-separated string of author names
 * against the existing canonical authors in the Library Index.
 * Always prefers the fuller version of a name (e.g. "Ashish Vaswani" over "A. Vaswani").
 */
export function normalizeAndDeduplicateAuthors(
    rawAuthors: string | string[],
    existingCanonicalAuthors: string[] = []
): string {
    let rawList: string[];
    if (Array.isArray(rawAuthors)) {
        rawList = rawAuthors;
    } else if (/[;\n]/.test(rawAuthors)) {
        // Semicolon or newline delimited list (often contains "Last, First" entries)
        rawList = rawAuthors.split(/[;&\n]+/);
    } else {
        // Check if the entire string is a single "Last, First" author name
        const commaParts = rawAuthors.split(',').map(s => s.trim()).filter(Boolean);
        const isSingleLastFirst =
            commaParts.length === 2 &&
            !/\band\b/i.test(rawAuthors) &&
            commaParts[0].split(/\s+/).length === 1 &&
            commaParts[1].split(/\s+/).length <= 2;
        if (isSingleLastFirst) {
            rawList = [rawAuthors];
        } else {
            rawList = rawAuthors
                .replace(/\band\b/gi, ',')
                .split(/[,&\n]+/);
        }
    }

    const candidates = rawList
        .map(cleanSingleAuthorName)
        .filter(name => name.length >= 2 && !/^(unknown|et al\.?|others|n\/a)$/i.test(name));

    if (candidates.length === 0) return 'Unknown';

    const deduplicated: string[] = [];

    for (const candidate of candidates) {
        let bestName = candidate;

        // 1. Check against existing canonical authors in the vault
        for (const existing of existingCanonicalAuthors) {
            if (areAuthorsEquivalent(bestName, existing)) {
                // Prefer whichever name is more complete (longer without periods)
                const cleanCandidateLen = bestName.replace(/\./g, '').length;
                const cleanExistingLen = existing.replace(/\./g, '').length;
                bestName = cleanExistingLen >= cleanCandidateLen ? existing : bestName;
                break;
            }
        }

        // 2. Check against authors already added to this document's list
        const existingIdx = deduplicated.findIndex(already => areAuthorsEquivalent(bestName, already));
        if (existingIdx !== -1) {
            const already = deduplicated[existingIdx];
            if (bestName.replace(/\./g, '').length > already.replace(/\./g, '').length) {
                deduplicated[existingIdx] = bestName;
            }
        } else {
            deduplicated.push(bestName);
        }
    }

    return deduplicated.length > 0 ? deduplicated.join(', ') : 'Unknown';
}

/**
 * Matches a candidate topic folder against existing folders in DyResearch/Library
 * so we reuse existing folders (e.g., "Machine Learning" vs "machine-learning" or "Machine Learnings").
 */
export function resolveConsistentTopicFolder(
    candidateTopic: string,
    existingFolders: string[]
): string {
    const cleaned = sanitizeTopicFolder(candidateTopic);
    if (!cleaned || /^uncategorized$/i.test(cleaned)) return 'Uncategorized';

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
    const targetNorm = norm(cleaned);

    for (const folder of existingFolders) {
        if (!folder || /^uncategorized$/i.test(folder)) continue;
        if (norm(folder) === targetNorm) {
            return folder;
        }
    }

    // Title-case if creating a new folder
    return cleaned
        .split(' ')
        .map(w => w.length > 2 || w === cleaned.split(' ')[0]
            ? w.charAt(0).toUpperCase() + w.slice(1)
            : w.toLowerCase())
        .join(' ');
}

export interface ExtractedPdfData {
    text: string;
    totalPages: number;
    infoTitle?: string;
    infoAuthor?: string;
    inferredTitle?: string;
    inferredAuthors?: string;
    abstractText: string;
    sectionTitles: string[];
    conclusionsText: string;
}

const HEADER_BOILERPLATE_REGEX = /\b(copyright|isbn|issn|doi:|arxiv:|proceedings of|permission to|reproduce|attribution|hereby grants|all rights reserved|preprint|submitted to|published in|vol\.|volume \d+|issue \d+)\b/i;

const AFFILIATION_OR_NON_PERSON_REGEX = /\b(university|universit[aàäéèê]|institut[eo]?|department|faculty|center|centre|laboratory|labs?|research|foundation|academy|college|school|hospital|clinic|ministry|agency|association|society|corporation|inc\.|corp\.|ltd\.|llc|gmbh|group|division|team|abstract|introduction|contents|chapter|preface|copyright|isbn|issn|doi|arxiv|proceedings|conference|symposium|workshop|transactions|journal|volume|issue|preprint|submitted|published|permission|reproduce|attribution|hereby|grants|equal contribution)\b/i;

/**
 * Heuristically infers title and author names from the first page header block (before Abstract/Introduction).
 */
export function inferTitleAndAuthorsFromHeader(rawText: string): {
    inferredTitle?: string;
    inferredAuthors?: string;
} {
    const firstPage = rawText.split(/-- 1 of \d+ --/)[0] || rawText.slice(0, 3000);
    const beforeAbstract = firstPage.split(/(?:^|\n)\s*(?:Abstract|1\.?\s+Introduction|Contents|Table of Contents)\b/i)[0] || firstPage.slice(0, 1500);

    const lines = beforeAbstract
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 2 && !/@/.test(l) && !/^https?:\/\//i.test(l));

    // Filter out top boilerplate/permission lines when looking for the document title
    const cleanLines = lines.filter(l => !HEADER_BOILERPLATE_REGEX.test(l));

    let inferredTitle: string | undefined;
    let titleIdx = -1;
    for (let i = 0; i < Math.min(cleanLines.length, 6); i++) {
        const line = cleanLines[i];
        if (line.length >= 6 && line.length <= 140 && !/^\d+$/.test(line)) {
            inferredTitle = line.replace(/[∗*†‡]+$/g, '').trim();
            titleIdx = lines.indexOf(line);
            break;
        }
    }

    // Look for person-like names on the lines between the title and Abstract
    const authorCandidates: string[] = [];
    const startIdx = titleIdx !== -1 ? titleIdx + 1 : 1;
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        if (AFFILIATION_OR_NON_PERSON_REGEX.test(line)) continue;
        if (/@/.test(line)) continue;

        // Split line if multiple authors are separated by commas or "and"
        const segments = line
            .replace(/\band\b/gi, ',')
            .split(/[,;]+/)
            .map(cleanSingleAuthorName)
            .filter(Boolean);

        for (const seg of segments) {
            const words = seg.split(/\s+/);
            if (
                words.length >= 2 &&
                words.length <= 4 &&
                words.every(w => /^[A-ZŁŚŻŹĆŃÓÁÉÍÓÚÄÖÜ][a-zA-Z0-9.\-łśżźćńóáéíóúäöü']*$/.test(w)) &&
                !AFFILIATION_OR_NON_PERSON_REGEX.test(seg)
            ) {
                authorCandidates.push(seg);
            }
        }
    }

    return {
        inferredTitle,
        inferredAuthors: authorCandidates.length > 0 ? authorCandidates.join(', ') : undefined
    };
}

/**
 * Extracts structured sections (Abstract/Overview, Section/Chapter Titles, Conclusions, and inferred Title/Authors)
 */
export function parseAcademicStructure(rawText: string): {
    abstractText: string;
    sectionTitles: string[];
    conclusionsText: string;
    inferredTitle?: string;
    inferredAuthors?: string;
} {
    const cleanText = rawText.replace(/\r\n/g, '\n');

    // 1. Extract Abstract / Overview
    let abstractText = '';
    const absMatch = cleanText.match(/(?:^|\n)\s*(?:Abstract|Executive Summary|Overview|Preface)\s*\n([\s\S]{80,2500}?)(?=\n\s*(?:1\.?\s+Introduction|I\.?\s+Introduction|Chapter\s+1|Keywords|Index Terms|-- 1 of|\n\n\d+\s+[A-Z]))/i);
    if (absMatch) {
        abstractText = absMatch[1]
            .split('\n')
            .filter(line => !/^[∗†‡§]\s*(Equal contribution|Work performed|Corresponding author)/i.test(line.trim()))
            .filter(line => !/\b(Proceedings of|Conference on|Symposium on|Transactions on|arXiv:|DOI:)\b/i.test(line.trim()))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 2. Extract numbered section/chapter titles (e.g., "1 Introduction", "3.2.1 Scaled Dot-Product Attention", "Chapter 1: ...")
    const sectionTitles: string[] = [];
    const seenSections = new Set<string>();
    const lines = cleanText.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length < 4 || line.length > 90) continue;

        const chapMatch = line.match(/^(?:Chapter|Part|Section)\s+(\d+|[IVXLCDM]+)[:.\-\s]+([A-Z][A-Za-z0-9\s\-:,()]+)$/i);
        const secMatch = line.match(/^(\d+(?:\.\d+){0,2})\.?\s+([A-Z][A-Za-z0-9\s\-:,()]+)$/);

        if (chapMatch) {
            const heading = `Chapter ${chapMatch[1]}: ${chapMatch[2].trim()}`;
            const norm = heading.toLowerCase();
            if (!seenSections.has(norm)) {
                seenSections.add(norm);
                sectionTitles.push(heading);
            }
        } else if (secMatch) {
            const num = secMatch[1];
            const topNum = parseInt(num.split('.')[0], 10);
            if (topNum >= 1 && topNum <= 30) {
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
    const concMatch = cleanText.match(/(?:^|\n)\s*(?:\d+\.?\s+)?(?:Conclusions?|Summary and Conclusions|Concluding Remarks)(?:\s+and\s+Future\s+Work)?\s*\n([\s\S]{80,2500}?)(?=\n\s*(?:Acknowledgements?|Acknowledgments?|References|Bibliography|Appendix|-- \d+ of))/i);
    if (concMatch) {
        conclusionsText = concMatch[1]
            .replace(/\n-- \d+ of \d+ --\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const { inferredTitle, inferredAuthors } = inferTitleAndAuthorsFromHeader(cleanText);

    return {
        abstractText,
        sectionTitles,
        conclusionsText,
        inferredTitle,
        inferredAuthors
    };
}

export interface ExtractPdfOptions {
    /**
     * Maximum front pages to scan during initial indexing (default: 35).
     * For large books (> 45 pages), only the first `maxFrontPages` and last `maxBackPages`
     * are scanned during upload so 1000-page books index in under a second.
     */
    maxFrontPages?: number;
    maxBackPages?: number;
}

export async function extractPdfTextAndInfo(
    buffer: ArrayBuffer,
    options: ExtractPdfOptions = {}
): Promise<ExtractedPdfData> {
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

        // Extract embedded PDF bookmarks / outline (instantaneous on textbooks & papers)
        const outlineTitles: string[] = [];
        try {
            if (typeof doc.getOutline === 'function') {
                const outline = await doc.getOutline();
                const walkOutline = (items: any[], depth = 0) => {
                    if (!Array.isArray(items) || depth > 1) return;
                    for (const item of items) {
                        const title = typeof item?.title === 'string' ? item.title.replace(/\s+/g, ' ').trim() : '';
                        if (title && title.length >= 2 && title.length <= 110 && outlineTitles.length < 40) {
                            outlineTitles.push(title);
                        }
                        if (Array.isArray(item?.items) && item.items.length > 0) {
                            walkOutline(item.items, depth + 1);
                        }
                    }
                };
                walkOutline(outline);
            }
        } catch {
            // Ignore if PDF does not have an embedded outline
        }

        const totalPages = doc.numPages || 0;
        const maxFront = options.maxFrontPages ?? 35;
        const maxBack = options.maxBackPages ?? 10;

        const pagesToScan: number[] = [];
        if (totalPages <= maxFront + maxBack) {
            for (let p = 1; p <= totalPages; p++) pagesToScan.push(p);
        } else {
            for (let p = 1; p <= maxFront; p++) pagesToScan.push(p);
            for (let p = Math.max(maxFront + 1, totalPages - maxBack + 1); p <= totalPages; p++) {
                pagesToScan.push(p);
            }
        }

        const pageTexts: string[] = [];
        for (const pageNum of pagesToScan) {
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
        const mergedSections = outlineTitles.length > 0
            ? Array.from(new Set([...outlineTitles, ...structure.sectionTitles])).slice(0, 45)
            : structure.sectionTitles;

        return {
            text: fullText,
            totalPages,
            infoTitle,
            infoAuthor,
            inferredTitle: structure.inferredTitle,
            inferredAuthors: structure.inferredAuthors,
            abstractText: structure.abstractText,
            sectionTitles: mergedSections,
            conclusionsText: structure.conclusionsText
        };
    } finally {
        if (typeof doc.destroy === 'function') {
            await doc.destroy();
        }
    }
}

/**
 * Targeted on-demand PDF reader for the Professor agent:
 * - Reads a single page directly in O(1) without extracting the entire book, OR
 * - Searches pages incrementally for `sectionQuery` and stops once matching passages are found.
 */
export async function queryPdfPagesOnDemand(
    buffer: ArrayBuffer,
    query: { page?: number; sectionQuery?: string }
): Promise<string | null> {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument(buffer.slice(0));
    const doc = await loadingTask.promise;

    const readSinglePageText = async (pageNum: number): Promise<string> => {
        const page = await doc.getPage(pageNum);
        try {
            const textContent = await page.getTextContent();
            const items = textContent?.items || [];
            let pageStr = '';
            for (const item of items) {
                if ('str' in item) {
                    pageStr += item.str + (item.hasEOL ? '\n' : ' ');
                }
            }
            return pageStr.trim();
        } finally {
            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }
    };

    try {
        const totalPages = doc.numPages || 0;
        if (totalPages === 0) return null;

        if (typeof query.page === 'number' && query.page >= 1 && query.page <= totalPages) {
            const pageText = await readSinglePageText(query.page);
            return `### PDF Page ${query.page} of ${totalPages}:\n\n${pageText}`;
        }

        if (query.sectionQuery && query.sectionQuery.trim()) {
            const q = query.sectionQuery.toLowerCase().trim();
            const excerpts: string[] = [];

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                const pageText = await readSinglePageText(pageNum);
                const lower = pageText.toLowerCase();
                let pos = 0;
                while (excerpts.length < 6) {
                    const foundIdx = lower.indexOf(q, pos);
                    if (foundIdx === -1) break;
                    const start = Math.max(0, foundIdx - 300);
                    const end = Math.min(pageText.length, foundIdx + 1000);
                    excerpts.push(`[Page ${pageNum} of ${totalPages}]\n...\n${pageText.slice(start, end).trim()}\n...`);
                    pos = foundIdx + q.length + 500;
                }
                if (excerpts.length >= 6) break;
            }

            if (excerpts.length > 0) {
                return excerpts.join('\n\n---\n\n');
            }
        }

        return null;
    } finally {
        if (typeof doc.destroy === 'function') {
            await doc.destroy();
        }
    }
}

export async function getExistingLibraryTaxonomy(app: App): Promise<{
    topicFolders: string[];
    canonicalAuthors: string[];
}> {
    const catalog = await listLibraryCatalog(app);
    const folderSet = new Set<string>();
    const authorList: string[] = [];

    // Also inspect physical folders inside DyResearch/Library
    if (await app.vault.adapter.exists(LIBRARY_DIR)) {
        const listed = await app.vault.adapter.list(LIBRARY_DIR);
        for (const f of listed.folders) {
            const rel = f.slice(LIBRARY_DIR.length + 1);
            if (rel && !rel.startsWith('.') && !/^uncategorized$/i.test(rel)) {
                folderSet.add(rel);
            }
        }
    }

    for (const entry of catalog) {
        if (entry.topicFolder && !/^uncategorized$/i.test(entry.topicFolder)) {
            folderSet.add(entry.topicFolder);
        }
        if (entry.authors && entry.authors !== 'Unknown') {
            const split = entry.authors.split(',').map(a => cleanSingleAuthorName(a)).filter(Boolean);
            for (const a of split) {
                const existingIdx = authorList.findIndex(ex => areAuthorsEquivalent(a, ex));
                if (existingIdx !== -1) {
                    if (a.replace(/\./g, '').length > authorList[existingIdx].replace(/\./g, '').length) {
                        authorList[existingIdx] = a;
                    }
                } else {
                    authorList.push(a);
                }
            }
        }
    }

    return {
        topicFolders: Array.from(folderSet),
        canonicalAuthors: authorList
    };
}

export interface SaveAndIndexOptions {
    buffer: ArrayBuffer;
    filename: string;
    docKind?: DocumentKind;
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
    docKind: DocumentKind;
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

    const taxonomy = await getExistingLibraryTaxonomy(app);

    const extMatch = options.filename.match(/\.(pdf|docx|md|txt)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'pdf';
    const rawBaseName = options.filename.replace(/\.(pdf|docx|md|txt)$/i, '');
    const docKind: DocumentKind = options.docKind || 'Paper';

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
        if (!detectedTitle) {
            detectedTitle = (pdfData.infoTitle && pdfData.infoTitle.length > 2)
                ? pdfData.infoTitle
                : (pdfData.inferredTitle || '');
        }
        if (!detectedAuthors) {
            detectedAuthors = (pdfData.infoAuthor && pdfData.infoAuthor.length > 1)
                ? pdfData.infoAuthor
                : (pdfData.inferredAuthors || '');
        }
    } else if (ext === 'md' || ext === 'txt') {
        extractedText = new TextDecoder('utf-8').decode(options.buffer.slice(0));
        const structure = parseAcademicStructure(extractedText);
        abstractText = structure.abstractText;
        sectionTitles = structure.sectionTitles;
        conclusionsText = structure.conclusionsText;
        if (!detectedTitle && structure.inferredTitle) detectedTitle = structure.inferredTitle;
        if (!detectedAuthors && structure.inferredAuthors) detectedAuthors = structure.inferredAuthors;
    }

    const finalTitle = detectedTitle || rawBaseName.replace(/_/g, ' ') || 'Untitled Document';
    const finalAuthors = normalizeAndDeduplicateAuthors(detectedAuthors || 'Unknown', taxonomy.canonicalAuthors);
    const resolvedTopic = options.topicFolder
        ? resolveConsistentTopicFolder(options.topicFolder, taxonomy.topicFolders)
        : '';
    const subject = (options.subject || resolvedTopic || 'general').toLowerCase().trim();

    const safeBase = sanitizeFileName(finalTitle || rawBaseName);
    const targetFolder = (resolvedTopic && resolvedTopic !== 'Uncategorized')
        ? `${LIBRARY_DIR}/${resolvedTopic}`
        : LIBRARY_DIR;
    await ensureVaultFolder(app, targetFolder);

    const filePath = `${targetFolder}/${safeBase}.${ext}`;
    await writeVaultBinary(app, filePath, options.buffer);

    const defaultTags = [
        sanitizeTag(docKind),
        sanitizeTag(subject),
        sanitizeTag(ext)
    ].filter(Boolean);
    const cleanedInputTags = (options.tags || []).map(sanitizeTag).filter(Boolean);
    const allTags = Array.from(new Set([...cleanedInputTags, ...defaultTags]));

    const indexPath = `${LIBRARY_INDEX_DIR}/${safeBase}.md`;
    const indexMarkdown = buildIndexMarkdown({
        title: finalTitle,
        authors: finalAuthors,
        docKind,
        subject,
        topicFolder: resolvedTopic || 'Uncategorized',
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
        docKind,
        title: finalTitle,
        authors: finalAuthors,
        subject,
        topicFolder: resolvedTopic || 'Uncategorized',
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
    docKind?: DocumentKind;
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
 * Builds a clean, concise Library Index card tailored to the document kind (Paper, Book, Document)
 * without dumping raw pages of text.
 */
export function buildIndexMarkdown(fields: IndexMarkdownFields): string {
    const docKind: DocumentKind = fields.docKind || 'Paper';
    const cleanedTags = (fields.tags || []).map(sanitizeTag).filter(Boolean);
    const tagLines = cleanedTags.length > 0
        ? Array.from(new Set(cleanedTags)).map(t => `  - ${t}`).join('\n')
        : '  - research';

    const sectionsHeading = docKind === 'Book'
        ? '## Chapters & Table of Contents'
        : docKind === 'Document'
            ? '## Key Sections & Outline'
            : '## Section Titles';

    const abstractHeading = docKind === 'Book'
        ? '## Book Overview'
        : docKind === 'Document'
            ? '## Overview'
            : '## Abstract';

    const sectionsList = fields.sectionTitles && fields.sectionTitles.length > 0
        ? fields.sectionTitles.map(s => `- ${s}`).join('\n')
        : '- *(No numbered sections detected)*';

    const blocks: string[] = [
        '---',
        `title: "${fields.title.replace(/"/g, '\\"')}"`,
        `authors: "${fields.authors.replace(/"/g, '\\"')}"`,
        `doc_kind: "${docKind}"`,
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
        `- **Document Kind**: ${docKind}`,
        `- **Original File**: [[${fields.filePath}|${fields.filePath.split('/').pop()}]]`,
        `- **Topic Folder**: ${fields.topicFolder}`,
        `- **Subject**: ${fields.subject}`,
        `- **Authors**: ${fields.authors}`,
        `- **Pages**: ${fields.pages}`,
        fields.sourceUrl ? `- **Source URL**: ${fields.sourceUrl}` : '',
        ''
    ];

    if (fields.abstractText && fields.abstractText.trim()) {
        blocks.push(abstractHeading, fields.abstractText.trim(), '');
    }

    if (fields.summary && fields.summary.trim()) {
        blocks.push('## Summary & Key Takeaways', fields.summary.trim(), '');
    }

    blocks.push(sectionsHeading, sectionsList, '');

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
    docKind: DocumentKind;
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
                docKind: (fm.doc_kind as DocumentKind) || 'Paper',
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

        const existing = entriesMap.get(key) ||
            Array.from(entriesMap.values()).find(e =>
                e.filePath === rawPath ||
                (e.filePath && e.filePath.split('/').pop()?.toLowerCase() === fileName.toLowerCase())
            );
        if (existing) {
            let resolvedRawPath = rawPath;
            const idxBase = existing.indexPath
                ? existing.indexPath.split('/').pop()!.replace(/\.md$/i, '')
                : sanitizeFileName(existing.title);
            const rawExtMatch = fileName.match(/\.([^.]+)$/);
            const rawExt = rawExtMatch ? `.${rawExtMatch[1]}` : '';
            const desiredFileName = `${idxBase}${rawExt}`;
            const parentDir = rawPath.split('/').slice(0, -1).join('/');
            const desiredRawPath = `${parentDir}/${desiredFileName}`;

            if (idxBase && desiredRawPath !== rawPath && !(await app.vault.adapter.exists(desiredRawPath))) {
                try {
                    await moveVaultFile(app, rawPath, desiredRawPath);
                    resolvedRawPath = desiredRawPath;
                    if (existing.indexPath && await app.vault.adapter.exists(existing.indexPath)) {
                        const md = await app.vault.adapter.read(existing.indexPath);
                        const updatedMd = md
                            .replace(`file_path: "${existing.filePath}"`, `file_path: "${desiredRawPath}"`)
                            .replace(`file_path: "${rawPath}"`, `file_path: "${desiredRawPath}"`)
                            .replace(`[[${existing.filePath}|${fileName}]]`, `[[${desiredRawPath}|${desiredFileName}]]`)
                            .replace(`[[${rawPath}|${fileName}]]`, `[[${desiredRawPath}|${desiredFileName}]]`);
                        if (updatedMd !== md) {
                            await app.vault.adapter.write(existing.indexPath, updatedMd);
                        }
                    }
                } catch {
                    // Keep original path if rename fails
                }
            }

            existing.filePath = resolvedRawPath;
            if (topicFolder !== 'Uncategorized') {
                existing.topicFolder = topicFolder;
            }
        } else {
            entriesMap.set(key, {
                title: baseName.replace(/_/g, ' '),
                authors: 'Unknown',
                docKind: 'Paper',
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
