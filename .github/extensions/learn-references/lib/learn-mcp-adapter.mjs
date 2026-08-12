import {
    canonicalJson,
    canonicalizeLineEndings,
    hashFetchedMarkdown,
    sha256Hex,
} from "./canonical-json.mjs";
import {
    LEARN_OPERATIONS,
    MAX_FETCHED_MARKDOWN_LENGTH,
} from "./evidence-validation.mjs";
import { normalizeLearnUrl } from "./validation.mjs";

const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_RESULT_LENGTH = 20_000;
const MAX_SEARCH_BODY_LENGTH = 512_000;
const MAX_PREVIEW_LENGTH = 1_000;

export class LearnMcpAdapterError extends Error {
    constructor(code, message, { operation, cause, details } = {}) {
        super(message, { cause });
        this.name = "LearnMcpAdapterError";
        this.code = code;
        if (operation !== undefined) {
            this.operation = operation;
        }
        if (details !== undefined) {
            this.details = details;
        }
    }
}

function adapterFail(code, message, options) {
    throw new LearnMcpAdapterError(code, message, options);
}

function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function boundedText(value, maximum, operation) {
    if (typeof value !== "string") {
        adapterFail("INVALID_RESULT_TYPE", "Learn MCP text content must be a string", {
            operation,
        });
    }
    if (value.length > maximum) {
        adapterFail(
            "RESULT_TOO_LARGE",
            `Learn MCP content exceeds the ${maximum}-character limit`,
            { operation, details: { length: value.length, maximum } },
        );
    }
    return value;
}

function failureText(value) {
    const text = value.trim();
    if (!text || text.startsWith("#")) {
        return false;
    }
    return /^(?:error|failure|failed|invalid (?:url|uri|request)|not found|unable to (?:fetch|retrieve|search)|could not (?:fetch|retrieve|search)|the provided url\b.*\bcould not be retrieved)\b/i.test(text);
}

function assertNoFailureEnvelope(value, operation, seen = new WeakSet()) {
    if (!isPlainObject(value)) {
        return;
    }
    if (seen.has(value)) {
        adapterFail("CYCLIC_RESULT", "Learn MCP returned a cyclic result envelope", {
            operation,
        });
    }
    seen.add(value);
    if (Object.hasOwn(value, "error") && value.error !== undefined && value.error !== null) {
        adapterFail("MCP_ERROR", "Learn MCP returned an error envelope", {
            operation,
            details: { error: value.error },
        });
    }
    if (value.isError === true || value.success === false || value.ok === false) {
        adapterFail("TOOL_RESULT_FAILED", "Learn MCP marked the tool result as failed", {
            operation,
        });
    }
    if (
        typeof value.resultType === "string"
        && value.resultType.toLowerCase() !== "success"
    ) {
        adapterFail(
            "TOOL_RESULT_FAILED",
            `Learn MCP returned resultType "${value.resultType}"`,
            { operation },
        );
    }
    if (
        typeof value.status === "string"
        && ["error", "failed", "failure"].includes(value.status.toLowerCase())
    ) {
        adapterFail("TOOL_RESULT_FAILED", `Learn MCP returned status "${value.status}"`, {
            operation,
        });
    }
    for (const key of ["structuredContent", "toolResult", "result"]) {
        if (isPlainObject(value[key])) {
            assertNoFailureEnvelope(value[key], operation, seen);
        }
    }
}

