import { requestUrl } from 'obsidian';
import { BaseLlm, Gemini, LLMRegistry, LlmRequest, LlmResponse } from '@google/adk';

/**
 * Recursively converts Gemini-style uppercase Schema types ('OBJECT', 'STRING', 'ARRAY', etc.)
 * into standard lowercase JSON Schema types expected by OpenAI and Anthropic tool definitions.
 */
export function toStandardJsonSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
        return { type: 'object', properties: {} };
    }

    const result: Record<string, any> = {};
    const rawType = typeof schema.type === 'string' ? schema.type.toLowerCase() : 'object';
    result.type = rawType;

    if (schema.description) {
        result.description = schema.description;
    }

    if (Array.isArray(schema.enum)) {
        result.enum = schema.enum;
    }

    if (rawType === 'object') {
        const props: Record<string, any> = {};
        if (schema.properties && typeof schema.properties === 'object') {
            for (const [k, v] of Object.entries(schema.properties)) {
                props[k] = toStandardJsonSchema(v);
            }
        }
        result.properties = props;
        if (Array.isArray(schema.required) && schema.required.length > 0) {
            result.required = schema.required;
        }
    } else if (rawType === 'array') {
        result.items = schema.items ? toStandardJsonSchema(schema.items) : { type: 'string' };
    }

    return result;
}

function extractSystemInstructionText(llmRequest: LlmRequest): string {
    const sys = llmRequest.config?.systemInstruction;
    if (!sys) return '';
    if (typeof sys === 'string') return sys;
    if (Array.isArray(sys)) {
        return sys
            .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
            .filter(Boolean)
            .join('\n\n');
    }
    if (typeof sys === 'object' && Array.isArray((sys as any).parts)) {
        return (sys as any).parts
            .map((p: any) => p?.text || '')
            .filter(Boolean)
            .join('\n\n');
    }
    return '';
}

function extractFunctionDeclarations(llmRequest: LlmRequest): Array<{
    name: string;
    description: string;
    parameters: any;
}> {
    const tools = llmRequest.config?.tools || [];
    const decls: Array<{ name: string; description: string; parameters: any }> = [];
    for (const toolGroup of tools) {
        const fnDecls = (toolGroup as any)?.functionDeclarations;
        if (Array.isArray(fnDecls)) {
            for (const fn of fnDecls) {
                if (fn?.name) {
                    decls.push({
                        name: fn.name,
                        description: fn.description || '',
                        parameters: toStandardJsonSchema(fn.parameters)
                    });
                }
            }
        }
    }
    return decls;
}

