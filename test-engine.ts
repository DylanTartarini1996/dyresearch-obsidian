import assert from 'node:assert';
import { createEvent } from '@google/adk';
import { DyResearchEngine } from './src/engine/engine';
import {
    saveAndIndexDocument,
    listLibraryCatalog,
    normalizeAndDeduplicateAuthors,
    resolveConsistentTopicFolder,
    sanitizeTag
} from './src/engine/pdf-service';
import { getLibrarianTools } from './src/engine/tools/library';
import { getTeachingTools } from './src/engine/tools/teaching';
import { getNoteTakingTools, sanitizeMermaidBlocks } from './src/engine/tools/notes';
import { createConfiguredLlm, OpenAiLlm, AnthropicLlm, toStandardJsonSchema } from './src/engine/llm-providers';

const files = new Map<string, string>();
const binaryFiles = new Map<string, ArrayBuffer>();
const dirs = new Set<string>();

const mockApp = {
    vault: {
        getMarkdownFiles: () => [...files.keys()].map(p => ({ path: p })),
        read: async (f: { path: string }) => files.get(f.path) || '',
        adapter: {
            exists: async (p: string) => dirs.has(p) || files.has(p) || binaryFiles.has(p),
            mkdir: async (p: string) => { dirs.add(p); },
            write: async (p: string, c: string) => { files.set(p, c); },
            writeBinary: async (p: string, b: ArrayBuffer) => {
                // Mirror Obsidian's native writeBinary which constructs a Uint8Array from the ArrayBuffer
                const view = new Uint8Array(b);
                binaryFiles.set(p, view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
            },
            read: async (p: string) => files.get(p) || '',
            readBinary: async (p: string) => binaryFiles.get(p) || new ArrayBuffer(0),
            remove: async (p: string) => { files.delete(p); binaryFiles.delete(p); },
            list: async (p: string) => {
                const allKeys = [...files.keys(), ...binaryFiles.keys()];
                const directFiles = allKeys.filter(k => {
                    if (!k.startsWith(p + '/')) return false;
                    const rest = k.slice(p.length + 1);
                    return !rest.includes('/');
                });
                const subFolders = [...dirs].filter(d => {
                    if (!d.startsWith(p + '/')) return false;
                    const rest = d.slice(p.length + 1);
                    return rest.length > 0 && !rest.includes('/');
                });
                return {
                    files: directFiles,
                    folders: subFolders
                };
            }
        }
    }
} as any;

const mockPlugin = {
    settings: {
        apiKeys: { gemini: 'test-key', openai: '', anthropic: '' },
        agents: {
            coordinator: { provider: 'gemini', model: 'gemini-2.5-flash' },
            professor: { provider: 'gemini', model: 'gemini-2.5-flash' },
            librarian: { provider: 'gemini', model: 'gemini-2.5-flash' },
            researcher: { provider: 'gemini', model: 'gemini-2.5-flash' },
            notetaker: { provider: 'gemini', model: 'gemini-2.5-flash' }
        }
    }
} as any;

(async () => {
    const engine = new DyResearchEngine(mockApp, mockPlugin);
    engine.initialize();
    const session = await engine.ensureSession('test_session_1');
    assert.strictEqual(session.id, 'test_session_1');
    assert.ok(dirs.has('DyResearch') && dirs.has('DyResearch/Sessions'));
    assert.ok(files.has('DyResearch/Sessions/test_session_1.md'));

    // Append user & model events to verify bot memory persists after renaming
    await engine.sessionService.appendEvent({
        session,
        event: createEvent({
            invocationId: 'inv_1',
            author: 'user',
            content: { role: 'user', parts: [{ text: 'Remember the secret code: 42-Alpha' }] }
        })
    });
    await engine.sessionService.appendEvent({
        session,
        event: createEvent({
            invocationId: 'inv_1',
            author: 'coordinator_agent',
            content: { role: 'model', parts: [{ text: 'I will remember 42-Alpha.' }] }
        })
    });

    const renamedId = await engine.renameSession('test_session_1', 'renamed_session');
    assert.strictEqual(renamedId, 'renamed_session');
    assert.ok(files.has('DyResearch/Sessions/renamed_session.md'));
    assert.ok(!files.has('DyResearch/Sessions/test_session_1.md'));

    // Verify in-flight session reference and newly loaded session both retain full conversation memory
    assert.strictEqual(session.id, 'renamed_session');
    assert.strictEqual(session.events.length, 2);

    const reloadedSession = await engine.ensureSession('renamed_session');
    assert.strictEqual(reloadedSession.id, 'renamed_session');
    assert.strictEqual(reloadedSession.events.length, 2);
    assert.strictEqual((reloadedSession.events[0] as any).content.parts[0].text, 'Remember the secret code: 42-Alpha');

    // Verify manual .md file rename in Obsidian's file tree also preserves session ID and memory
    const mdContent = files.get('DyResearch/Sessions/renamed_session.md')!;
    files.set('DyResearch/Sessions/Manually_Renamed_Chat.md', mdContent);
    files.delete('DyResearch/Sessions/renamed_session.md');

    const listed = await engine.getSessions();
    assert.strictEqual(listed.sessions.length, 1);
    assert.strictEqual(listed.sessions[0].id, 'Manually_Renamed_Chat');
    assert.strictEqual(listed.sessions[0].events.length, 2);
    console.log("All session markdown and memory persistence checks passed.");

    // Test PDF save + parse + index
    const minPdf = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj\n4 0 obj<</Length 58>>stream\nBT /F1 12 Tf 100 700 Td (Scaled Dot-Product Attention Formula) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000248 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n356\n%%EOF",
        "utf-8"
    );
    const pdfArrayBuf = minPdf.buffer.slice(minPdf.byteOffset, minPdf.byteOffset + minPdf.byteLength);

    const saved = await saveAndIndexDocument(mockApp, {
        buffer: pdfArrayBuf,
        filename: 'Attention_Is_All_You_Need.pdf',
        title: 'Attention Is All You Need',
        authors: 'Vaswani et al.',
        sourceUrl: 'https://arxiv.org/pdf/1706.03762.pdf'
    });

    assert.strictEqual(saved.filePath, 'DyResearch/Library/Attention_Is_All_You_Need.pdf');
    assert.strictEqual(saved.indexPath, 'DyResearch/Library Index/Attention_Is_All_You_Need.md');
    assert.ok(binaryFiles.has('DyResearch/Library/Attention_Is_All_You_Need.pdf'));
    assert.ok(files.has('DyResearch/Library Index/Attention_Is_All_You_Need.md'));
    assert.ok(!files.get('DyResearch/Library Index/Attention_Is_All_You_Need.md')!.includes('## Extracted Full Text'));

    // Test Librarian organizing PDF into "Machine Learning" subfolder & writing clean index card
    const libTools = getLibrarianTools(mockApp);
    const organizeTool = libTools.find(t => t.name === 'organize_and_index_document')!;
    await (organizeTool as any).execute({
        title: 'Attention Is All You Need',
        topic_folder: 'Machine Learning',
        subject: 'machine learning',
        author: 'Ashish Vaswani et al.',
        tags: ['transformers', 'attention'],
        abstract: 'We propose a new simple network architecture, the Transformer.',
        section_titles: ['1 Introduction', '2 Background', '3 Model Architecture'],
        summary: 'Introduces the Transformer architecture based solely on attention mechanisms.',
        conclusions: 'The Transformer achieves state-of-the-art translation performance.'
    });

    assert.ok(binaryFiles.has('DyResearch/Library/Machine Learning/Attention_Is_All_You_Need.pdf'));
    assert.ok(!binaryFiles.has('DyResearch/Library/Attention_Is_All_You_Need.pdf'));
    const updatedIndexMd = files.get('DyResearch/Library Index/Attention_Is_All_You_Need.md')!;
    assert.ok(updatedIndexMd.includes('Introduces the Transformer architecture'));
    assert.ok(updatedIndexMd.includes('## Abstract'));
    assert.ok(updatedIndexMd.includes('## Section Titles'));
    assert.ok(updatedIndexMd.includes('## Conclusions'));
    assert.ok(!updatedIndexMd.includes('## Extracted Full Text'));

    // Test Professor searching index and reading specific passage from the linked PDF on the fly
    const profTools = getTeachingTools(mockApp);
    const searchKbTool = profTools.find(t => t.name === 'search_knowledge_base')!;
    const searchRes = await (searchKbTool as any).execute({
        query: 'Transformer',
        subject_filter: 'machine learning',
        doc_kind_filter: 'Paper',
        author_filter: 'A. Vaswani'
    });
    assert.ok(searchRes.includes('Attention_Is_All_You_Need.md'));

    const searchWrongKind = await (searchKbTool as any).execute({
        doc_kind_filter: 'Book'
    });
    assert.ok(searchWrongKind.includes('No matching documents found'));

    const readLibTool = profTools.find(t => t.name === 'read_library_document')!;
    const readRes = await (readLibTool as any).execute({
        path_or_title: 'Attention Is All You Need',
        section_query: 'Scaled Dot-Product'
    });
    assert.ok(readRes.includes('Scaled Dot-Product Attention Formula'));

    const catalog = await listLibraryCatalog(mockApp);
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].topicFolder, 'Machine Learning');
    assert.strictEqual(catalog[0].docKind, 'Paper');

    // Test author normalization & deduplication
    const dedupedAuthors = normalizeAndDeduplicateAuthors(
        'Vaswani, Ashish*; A. Vaswani; Shazeer, Noam; N. Shazeer',
        ['Ashish Vaswani']
    );
    assert.strictEqual(dedupedAuthors, 'Ashish Vaswani, Noam Shazeer');

    // Test consistent topic folder resolution
    const matchedTopic = resolveConsistentTopicFolder('machine-learning', ['Machine Learning', 'Game Theory']);
    assert.strictEqual(matchedTopic, 'Machine Learning');

    const newTopic = resolveConsistentTopicFolder('reinforcement_learning', ['Machine Learning']);
    assert.strictEqual(newTopic, 'Reinforcement Learning');

    // Test tag sanitization (Obsidian tags cannot contain spaces)
    assert.strictEqual(sanitizeTag('large language models'), 'large-language-models');
    assert.strictEqual(sanitizeTag('grouped-query attention!'), 'grouped-query-attention');
    assert.strictEqual(sanitizeTag('#sliding window attention'), 'sliding-window-attention');

    // Test Mermaid block sanitization (auto-quoting unquoted labels with parens/math/wikilinks & mindmaps)
    const rawMermaidMd = [
        '# Transformer Note',
        '```mermaid',
        'flowchart TD',
        '  A[Scaled Dot-Product (Q, K, V)] --> B[SoftMax: $QK^T / \\sqrt{d_k}$]',
        '  B --> C[[Multi-Head Attention]]',
        '```',
        '',
        '```mermaid',
        'mindmap',
        '  root((Transformer Architecture))',
        '    Encoder: Self-Attention [Layer]',
        '    Decoder (Masked Attention)',
        '```'
    ].join('\n');

    const cleanedMermaidMd = sanitizeMermaidBlocks(rawMermaidMd);
    assert.ok(cleanedMermaidMd.includes('A["Scaled Dot-Product (Q, K, V)"]'));
    assert.ok(cleanedMermaidMd.includes('B["SoftMax: QK^T / \\sqrt{d_k}"]'));
    assert.ok(cleanedMermaidMd.includes('root(("Transformer Architecture"))'));
    assert.ok(cleanedMermaidMd.includes('Encoder Self-Attention Layer'));

    // Test NoteTaker tools (create_obsidian_note with subfolder + tags + update_obsidian_note preserving frontmatter)
    const noteTools = getNoteTakingTools(mockApp);
    const createNoteTool = noteTools.find(t => t.name === 'create_obsidian_note')!;
    const updateNoteTool = noteTools.find(t => t.name === 'update_obsidian_note')!;

    await (createNoteTool as any).execute({
        title: 'Notes/Transformer Overview',
        content: rawMermaidMd,
        tags: ['deep learning', 'self attention'],
        status: 'evergreen'
    });
    assert.ok(files.has('Notes/Transformer Overview.md'));
    const savedNote = files.get('Notes/Transformer Overview.md')!;
    assert.ok(savedNote.includes('  - deep-learning'));
    assert.ok(savedNote.includes('  - self-attention'));
    assert.ok(savedNote.includes('A["Scaled Dot-Product (Q, K, V)"]'));

    await (updateNoteTool as any).execute({
        path: 'Notes/Transformer Overview.md',
        content: '# Updated Transformer Note\nNew body without frontmatter.',
        mode: 'overwrite'
    });
    const overwrittenNote = files.get('Notes/Transformer Overview.md')!;
    assert.ok(overwrittenNote.includes('  - deep-learning'));
    assert.ok(overwrittenNote.includes('# Updated Transformer Note'));

    // Test multi-provider LLM support (OpenAI, Anthropic, and schema conversion)
    const openaiModel = createConfiguredLlm('openai', 'gpt-4o', 'sk-test-openai');
    assert.ok(openaiModel instanceof OpenAiLlm);
    assert.strictEqual(openaiModel.model, 'gpt-4o');

    const anthropicModel = createConfiguredLlm('anthropic', 'claude-sonnet-4-20250514', 'sk-ant-test');
    assert.ok(anthropicModel instanceof AnthropicLlm);
    assert.strictEqual(anthropicModel.model, 'claude-sonnet-4-20250514');

    const openRouterModel = createConfiguredLlm('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'sk-or-test');
    assert.ok(openRouterModel instanceof OpenAiLlm);
    assert.strictEqual(openRouterModel.baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(openRouterModel.providerLabel, 'OpenRouter');

    const groqModel = createConfiguredLlm('groq', 'llama-3.3-70b-versatile', 'gsk-test');
    assert.ok(groqModel instanceof OpenAiLlm);
    assert.strictEqual(groqModel.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(groqModel.providerLabel, 'Groq');

    const convertedSchema = toStandardJsonSchema({
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING', description: 'Doc title' },
            tags: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['title']
    });
    assert.strictEqual(convertedSchema.type, 'object');
    assert.strictEqual(convertedSchema.properties.title.type, 'string');
    assert.strictEqual(convertedSchema.properties.tags.type, 'array');
    assert.strictEqual(convertedSchema.properties.tags.items.type, 'string');

    console.log("All PDF download, Library organization, author deduplication, Mermaid sanitization, multi-provider LLM, and Library Index reading checks passed!");
})();