function assertNoFailureTextEnvelope(value, operation) {
    const text = value.trim();
    if (failureText(text)) {
        adapterFail("FAILURE_SHAPED_TEXT", "Learn MCP returned failure text as a successful result", {
            operation,
            details: { preview: text.slice(0, 300) },
        });
    }
    const labelledText = /^(?:result|response|tool result)\s*:\s*([\s\S]+)$/i.exec(text);
    if (labelledText && failureText(labelledText[1])) {
        adapterFail("FAILURE_SHAPED_TEXT", "Learn MCP returned failure text as a successful result", {
            operation,
            details: { preview: text.slice(0, 300) },
        });
    }
    const labelled = /^(?:result|response|tool result)\s*:\s*(\{[\s\S]*\})$/i.exec(text);
    const candidate = labelled?.[1] ?? (text.startsWith("{") ? text : undefined);
    if (candidate === undefined) {
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch (cause) {
        if (/"(?:error|isError|resultType|jsonrpc)"\s*:/.test(candidate)) {
            adapterFail("MALFORMED_JSON", "Learn MCP result envelope is malformed JSON", {
                operation,
                cause,
                details: { preview: candidate.slice(0, 300) },
            });
        }
        return;
    }
    assertNoFailureEnvelope(parsed, operation);
}

function textBlocks(value, operation) {
    if (!Array.isArray(value)) {
        adapterFail("INVALID_CONTENT_BLOCKS", "Learn MCP content blocks must be an array", {
            operation,
        });
    }
    const blocks = value.map((block, index) => {
        if (!isPlainObject(block) || block.type !== "text" || typeof block.text !== "string") {
            adapterFail(
                "INVALID_CONTENT_BLOCK",
                `Learn MCP content block ${index} must be a text block`,
                { operation },
            );
        }
        assertNoFailureTextEnvelope(block.text, operation);
        return block.text;
    });
    return blocks.join("\n");
}

function textCandidate(value, operation, { preferLlmText = false } = {}) {
    if (typeof value === "string") {
        return value;
    }
    if (!isPlainObject(value)) {
        return undefined;
    }
    if (preferLlmText && typeof value.textResultForLlm === "string") {
        return value.textResultForLlm;
    }
    for (const key of ["content", "contents"]) {
        if (Object.hasOwn(value, key)) {
            return textBlocks(value[key], operation);
        }
    }
    for (const key of ["textResultForLlm", "markdown", "text"]) {
        if (typeof value[key] === "string") {
            return value[key];
        }
    }
    return undefined;
}

function parseJsonText(text, operation) {
    assertNoFailureTextEnvelope(text, operation);
    try {
        return JSON.parse(text);
    } catch (cause) {
        adapterFail("MALFORMED_JSON", "Learn MCP search content is not valid JSON", {
            operation,
            cause,
            details: { preview: text.slice(0, 300) },
        });
    }
}

function unwrapResult(value, operation) {
    assertNoFailureEnvelope(value, operation);
    if (!isPlainObject(value)) {
        return value;
    }
    if (Object.hasOwn(value, "structuredContent")) {
        const structured = value.structuredContent;
        assertNoFailureEnvelope(structured, operation);
        if (structured !== undefined && structured !== null) {
            return structured;
        }
    }
    if (Object.hasOwn(value, "toolResult")) {
        return unwrapResult(value.toolResult, operation);
    }
    if (Object.hasOwn(value, "result")) {
        return unwrapResult(value.result, operation);
    }
    return value;
}

function resultsArray(value, operation) {
    const unwrapped = unwrapResult(value, operation);
    if (Array.isArray(unwrapped)) {
        return unwrapped;
    }
    if (isPlainObject(unwrapped) && Array.isArray(unwrapped.results)) {
        return unwrapped.results;
    }

    const text = textCandidate(unwrapped, operation, { preferLlmText: true });
    if (text !== undefined) {
        const bounded = boundedText(text, MAX_SEARCH_BODY_LENGTH, operation);
        return resultsArray(parseJsonText(bounded, operation), operation);
    }
    adapterFail("UNKNOWN_RESULT_SHAPE", "Learn MCP search result has an unsupported shape", {
        operation,
    });
}

function normalizeSearchResultItem(value, index, operation) {
    if (!isPlainObject(value) && typeof value !== "string") {
        adapterFail(
            "INVALID_SEARCH_RESULT",
            `Learn MCP search result ${index} must be an object or string`,
            { operation },
        );
    }
    const serialized = canonicalJson(value);
    if (serialized.length > MAX_SEARCH_RESULT_LENGTH) {
        adapterFail(
            "SEARCH_RESULT_TOO_LARGE",
            `Learn MCP search result ${index} exceeds the ${MAX_SEARCH_RESULT_LENGTH}-character limit`,
            { operation },
        );
    }
    return value;
}

function collectLearnUrls(value, urls = new Set()) {
    if (urls.size >= 5) {
        return urls;
    }
    if (typeof value === "string" && value.startsWith("https://")) {
        try {
            urls.add(normalizeLearnUrl(value, "$.resultUrl"));
        } catch (error) {
            if (error?.code !== "INVALID_LEARN_HOST" && error?.code !== "INVALID_URL") {
                throw error;
            }
        }
        return urls;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectLearnUrls(entry, urls);
            if (urls.size >= 5) {
                break;
            }
        }
    } else if (isPlainObject(value)) {
        for (const entry of Object.values(value)) {
            collectLearnUrls(entry, urls);
            if (urls.size >= 5) {
                break;
            }
        }
    }
    return urls;
}