function sanitizeToolCallId(id: string | undefined, fallbackIdx: number): string {
    const raw = (id || `call_${fallbackIdx}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    return raw.slice(0, 64) || `call_${fallbackIdx}`;
}

/**
 * OpenAI Chat Completions adapter implementing @google/adk's BaseLlm.
 */
export class OpenAiLlm extends BaseLlm {
    public apiKey: string;
    public baseUrl: string;
    public providerLabel: string;
    private extraHeaders: Record<string, string>;

    static override readonly supportedModels: Array<string | RegExp> = [
        /^gpt-.*/,
        /^o1.*/,
        /^o3.*/,
        /^o4.*/,
        /^chatgpt-.*/,
        /^llama-.*/,
        /^mixtral-.*/,
        /^gemma.*/,
        /^qwen.*/,
        /^deepseek.*/,
        /.*\/.*/
    ];

    constructor({
        model,
        apiKey,
        baseUrl,
        providerLabel,
        extraHeaders
    }: {
        model: string;
        apiKey?: string;
        baseUrl?: string;
        providerLabel?: string;
        extraHeaders?: Record<string, string>;
    }) {
        super({ model: model || 'gpt-4o' });
        this.apiKey = apiKey || '';
        this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        this.providerLabel = providerLabel || 'OpenAI';
        this.extraHeaders = extraHeaders || {};
    }

    override async *generateContentAsync(
        llmRequest: LlmRequest,
        _stream = false,
        _abortSignal?: AbortSignal
    ): AsyncGenerator<LlmResponse, void, void> {
        if (!this.apiKey) {
            yield {
                errorCode: 'MISSING_API_KEY',
                errorMessage: `${this.providerLabel} API key is not configured. Please add it in DyResearch Settings.`
            };
            return;
        }

        this.maybeAppendUserContent(llmRequest);

        const messages: any[] = [];
        const sysText = extractSystemInstructionText(llmRequest);
        if (sysText) {
            messages.push({ role: 'system', content: sysText });
        }

        let callCounter = 1;
        const pendingCallIdsByName = new Map<string, string[]>();

        for (const content of llmRequest.contents || []) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const parts = content.parts || [];

            const textSegments: string[] = [];
            const toolCalls: any[] = [];
            const toolResponses: any[] = [];

            for (const part of parts as any[]) {
                if (part?.text && !part?.thought) {
                    textSegments.push(part.text);
                }
                if (part?.functionCall) {
                    const fc = part.functionCall;
                    const callId = sanitizeToolCallId(fc.id, callCounter++);
                    const queue = pendingCallIdsByName.get(fc.name) || [];
                    queue.push(callId);
                    pendingCallIdsByName.set(fc.name, queue);

                    toolCalls.push({
                        id: callId,
                        type: 'function',
                        function: {
                            name: fc.name,
                            arguments: JSON.stringify(fc.args || {})
                        }
                    });
                }
                if (part?.functionResponse) {
                    const fr = part.functionResponse;
                    const queue = pendingCallIdsByName.get(fr.name) || [];
                    const matchedId = fr.id
                        ? sanitizeToolCallId(fr.id, callCounter++)
                        : (queue.shift() || sanitizeToolCallId(undefined, callCounter++));
                    const responsePayload = fr.response !== undefined ? fr.response : {};
                    toolResponses.push({
                        role: 'tool',
                        tool_call_id: matchedId,
                        content: typeof responsePayload === 'string'
                            ? responsePayload
                            : JSON.stringify(responsePayload)
                    });
                }
            }

            if (toolCalls.length > 0) {
                messages.push({
                    role: 'assistant',
                    content: textSegments.length > 0 ? textSegments.join('\n') : null,
                    tool_calls: toolCalls
                });
            } else if (textSegments.length > 0) {
                messages.push({
                    role,
                    content: textSegments.join('\n')
                });
            }

            for (const tr of toolResponses) {
                messages.push(tr);
            }
        }

        const fnDecls = extractFunctionDeclarations(llmRequest);
        const tools = fnDecls.map(fn => ({
            type: 'function',
            function: {
                name: fn.name,
                description: fn.description,
                parameters: fn.parameters
            }
        }));

        const body: Record<string, any> = {
            model: llmRequest.model || this.model,
            messages
        };
        if (tools.length > 0) {
            body.tools = tools;
        }

        try {
            const response = await requestUrl({
                url: `${this.baseUrl}/chat/completions`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...this.extraHeaders
                },
                body: JSON.stringify(body),
                throw: false
            });

            if (response.status >= 400) {
                const errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`;
                yield {
                    errorCode: `${this.providerLabel.toUpperCase()}_${response.status}`,
                    errorMessage: `${this.providerLabel} API Error: ${errMsg}`
                };
                return;
            }

            const data = response.json;
            const choice = data?.choices?.[0];
            const msg = choice?.message;
            const outParts: any[] = [];

            if (msg?.content && typeof msg.content === 'string' && msg.content.trim()) {
                outParts.push({ text: msg.content });
            }

            if (Array.isArray(msg?.tool_calls)) {
                for (const tc of msg.tool_calls) {
                    if (tc?.function?.name) {
                        let parsedArgs: any = {};
                        try {
                            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                        } catch {
                            parsedArgs = {};
                        }
                        outParts.push({
                            functionCall: {
                                id: tc.id || `call_${Date.now()}`,
                                name: tc.function.name,
                                args: parsedArgs
                            }
                        });
                    }
                }
            }

            if (outParts.length === 0) {
                outParts.push({ text: '' });
            }

            yield {
                content: {
                    role: 'model',
                    parts: outParts
                },
                finishReason: 'STOP' as any
            };
        } catch (err: any) {
            yield {
                errorCode: 'OPENAI_NETWORK_ERROR',
                errorMessage: err?.message || String(err)
            };
        }
    }

    override async connect(_llmRequest: LlmRequest): Promise<any> {
        throw new Error('Live bidirectional streaming is not supported on OpenAiLlm.');
    }
}

