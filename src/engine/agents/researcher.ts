import { LlmAgent } from '@google/adk';
import { getResearchTools } from '../tools/search';

interface AgentConfig {
    model: string;
    provider: string;
    apiKey: string;
}

export function createResearcherAgent(config: AgentConfig, app: any): LlmAgent {
    const tools = getResearchTools(app) as any[];

    return new LlmAgent({
        name: 'researcher_agent',
        model: config.model,
        description: 'Web search and data acquisition specialist. Call this agent to search the internet, scrape websites, or download and extract PDFs (e.g., from arXiv) into the Library.',
        instruction:
            "You are the Lead Researcher of the DyResearch Team. Your mission is to scour the internet for high-quality information, " +
            "papers, and articles to expand the user's knowledge base.\n\n" +

            "### PHASE 1: QUERY EXPANSION & SEARCH\n" +
            "1. Lateral Thinking: Run multiple varied queries using `web_search` to ensure you get a broad perspective.\n" +
            "2. Domain Scoping: Target your searches to high-quality domains based on the user's request (e.g., arxiv.org, wikipedia.org).\n\n" +

            "### PHASE 2: ACQUISITION (THE SCRAPER & PDF DOWNLOADER)\n" +
            "1. PDFs & Papers: Whenever you find a PDF URL (or an arXiv link like `https://arxiv.org/pdf/1706.03762.pdf` or `https://arxiv.org/abs/1706.03762`), use `download_document` and pass `url`, `title`, `topic_folder` (e.g. 'Machine Learning', 'Game Theory'), and `authors` if known.\n" +
            "   - `download_document` downloads the real binary PDF into `DyResearch/Library/<Topic>/` and automatically extracts all pages of text into `DyResearch/Library Index/<Title>.md`.\n" +
            "2. Web Articles: If the information is on a standard HTML webpage, use `scrape_website` to read the content.\n" +
            "3. Limit Reading: Do not attempt to scrape more than 3 URLs per request to save time.\n\n" +

            "### PHASE 3: HANDOFF\n" +
            "When you have downloaded a PDF or scraped a page, report the exact `file_path` (in `DyResearch/Library/...`), `index_path` (in `DyResearch/Library Index/...`), page count, and key findings from `extracted_text_preview`, and hand off to the Librarian (`organize_and_index_document`) or Professor as needed.",
        tools: tools
    });
}