function normalizeSearchResult(operation, rawResult) {
    const items = resultsArray(rawResult, operation);
    if (items.length > MAX_SEARCH_RESULTS) {
        adapterFail(
            "TOO_MANY_RESULTS",
            `Learn MCP returned ${items.length} results; maximum is ${MAX_SEARCH_RESULTS}`,
            { operation },
        );
    }
    const normalizedItems = items.map((item, index) => (
        normalizeSearchResultItem(item, index, operation)
    ));
    const serialized = canonicalJson(normalizedItems);
    if (serialized.length > MAX_SEARCH_BODY_LENGTH) {
        adapterFail(
            "RESULT_TOO_LARGE",
            `Learn MCP search results exceed the ${MAX_SEARCH_BODY_LENGTH}-character limit`,
            { operation },
        );
    }
    return {
        logicalOperation: operation,
        items: normalizedItems,
        resultCount: normalizedItems.length,
        resultSha256: sha256Hex(serialized),
        sourceUrls: [...collectLearnUrls(normalizedItems)],
        preview: serialized.slice(0, MAX_PREVIEW_LENGTH),
        truncated: serialized.length > MAX_PREVIEW_LENGTH,
    };
}

function normalizeFetchResult(rawResult, context) {
    const operation = "docs-fetch";
    if (typeof rawResult === "string" && rawResult.trimStart().startsWith("{")) {
        const trimmed = rawResult.trim();
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (cause) {
            if (/"(?:error|isError|resultType|jsonrpc)"\s*:/.test(trimmed)) {
                adapterFail("MALFORMED_JSON", "Learn MCP fetch envelope is malformed JSON", {
                    operation,
                    cause,
                    details: { preview: trimmed.slice(0, 300) },
                });
            }
        }
        if (
            isPlainObject(parsed)
            && [
                "error",
                "isError",
                "success",
                "ok",
                "resultType",
                "status",
                "jsonrpc",
                "result",
                "toolResult",
                "structuredContent",
                "content",
                "contents",
                "textResultForLlm",
            ].some((key) => Object.hasOwn(parsed, key))
        ) {
            return normalizeFetchResult(parsed, context);
        }
    }
    const unwrapped = unwrapResult(rawResult, operation);
    const text = textCandidate(unwrapped, operation);
    if (text === undefined) {
        adapterFail("UNKNOWN_RESULT_SHAPE", "Learn MCP fetch result has no Markdown text", {
            operation,
        });
    }
    const markdown = boundedText(text, MAX_FETCHED_MARKDOWN_LENGTH, operation);
    if (!markdown) {
        adapterFail("EMPTY_FETCH_RESULT", "Learn MCP fetch result is empty", { operation });
    }
    assertNoFailureTextEnvelope(markdown, operation);
    if (!context?.canonicalUrl || !context?.retrievalUrl) {
        adapterFail(
            "MISSING_FETCH_CONTEXT",
            "Fetch normalization requires canonical and retrieval URLs",
            { operation },
        );
    }
    const canonicalUrl = normalizeLearnUrl(context.canonicalUrl, "$.canonicalUrl", {
        canonical: true,
    });
    const retrievalUrl = normalizeLearnUrl(context.retrievalUrl, "$.retrievalUrl");
    return {
        logicalOperation: operation,
        markdown,
        resultCount: 1,
        resultSha256: hashFetchedMarkdown(markdown),
        sourceUrls: [retrievalUrl],
        canonicalUrl,
        retrievalUrl,
        preview: canonicalizeLineEndings(markdown).slice(0, MAX_PREVIEW_LENGTH),
        truncated: markdown.length > MAX_PREVIEW_LENGTH,
    };
}

export function adaptLearnMcpResult(operation, rawResult, context = {}) {
    if (!LEARN_OPERATIONS.includes(operation)) {
        adapterFail("UNKNOWN_OPERATION", `Unknown logical Learn operation "${operation}"`, {
            operation,
        });
    }
    if (operation === "docs-fetch") {
        return normalizeFetchResult(rawResult, context);
    }
    return normalizeSearchResult(operation, rawResult);
}

function semanticText(name, schema) {
    return [
        name,
        schema?.title,
        schema?.description,
    ].filter((entry) => typeof entry === "string").join(" ").toLowerCase();
}

function requiredStringProperties(inputSchema) {
    if (!isPlainObject(inputSchema) || inputSchema.type !== "object") {
        return [];
    }
    if (!isPlainObject(inputSchema.properties) || !Array.isArray(inputSchema.required)) {
        return [];
    }
    return inputSchema.required
        .filter((name) => inputSchema.properties[name]?.type === "string")
        .map((name) => ({
            name,
            schema: inputSchema.properties[name],
            semantic: semanticText(name, inputSchema.properties[name]),
        }));
}

function optionalStringProperties(inputSchema) {
    if (!isPlainObject(inputSchema?.properties)) {
        return [];
    }
    const required = new Set(inputSchema.required ?? []);
    return Object.entries(inputSchema.properties)
        .filter(([name, schema]) => !required.has(name) && schema?.type === "string")
        .map(([name, schema]) => ({
            name,
            schema,
            semantic: semanticText(name, schema),
        }));
}