/**
 * Anthropic Messages API adapter implementing @google/adk's BaseLlm.
 */
export class AnthropicLlm extends BaseLlm {
    private apiKey: string;
    private baseUrl: string;

    static override readonly supportedModels: Array<string | RegExp> = [
        /^claude-.*/
    ];

    constructor({ model, apiKey, baseUrl }: { model: string; apiKey?: string; baseUrl?: string }) {
        super({ model: model || 'claude-sonnet-4-20250514' });
        this.apiKey = apiKey || '';
        this.baseUrl = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    }

    override async *generateContentAsync(
        llmRequest: LlmRequest,
        _stream = false,
        _abortSignal?: AbortSignal
    ): AsyncGenerator<LlmResponse, void, void> {
        if (!this.apiKey) {
            yield {
                errorCode: 'MISSING_API_KEY',
                errorMessage: 'Anthropic API key is not configured. Please add it in DyResearch Settings.'
            };
            return;
        }

        this.maybeAppendUserContent(llmRequest);

        const sysText = extractSystemInstructionText(llmRequest);
        const rawMessages: Array<{ role: 'user' | 'assistant'; content: any[] }> = [];

        let callCounter = 1;
        const pendingCallIdsByName = new Map<string, string[]>();

        for (const content of llmRequest.contents || []) {
            const parts = content.parts || [];
            const assistantBlocks: any[] = [];
            const userBlocks: any[] = [];

            for (const part of parts as any[]) {
                if (part?.text && !part?.thought) {
                    if (content.role === 'model') {
                        assistantBlocks.push({ type: 'text', text: part.text });
                    } else {
                        userBlocks.push({ type: 'text', text: part.text });
                    }
                }
                if (part?.functionCall) {
                    const fc = part.functionCall;
                    const callId = sanitizeToolCallId(fc.id, callCounter++);
                    const queue = pendingCallIdsByName.get(fc.name) || [];
                    queue.push(callId);
                    pendingCallIdsByName.set(fc.name, queue);

                    assistantBlocks.push({
                        type: 'tool_use',
                        id: callId,
                        name: fc.name,
                        input: fc.args && typeof fc.args === 'object' ? fc.args : {}
                    });
                }
                if (part?.functionResponse) {
                    const fr = part.functionResponse;
                    const queue = pendingCallIdsByName.get(fr.name) || [];
                    const matchedId = fr.id
                        ? sanitizeToolCallId(fr.id, callCounter++)
                        : (queue.shift() || sanitizeToolCallId(undefined, callCounter++));
                    const responsePayload = fr.response !== undefined ? fr.response : {};
                    const resultText = typeof responsePayload === 'string'
                        ? responsePayload
                        : JSON.stringify(responsePayload);

                    userBlocks.push({
                        type: 'tool_result',
                        tool_use_id: matchedId,
                        content: resultText || 'OK'
                    });
                }
            }

            if (assistantBlocks.length > 0) {
                rawMessages.push({ role: 'assistant', content: assistantBlocks });
            }
            if (userBlocks.length > 0) {
                rawMessages.push({ role: 'user', content: userBlocks });
            }
        }

        // Merge consecutive messages with the same role (required by Anthropic Messages API)
        const mergedMessages: Array<{ role: 'user' | 'assistant'; content: any[] }> = [];
        for (const msg of rawMessages) {
            const prev = mergedMessages[mergedMessages.length - 1];
            if (prev && prev.role === msg.role) {
                prev.content.push(...msg.content);
            } else {
                mergedMessages.push({ role: msg.role, content: [...msg.content] });
            }
        }

        if (mergedMessages.length === 0 || mergedMessages[0].role !== 'user') {
            mergedMessages.unshift({
                role: 'user',
                content: [{ type: 'text', text: 'Please proceed according to the instructions.' }]
            });
        }

        const fnDecls = extractFunctionDeclarations(llmRequest);
        const tools = fnDecls.map(fn => ({
            name: fn.name,
            description: fn.description,
            input_schema: fn.parameters
        }));

        const body: Record<string, any> = {
            model: llmRequest.model || this.model,
            max_tokens: 4096,
            messages: mergedMessages
        };
        if (sysText) {
            body.system = sysText;
        }
        if (tools.length > 0) {
            body.tools = tools;
        }

        try {
            const response = await requestUrl({
                url: `${this.baseUrl}/messages`,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(body),
                throw: false
            });

            if (response.status >= 400) {
                const errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`;
                yield {
                    errorCode: `ANTHROPIC_${response.status}`,
                    errorMessage: `Anthropic API Error: ${errMsg}`
                };
                return;
            }

            const data = response.json;
            const outParts: any[] = [];

            if (Array.isArray(data?.content)) {
                for (const block of data.content) {
                    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                        outParts.push({ text: block.text });
                    } else if (block?.type === 'tool_use' && block.name) {
                        outParts.push({
                            functionCall: {
                                id: block.id || `call_${Date.now()}`,
                                name: block.name,
                                args: block.input && typeof block.input === 'object' ? block.input : {}
                            }
                        });
                    }
                }
            }

            if (outParts.length === 0) {
                outParts.push({ text: '' });
            }

            yield {
                content: {
                    role: 'model',
                    parts: outParts
                },
                finishReason: 'STOP' as any
            };
        } catch (err: any) {
            yield {
                errorCode: 'ANTHROPIC_NETWORK_ERROR',
                errorMessage: err?.message || String(err)
            };
        }
    }

    override async connect(_llmRequest: LlmRequest): Promise<any> {
        throw new Error('Live bidirectional streaming is not supported on AnthropicLlm.');
    }
}

// Register OpenAI and Anthropic model classes with ADK's LLMRegistry
LLMRegistry.register(OpenAiLlm);
LLMRegistry.register(AnthropicLlm);

export function createConfiguredLlm(provider: string, model: string, apiKey: string): BaseLlm {
    const cleanProvider = (provider || 'gemini').toLowerCase().trim();
    const cleanModel = (model || '').trim();

    if (cleanProvider === 'openrouter') {
        return new OpenAiLlm({
            model: cleanModel || 'meta-llama/llama-3.3-70b-instruct:free',
            apiKey,
            baseUrl: 'https://openrouter.ai/api/v1',
            providerLabel: 'OpenRouter',
            extraHeaders: {
                'HTTP-Referer': 'https://obsidian.md',
                'X-Title': 'DyResearch Obsidian'
            }
        });
    }

    if (cleanProvider === 'groq') {
        return new OpenAiLlm({
            model: cleanModel || 'llama-3.3-70b-versatile',
            apiKey,
            baseUrl: 'https://api.groq.com/openai/v1',
            providerLabel: 'Groq'
        });
    }

    if (cleanProvider === 'openai' || /^(gpt-|o1|o3|o4|chatgpt-)/i.test(cleanModel)) {
        return new OpenAiLlm({
            model: cleanModel || 'gpt-4o',
            apiKey,
            baseUrl: 'https://api.openai.com/v1',
            providerLabel: 'OpenAI'
        });
    }

    if (cleanProvider === 'anthropic' || /^claude-/i.test(cleanModel)) {
        return new AnthropicLlm({
            model: cleanModel || 'claude-sonnet-4-20250514',
            apiKey
        });
    }

    return new Gemini({
        model: cleanModel || 'gemini-2.5-flash',
        apiKey
    });
}

