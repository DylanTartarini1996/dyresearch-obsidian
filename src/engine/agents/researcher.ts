import { LlmAgent } from '@google/adk';

interface AgentConfig {
    model: string;
    provider: string;
    apiKey: string;
}

import { getResearchTools } from '../tools/search';

export function createResearcherAgent(config: AgentConfig, app: any): LlmAgent {
    const tools = getResearchTools(app) as any[];

    return new LlmAgent({
        name: 'researcher_agent',
        model: config.model,
        description: 'Web search and data acquisition specialist. Call this agent to search the internet, find alternative perspectives, scrape information from specific websites (like Arxiv or Reddit), or download PDFs and documents.',
        instruction:
            "You are the Lead Researcher of the DyResearch Team. Your mission is to scour the internet for high-quality information, " +
                      "papers, and articles to expand the user's knowledge base.\n\n" +
                      
                      "### PHASE 1: QUERY EXPANSION & SEARCH\n" +
                      "1. Lateral Thinking: Run multiple varied queries using `web_search` to ensure you get a broad perspective.\n" +
                      "2. Domain Scoping: Target your searches to high-quality domains based on the user's request (e.g., arxiv.org, wikipedia.org, medium.com).\n\n" +
                      
                      "### PHASE 2: ACQUISITION (THE SCRAPER & DOWNLOADER)\n" +
                      "1. Static Files: If you find a direct link to a PDF or document, use `download_document`.\n" +
                      "2. Web Articles: If the information is on a standard webpage (like a blog or wiki), use `scrape_website` to read the content.\n" +
                      "3. Limit Reading: Do not attempt to scrape more than 3 URLs per request to save time.\n\n" +
                      
                      "### PHASE 3: HANDOFF\n" +
                      "When you have extracted the text or downloaded the files, present your findings clearly. " +
                      "If you scraped a website, provide a brief summary of the text and offer to hand the full text over to the Librarian for ingestion. " +
                      "ALWAYS include the source URLs.",
        tools: tools
    });
}