function classifyTool(tool) {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || !tool.name.trim()) {
        adapterFail("INVALID_TOOL_DEFINITION", "Learn MCP tool definitions require a name");
    }
    const required = requiredStringProperties(tool.inputSchema);
    const optional = optionalStringProperties(tool.inputSchema);
    const allStringProperties = [...required, ...optional];
    const uriArgument = allStringProperties.find((property) => (
        property.schema.format === "uri"
        || /\b(?:url|uri|address|page)\b/.test(property.semantic)
    ));
    if (uriArgument) {
        return {
            logicalOperation: "docs-fetch",
            argumentKeys: { resource: uriArgument.name },
        };
    }

    const queryArgument = allStringProperties.find((property) => (
        /\b(?:query|search|prompt|keywords?)\b/.test(property.semantic)
    ));
    if (!queryArgument) {
        adapterFail(
            "SCHEMA_DRIFT",
            `Cannot identify a query or URI argument for discovered tool "${tool.name}"`,
        );
    }
    const languageArgument = allStringProperties.find((property) => (
        property.name !== queryArgument.name
        &&
        /\b(?:language|lang|programming)\b/.test(property.semantic)
    ));
    const toolSemantics = semanticText(tool.name, tool);
    const codeLike = languageArgument !== undefined || /\bcode\b/.test(toolSemantics);
    return {
        logicalOperation: codeLike ? "code-sample-search" : "docs-search",
        argumentKeys: {
            query: queryArgument.name,
            ...(languageArgument ? { language: languageArgument.name } : {}),
        },
    };
}

function listedTools(value) {
    assertNoFailureEnvelope(value);
    if (Array.isArray(value)) {
        return value;
    }
    if (isPlainObject(value) && Array.isArray(value.tools)) {
        return value.tools;
    }
    adapterFail("INVALID_TOOLS_LIST", "Learn MCP tools/list returned an unsupported shape");
}

export function discoverLearnOperations(toolsListResult) {
    const discovered = {};
    for (const tool of listedTools(toolsListResult)) {
        const classification = classifyTool(tool);
        const operation = classification.logicalOperation;
        if (discovered[operation]) {
            adapterFail(
                "AMBIGUOUS_OPERATION",
                `Multiple discovered tools map to logical operation "${operation}"`,
                { operation },
            );
        }
        discovered[operation] = Object.freeze({
            runtimeName: tool.name,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            argumentKeys: Object.freeze(classification.argumentKeys),
        });
    }
    for (const operation of LEARN_OPERATIONS) {
        if (!discovered[operation]) {
            adapterFail(
                "MISSING_OPERATION",
                `Learn MCP did not advertise logical operation "${operation}"`,
                { operation },
            );
        }
    }
    return Object.freeze(discovered);
}

function fetchContext(descriptor, args) {
    const argument = descriptor.argumentKeys.resource;
    const retrievalUrl = normalizeLearnUrl(args?.[argument], `$.arguments.${argument}`);
    const canonical = new URL(retrievalUrl);
    canonical.search = "";
    canonical.hash = "";
    return {
        canonicalUrl: normalizeLearnUrl(canonical.toString(), "$.canonicalUrl", {
            canonical: true,
        }),
        retrievalUrl,
    };
}

export class LearnMcpAdapter {
    constructor({ listTools, callTool }) {
        if (typeof listTools !== "function" || typeof callTool !== "function") {
            throw new TypeError("LearnMcpAdapter requires listTools and callTool functions");
        }
        this.listTools = listTools;
        this.callTool = callTool;
        this.operations = null;
    }

    async connect() {
        let result;
        try {
            result = await this.listTools();
        } catch (cause) {
            adapterFail("PROTOCOL_FAILURE", "Learn MCP tools/list failed", { cause });
        }
        this.operations = discoverLearnOperations(result);
        return this.operations;
    }

    async execute(operation, args) {
        if (!this.operations) {
            adapterFail("NOT_CONNECTED", "Learn MCP operations must be discovered before execution", {
                operation,
            });
        }
        const descriptor = this.operations[operation];
        if (!descriptor) {
            adapterFail("UNKNOWN_OPERATION", `Unknown logical Learn operation "${operation}"`, {
                operation,
            });
        }
        const context = operation === "docs-fetch"
            ? fetchContext(descriptor, args)
            : {};

        let rawResult;
        try {
            rawResult = await this.callTool(descriptor.runtimeName, args);
        } catch (cause) {
            adapterFail("PROTOCOL_FAILURE", `Learn MCP call failed for "${operation}"`, {
                operation,
                cause,
            });
        }
        return {
            ...adaptLearnMcpResult(operation, rawResult, context),
            runtimeToolName: descriptor.runtimeName,
        };
    }
}
