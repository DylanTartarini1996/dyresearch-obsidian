import { App, requestUrl } from 'obsidian';
import { FunctionTool } from '@google/adk';

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
                // DuckDuckGo Lite HTML search as a simple free proxy
                try {
                    const response = await requestUrl(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
                    // Extremely basic regex to grab title and snippet from DuckDuckGo HTML
                    const text = response.text;
                    const results = [];
                    const matches = text.matchAll(/<a class="result-url" href="([^"]+)">([^<]+)<\/a>.*?<td class="result-snippet">([^<]+)<\/td>/gs);
                    for (const match of matches) {
                        results.push(`URL: ${match[1]}\nTitle: ${match[2]}\nSnippet: ${match[3]}\n`);
                    }
                    return results.length > 0 ? results.slice(0, 3).join('\n') : "No direct results parsed, but search executed.";
                } catch (e) {
                    return `Search failed: ${e}`;
                }
            }
        }),
        new FunctionTool({
            name: 'scrape_website',
            description: 'Scrapes the text content from a given URL.',
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
                    // Extremely basic strip of HTML tags to get text
                    let text = response.text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
                    text = text.replace(/<[^>]+>/g, ' ');
                    text = text.replace(/\s+/g, ' ').trim();
                    return text.substring(0, 4000) + '...'; // Limit to 4000 chars to avoid blowing up context window
                } catch (e) {
                    return `Scraping failed: ${e}`;
                }
            }
        }),
        new FunctionTool({
            name: 'download_document',
            description: 'Downloads a document (like a PDF) from a direct URL.',
            parameters: {
                type: 'OBJECT' as any,
                properties: {
                    url: { type: 'STRING' as any, description: 'Direct URL to the document.' }
                },
                required: ['url']
            },
            execute: async (args: any) => {
                const url = args.url;
                return `Downloaded document from ${url} (Mocked - binary download requires external PDF parser integration).`;
            }
        })
    ];
}
