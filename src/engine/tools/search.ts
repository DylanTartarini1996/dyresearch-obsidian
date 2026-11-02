import { App, requestUrl } from 'obsidian';
import { FunctionTool } from '@google/adk';
import { saveAndIndexDocument, sanitizeFileName } from '../pdf-service';

export function getResearchTools(app: App) {
    return [
        new FunctionTool({
            name: 'web_search',
            description: 'Performs a web search to find information online. Provide a query.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    query: { type: 'STRING' as any, description: 'Search query.' }
                },
                required: ['query']
            },
            execute: async (args: any) => {
                const query = args.query;
                if (!query) return "Error: query is required.";
                try {
                    const response = await requestUrl(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
                    const text = response.text;
                    const results = [];
                    const matches = text.matchAll(/<a class="result-url" href="([^"]+)">([^<]+)<\/a>.*?<td class="result-snippet">([^<]+)<\/td>/gs);
                    for (const match of matches) {
                        results.push(`URL: ${match[1]}\nTitle: ${match[2]}\nSnippet: ${match[3]}\n`);
                    }
                    return results.length > 0 ? results.slice(0, 5).join('\n') : "No direct results parsed, but search executed.";
                } catch (e) {
                    return `Search failed: ${e}`;
                }
            }
        }),
        new FunctionTool({
            name: 'scrape_website',
            description: 'Scrapes the text content from a given webpage URL.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    url: { type: 'STRING' as any, description: 'Full URL of the webpage to scrape.' }
                },
                required: ['url']
            },
            execute: async (args: any) => {
                const url = args.url;
                if (!url) return "Error: url is required.";
                try {
                    const response = await requestUrl(url);
                    let text = response.text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
                    text = text.replace(/<[^>]+>/g, ' ');
                    text = text.replace(/\s+/g, ' ').trim();
                    return text.substring(0, 6000) + (text.length > 6000 ? '...' : '');
                } catch (e) {
                    return `Scraping failed: ${e}`;
                }
            }
        }),
        new FunctionTool({
            name: 'download_document',
            description: 'Downloads a binary document (such as a PDF from arXiv or the web), saves the original PDF in DyResearch/Library/<Topic>/, extracts all pages of text using the local PDF parser, and creates an indexed Markdown note in DyResearch/Library Index/.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    url: { type: 'STRING' as any, description: 'Direct URL to the PDF or document (e.g. https://arxiv.org/pdf/1706.03762.pdf).' },
                    title: { type: 'STRING' as any, description: 'Clean human-readable title for the document (e.g. "Attention Is All You Need").' },
                    topic_folder: { type: 'STRING' as any, description: 'Optional topic subfolder in Library (e.g. "Machine Learning", "Game Theory").' },
                    authors: { type: 'STRING' as any, description: 'Optional author names if known.' }
                },
                required: ['url']
            },
            execute: async (args: any) => {
                let targetUrl: string = (args.url || '').trim();
                if (!targetUrl) return "Error: url is required.";

                // Automatically normalize arXiv abstract links to PDF links
                const arxivAbsMatch = targetUrl.match(/^https?:\/\/arxiv\.org\/abs\/([^\s/?#]+)/i);
                if (arxivAbsMatch) {
                    targetUrl = `https://arxiv.org/pdf/${arxivAbsMatch[1]}.pdf`;
                }

                try {
                    const response = await requestUrl({ url: targetUrl, method: 'GET' });
                    const buffer = response.arrayBuffer;
                    if (!buffer || buffer.byteLength === 0) {
                        return `Error: Downloaded empty response from ${targetUrl}`;
                    }

                    // Derive filename from title or URL
                    const urlFilePart = targetUrl.split('?')[0].split('/').pop() || 'document.pdf';
                    const ext = urlFilePart.match(/\.(pdf|docx|md|txt)$/i)?.[1]?.toLowerCase() || 'pdf';
                    const baseTitle = args.title ? sanitizeFileName(args.title) : sanitizeFileName(urlFilePart.replace(/\.[^.]+$/, ''));
                    const filename = `${baseTitle}.${ext}`;

                    const saved = await saveAndIndexDocument(app, {
                        buffer,
                        filename,
                        title: args.title,
                        authors: args.authors,
                        topicFolder: args.topic_folder,
                        subject: args.topic_folder?.toLowerCase(),
                        sourceUrl: targetUrl
                    });

                    return JSON.stringify({
                        status: 'success',
                        message: `Successfully downloaded PDF (${saved.totalPages} pages, ${saved.totalChars} characters) and indexed full text.`,
                        file_path: saved.filePath,
                        index_path: saved.indexPath,
                        title: saved.title,
                        authors: saved.authors,
                        topic_folder: saved.topicFolder,
                        total_pages: saved.totalPages,
                        total_characters: saved.totalChars,
                        extracted_text_preview: saved.textPreview
                    }, null, 2);
                } catch (e: any) {
                    return `Failed to download or parse document from ${targetUrl}: ${e?.message || e}`;
                }
            }
        })
    ];
}
