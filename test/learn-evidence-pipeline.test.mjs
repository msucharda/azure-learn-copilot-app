import assert from "node:assert/strict";
import test from "node:test";
import {
    ContractValidationError,
    LearnMcpAdapter,
    LearnMcpAdapterError,
    adaptLearnMcpResult,
    assertEvidenceContentHash,
    canonicalJson,
    computeEvidenceContentHash,
    discoverLearnOperations,
    hashFetchedMarkdown,
    validateResearchBundle,
    validateResearchBundleWithRetention,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    clone,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

function expectCode(callback, errorClass, code) {
    assert.throws(callback, (error) => {
        assert.equal(error instanceof errorClass, true);
        assert.equal(error.code, code);
        return true;
    });
}

function learnStylePage(paragraphs = 8) {
    return [
        "# Configure resilient application routing",
        "",
        ...Array.from({ length: paragraphs }, (_value, index) => (
            `Routing stage ${index + 1} evaluates health probes, origin priority, and regional capacity before Azure Front Door selects an endpoint. Operators review diagnostic signals and deployment history for workload segment ${index + 1} before changing the failover policy.`
        )),
    ].join("\n\n");
}

function learnStylePageWithLength(length) {
    const paragraphs = [];
    for (let index = 0; paragraphs.join("").length < length; index += 1) {
        paragraphs.push(
            `Routing stage ${index} evaluates probe state ${String(index).padStart(5, "0")} `
            + `before selecting an origin for workload segment ${index}. `,
        );
    }
    return paragraphs.join("").slice(0, length);
}

function repeatedReferencePage(length) {
    const paragraphs = [];
    let total = 0;
    for (let index = 0; total < length; index += 1) {
        const paragraph = (
            `Section ${index}: This reference entry explains the parameter name, accepted values, `
            + "default behavior, deployment scope, permissions, regional availability, request "
            + "semantics, response properties, validation rules, troubleshooting guidance, "
            + "compatibility notes, and examples for configuring a production Azure resource. "
        );
        paragraphs.push(paragraph);
        total += paragraph.length;
    }
    return paragraphs.join("").slice(0, length);
}

function unrelatedEnglishWithLength(length) {
    const paragraphs = [];
    for (let index = 0; paragraphs.join("").length < length; index += 1) {
        paragraphs.push(
            `Workshop cohort ${index} alternates facilitation exercises, reflective discussion, `
            + `lunch breaks, and participant feedback before the next planning activity. `,
        );
    }
    return paragraphs.join("").slice(0, length);
}

function repeatNaturalLanguage(text, length) {
    return `${text} `.repeat(Math.ceil(length / (text.length + 1))).slice(
        0,
        length,
    );
}

function foreignAsciiFillers(markdown) {
    return Array.from(
        { length: 94 },
        (_value, index) => String.fromCharCode(index + 33),
    ).filter((character) => !markdown.includes(character));
}

function fragmentedFields(
    markdown,
    fragmentLength,
    fieldCount = 13,
    reverse = false,
    fillers = ["Z"],
) {
    const fragments = markdown.match(new RegExp(
        `[\\s\\S]{1,${fragmentLength}}`,
        "g",
    ));
    if (reverse) {
        fragments.reverse();
    }
    const fragmentsPerField = Math.ceil(fragments.length / fieldCount);
    return Array.from({ length: fieldCount }, (_value, index) => {
        const selected = fragments.slice(
            index * fragmentsPerField,
            (index + 1) * fragmentsPerField,
        );
        const fieldStart = index * fragmentsPerField;
        const joined = selected.map((fragment, selectedIndex) => (
            selectedIndex === 0
                ? fragment
                : `${fillers[(fieldStart + selectedIndex - 1) % fillers.length]}${fragment}`
        )).join("");
        return selected.length === 0 ? "" : `Q${joined}Q`;
    }).filter(Boolean);
}

function withFragmentedClaims(
    bundleInput,
    markdown,
    fragmentLength,
    fieldCount = 13,
    reverse = false,
    fillers = ["Z"],
) {
    const bundle = clone(bundleInput);
    bundle.claims = fragmentedFields(
        markdown,
        fragmentLength,
        fieldCount,
        reverse,
        fillers,
    ).map((text, index) => ({
        id: `claim-fragment-${index + 1}`,
        text,
        sourceIds: [bundle.sources[0].id],
        support: "supported",
    }));
    return rehash(bundle);
}

function withUnrelatedEnglishProse(bundleInput) {
    const bundle = clone(bundleInput);
    bundle.question = {
        original: "How should facilitators organize a practical workshop for a distributed engineering team?",
        normalized: "Plan a practical distributed-team engineering workshop.",
    };
    bundle.scope = {
        product: "Workshop planning",
        version: "autumn curriculum",
        platform: "Team learning portal",
        taskIntent: "Prepare a concise agenda with exercises, breaks, and feedback checkpoints.",
    };
    bundle.claims[0].text = "The agenda should alternate short demonstrations with collaborative exercises and reflection.";
    bundle.sources[0].title = "Workshop reference selected for discussion";
    bundle.sources[0].sectionHeading = "Facilitation notes";
    bundle.sources[0].whyItMatters = "This passage is the only quoted material needed to ground the recommendation.";
    return rehash(bundle);
}

test("canonical JSON sorts object keys and preserves array order", () => {
    assert.equal(
        canonicalJson({ z: 1, a: { d: 4, b: 2 }, list: [3, 1] }),
        '{"a":{"b":2,"d":4},"list":[3,1],"z":1}',
    );
    assert.equal(canonicalJson({ value: -0 }), '{"value":0}');
});

test("evidence hashes exclude status, lifecycle, and contentHash", () => {
    const { bundle } = makePublishedEvidence();
    const superseded = {
        ...clone(bundle),
        status: "superseded",
        lifecycle: {
            ...bundle.lifecycle,
            supersededAt: "2026-08-12T09:10:00Z",
            updatedAt: "2026-08-12T09:10:00Z",
        },
        contentHash: "f".repeat(64),
    };
    assert.equal(computeEvidenceContentHash(bundle), computeEvidenceContentHash(superseded));
    assert.equal(assertEvidenceContentHash(bundle).contentHash, bundle.contentHash);
});

test("content hash validation detects immutable evidence tampering", () => {
    const { bundle } = makePublishedEvidence();
    const tampered = clone(bundle);
    tampered.question.normalized = "Tampered after hashing.";
    expectCode(
        () => assertEvidenceContentHash(tampered),
        ContractValidationError,
        "CONTENT_HASH_MISMATCH",
    );
});

test("exact excerpts may normalize line endings only", () => {
    const fixture = makePublishedEvidence({
        markdown: "# Heading\r\n\r\nExact  spacing.\r\n",
        exactExcerpt: "Exact  spacing.",
    });
    assert.equal(
        validateResearchBundle(fixture.bundle, [fixture.capture]).sources.length,
        1,
    );

    const mismatch = clone(fixture.bundle);
    mismatch.sources[0].exactExcerpt = "Exact spacing.";
    expectCode(
        () => validateResearchBundle(rehash(mismatch), [fixture.capture]),
        ContractValidationError,
        "EXACT_EXCERPT_MISMATCH",
    );

    const leadingWhitespace = makePublishedEvidence({
        markdown: "# Heading\n\n  indented quote  \n",
        exactExcerpt: "  indented quote  ",
    });
    assert.equal(
        validateResearchBundle(
            leadingWhitespace.bundle,
            [leadingWhitespace.capture],
        ).sources[0].exactExcerpt,
        "  indented quote  ",
    );
});

test("search discovery cannot authorize a publishable article source", () => {
    const fixture = makePublishedEvidence();
    const nonFetch = clone(fixture.bundle);
    nonFetch.sources[0].retrievalMethod = "docs-search";
    expectCode(
        () => validateResearchBundle(rehash(nonFetch), [fixture.capture]),
        ContractValidationError,
        "NON_FETCH_SOURCE",
    );
    expectCode(
        () => validateResearchBundle(fixture.bundle, []),
        ContractValidationError,
        "FETCH_EVIDENCE_MISSING",
    );
});

test("published excerpts cannot reconstruct a complete fetched page", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abcde",
    });
    const partitioned = clone(fixture.bundle);
    partitioned.sources.push({
        ...partitioned.sources[0],
        id: "source-runtime-part-two",
        exactExcerpt: "fghij",
    });
    expectCode(
        () => validateResearchBundle(rehash(partitioned), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("claim prose cannot contain a complete fetched page", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = fixture.markdown;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("31-character fragments with alphanumeric filler exceed the aggregate budget", () => {
    const markdown = learnStylePageWithLength(20_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    assert.throws(
        () => validateResearchBundle(
            withFragmentedClaims(fixture.bundle, markdown, 31),
            [fixture.capture],
        ),
        (error) => {
            assert.equal(error instanceof ContractValidationError, true);
            assert.equal(
                ["FULL_FETCH_CONTENT", "EXCERPT_BUDGET_EXCEEDED"].includes(
                    error.code,
                ),
                true,
            );
            return true;
        },
    );
});

test("reordered 31-character fragments cannot bypass aggregate retention", () => {
    const markdown = learnStylePageWithLength(20_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    assert.throws(
        () => validateResearchBundle(
            withFragmentedClaims(fixture.bundle, markdown, 31, 13, true),
            [fixture.capture],
        ),
        (error) => {
            assert.equal(error instanceof ContractValidationError, true);
            assert.equal(
                ["FULL_FETCH_CONTENT", "EXCERPT_BUDGET_EXCEEDED"].includes(
                    error.code,
                ),
                true,
            );
            return true;
        },
    );
});

test("reordered sub-seed fragments cannot reconstruct a near-full page", () => {
    const markdown = learnStylePageWithLength(6_000);
    for (const fragmentLength of [7, 1]) {
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(0, 80),
        });
        assert.throws(
            () => validateResearchBundle(
                withFragmentedClaims(
                    fixture.bundle,
                    markdown,
                    fragmentLength,
                    13,
                    true,
                ),
                [fixture.capture],
            ),
            (error) => {
                assert.equal(error instanceof ContractValidationError, true);
                assert.equal(error.code, "FULL_FETCH_CONTENT");
                return true;
            },
        );
    }
});

test("reordered sub-seed fragments cannot alternate foreign fillers", () => {
    const markdown = learnStylePageWithLength(2_000);
    const manyFillers = foreignAsciiFillers(markdown);
    assert.equal(manyFillers.length > 40, true);
    for (const fillers of [["Z", "Y"], ["ZY"], manyFillers]) {
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(0, 80),
        });
        assert.throws(
            () => validateResearchBundle(
                withFragmentedClaims(
                    fixture.bundle,
                    markdown,
                    7,
                    13,
                    true,
                    fillers,
                ),
                [fixture.capture],
            ),
            (error) => {
                assert.equal(error instanceof ContractValidationError, true);
                assert.equal(error.code, "FULL_FETCH_CONTENT");
                return true;
            },
        );
    }
});

test("reordered multi-filler fragments preserve near-full accounting", () => {
    for (const pageLength of [4_000, 6_000, 8_000]) {
        const markdown = learnStylePageWithLength(pageLength);
        const retained = markdown.slice(0, Math.ceil(pageLength * 0.94));
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(0, 80),
        });
        assert.throws(
            () => validateResearchBundle(
                withFragmentedClaims(
                    fixture.bundle,
                    retained,
                    7,
                    13,
                    true,
                    foreignAsciiFillers(markdown),
                ),
                [fixture.capture],
            ),
            (error) => {
                assert.equal(error instanceof ContractValidationError, true);
                assert.equal(error.code, "FULL_FETCH_CONTENT");
                return true;
            },
        );
    }
});

test("ordered reconstruction catches fragments below every exact anchor", () => {
    const markdown = learnStylePageWithLength(6_000);
    for (const fragmentLength of [31, 7, 1]) {
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(0, 80),
        });
        assert.throws(
            () => validateResearchBundle(
                withFragmentedClaims(
                    fixture.bundle,
                    markdown,
                    fragmentLength,
                ),
                [fixture.capture],
            ),
            (error) => {
                assert.equal(error instanceof ContractValidationError, true);
                assert.equal(
                    ["FULL_FETCH_CONTENT", "EXCERPT_BUDGET_EXCEEDED"].includes(
                        error.code,
                    ),
                    true,
                );
                return true;
            },
        );
    }
});

test("single-character reconstruction contributes verified source intervals", () => {
    const markdown = learnStylePageWithLength(6_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    const baseline = validateResearchBundleWithRetention(
        fixture.bundle,
        [fixture.capture],
    ).retentionManifests[0].totalChars;
    const result = validateResearchBundleWithRetention(
        withFragmentedClaims(fixture.bundle, markdown.slice(0, 900), 1),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars >= 900, true);
    assert.equal(
        result.retentionManifests[0].totalChars <= 900 + baseline,
        true,
    );
});

test("sub-anchor fragments independently enforce the absolute excerpt budget", () => {
    const markdown = learnStylePageWithLength(20_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    assert.throws(
        () => validateResearchBundle(
            withFragmentedClaims(
                fixture.bundle,
                markdown.slice(0, 13_000),
                1,
            ),
            [fixture.capture],
        ),
        (error) => {
            assert.equal(error instanceof ContractValidationError, true);
            assert.equal(error.code, "EXCERPT_BUDGET_EXCEEDED");
            return true;
        },
    );
});

test("ordered reconstruction anchors exact claims on repetitive pages", () => {
    const markdown = repeatedReferencePage(60_000);
    for (const offset of [5_000, 8_000, 20_000]) {
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(offset, offset + 80),
        });
        const baseline = validateResearchBundleWithRetention(
            fixture.bundle,
            [fixture.capture],
        ).retentionManifests[0].totalChars;
        const quoted = clone(fixture.bundle);
        quoted.claims[0].text = markdown.slice(offset, offset + 3_000);
        const result = validateResearchBundleWithRetention(
            rehash(quoted),
            [fixture.capture],
        );
        assert.equal(result.retentionManifests[0].totalChars >= 3_000, true);
        assert.equal(
            result.retentionManifests[0].totalChars <= 3_000 + baseline,
            true,
        );
    }
});

test("repetitive pages still reject true fragmented reconstruction", () => {
    const markdown = repeatedReferencePage(60_000);
    const copied = markdown.slice(0, 20_000);
    for (const attack of [
        { fragmentLength: 7, reverse: false },
        { fragmentLength: 31, reverse: true },
    ]) {
        const fixture = makePublishedEvidence({
            markdown,
            exactExcerpt: markdown.slice(0, 80),
        });
        assert.throws(
            () => validateResearchBundle(
                withFragmentedClaims(
                    fixture.bundle,
                    copied,
                    attack.fragmentLength,
                    13,
                    attack.reverse,
                ),
                [fixture.capture],
            ),
            (error) => {
                assert.equal(error instanceof ContractValidationError, true);
                assert.equal(
                    [
                        "EXCERPT_BUDGET_EXCEEDED",
                        "FULL_FETCH_CONTENT",
                        "SHORT_FRAGMENT_AMBIGUOUS",
                    ].includes(error.code),
                    true,
                );
                return true;
            },
        );
    }
});

test("highly periodic reconstruction fails closed when anchors are ambiguous", () => {
    const markdown = "0123456789".repeat(6_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    expectCode(
        () => validateResearchBundle(
            withFragmentedClaims(
                fixture.bundle,
                markdown.slice(0, 54_000),
                31,
                17,
                false,
                ["0"],
            ),
            [fixture.capture],
        ),
        ContractValidationError,
        "ORDERED_RECONSTRUCTION_AMBIGUOUS",
    );
});

test("ordered short fragments remain detectable across field types", () => {
    const markdown = learnStylePageWithLength(6_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    const fields = fragmentedFields(markdown, 31, 12);
    const split = clone(fixture.bundle);
    split.question.original = fields[0];
    split.question.normalized = fields[1];
    split.claims = fields.slice(2).map((text, index) => ({
        id: `claim-cross-field-${index + 1}`,
        text,
        sourceIds: [split.sources[0].id],
        support: "supported",
    }));
    assert.throws(
        () => validateResearchBundle(rehash(split), [fixture.capture]),
        (error) => {
            assert.equal(error instanceof ContractValidationError, true);
            assert.equal(
                ["FULL_FETCH_CONTENT", "EXCERPT_BUDGET_EXCEEDED"].includes(
                    error.code,
                ),
                true,
            );
            return true;
        },
    );
});

test("bounded embedded short excerpts remain publishable", () => {
    const markdown = learnStylePageWithLength(6_000);
    const excerpt = markdown.slice(0, 80);
    const fixture = makePublishedEvidence({ markdown, exactExcerpt: excerpt });
    const bounded = clone(fixture.bundle);
    bounded.claims = Array.from({ length: 12 }, (_value, index) => ({
        id: `claim-bounded-short-${index + 1}`,
        text: `Context${index}X${markdown.slice(500 + index * 100, 520 + index * 100)}Y`,
        sourceIds: [bounded.sources[0].id],
        support: "supported",
    }));
    const result = validateResearchBundleWithRetention(
        rehash(bounded),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, excerpt.length);
});

test("decorated source fragments are included in full-page accounting", () => {
    const first = "Health probes identify whether an origin can accept production traffic. ";
    const second = "Priority and weight determine which healthy origin receives the next request.";
    const fixture = makePublishedEvidence({
        markdown: first + second,
        exactExcerpt: first,
    });

    const decorated = clone(fixture.bundle);
    decorated.sources[0].title = first;
    decorated.sources[0].sectionHeading = second;
    expectCode(
        () => validateResearchBundle(rehash(decorated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("dense decoration cannot hide a complete fetched page in prose", () => {
    const markdown = "0123456789".repeat(300);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 40),
    });
    const decorated = clone(fixture.bundle);
    decorated.claims[0].text = markdown.match(/.{1,63}/g).join("|");
    expectCode(
        () => validateResearchBundle(rehash(decorated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("decorated page fragments cannot be split across persisted fields", () => {
    const markdown = learnStylePage(4);
    const decorate = (text) => Array.from(text).join("|");
    const start = Math.floor(markdown.length * 0.05);
    const middle = Math.floor(markdown.length * 0.5);
    const end = Math.ceil(markdown.length * 0.95);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(start, start + 80),
    });
    const split = clone(fixture.bundle);
    split.claims[0].text = decorate(markdown.slice(middle, end));
    split.sources[0].whyItMatters = decorate(markdown.slice(start, middle));
    expectCode(
        () => validateResearchBundle(rehash(split), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("sub-32-character decorated fragments still count as verified spans", () => {
    const markdown = [
        "Azure routing evaluates health before selecting an origin. ",
        "Priority controls failover while weight balances healthy replicas. ",
        "Diagnostics explain each routing decision to operators. ",
        "Caching reduces repeated work at globally distributed edge locations.",
    ].join("");
    const chunks = markdown.match(/[\s\S]{1,20}/g);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: chunks[0],
    });
    const split = clone(fixture.bundle);
    split.claims = chunks.slice(1).map((chunk, index) => ({
        id: `claim-copy-${index + 1}`,
        text: `${chunk.slice(0, 10)}|${chunk.slice(10)}`,
        sourceIds: [split.sources[0].id],
        support: "supported",
    }));
    expectCode(
        () => validateResearchBundle(rehash(split), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("existing delimiters can be doubled without hiding copied spans", () => {
    const raw = "abcdefghi||jklmnopqrs";
    const markdown = raw.repeat(10);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: raw,
    });
    const copied = clone(fixture.bundle);
    copied.claims = Array.from({ length: 9 }, (_, index) => ({
        id: `claim-delimiter-copy-${index + 1}`,
        text: raw.replace("||", "||||"),
        sourceIds: [copied.sources[0].id],
        support: "supported",
    }));
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("rare inserted delimiters are aligned without a candidate-frequency cutoff", () => {
    const punctuation = [
        "!", "#", "$", "%", "&", "'", "(", ")", "*",
        "+", ",", "-", ".", "/", ":", ";", "?",
    ];
    const markdown = punctuation.map((
        character,
        index,
    ) => `${String.fromCharCode(65 + index)}${character}`).join("") + "terminal";
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown[0],
    });
    const copied = clone(fixture.bundle);
    const middle = Math.floor(markdown.length / 2);
    copied.claims[0].text = `${markdown.slice(0, middle)}~${markdown.slice(middle)}`;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("Unicode format characters cannot hide copied content", () => {
    const markdown = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown[0],
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = markdown.match(/.{1,8}/g).join("\u200b");
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("hidden control characters are rejected from persisted prose", () => {
    const markdown = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown[0],
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = markdown.match(/.{1,8}/g).join("\u0000");
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "UNSAFE_PERSISTED_TEXT",
    );
});

test("hidden fetched-page characters fail the capture boundary", () => {
    const markdown = "ABCDEFGH\u200bIJKLMNOPQRSTUVWXYZ";
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: "ABCDEFGH",
    });
    expectCode(
        () => validateResearchBundle(fixture.bundle, [fixture.capture]),
        ContractValidationError,
        "UNSAFE_FETCHED_MARKDOWN",
    );
});

test("Unicode combining marks cannot hide copied content", () => {
    const markdown = "AzureRoutingEvidence".repeat(48);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 23),
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = markdown.match(/.{1,31}/g).join("\u0301");
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("long insertion-only decoration is aligned exactly", () => {
    const markdown = (
        "Azure routing uses health probes and natural spaces while selecting an endpoint."
    );
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown[0],
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = markdown.match(/.{1,4}/g).join(" ");
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("decorated source spans are found inside bounded commentary", () => {
    const markdown = (
        "Azure routing uses health probes and natural spaces while selecting an endpoint."
    );
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown[0],
    });
    const copied = clone(fixture.bundle);
    const decorated = markdown.match(/.{1,4}/g).map((
        chunk,
        index,
    ) => `${chunk}${" ".repeat(index % 9 + 1)}`).join("");
    copied.claims[0].text = `Q | ${decorated}`;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("disjoint decorated copies in one field preserve multiplicity", () => {
    const repeated = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const markdown = `${repeated} !${repeated}`;
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: " !",
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = (
        `${Array.from(repeated).join(" ")} |Q| `
        + Array.from(repeated).join("!")
    );
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("one decorated field reserves a recovered source span once", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcdefabcdef",
        exactExcerpt: "a",
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = "abc|def";
    const result = validateResearchBundleWithRetention(
        rehash(copied),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, 7);
});

test("failed decoration gaps are processed within a bounded scan", {
    timeout: 2_000,
}, () => {
    const fixture = makePublishedEvidence({
        markdown: "e".repeat(2_000),
        exactExcerpt: "e",
    });
    const bounded = clone(fixture.bundle);
    bounded.claims[0].text = `${"|".repeat(2_000)}e`;
    const result = validateResearchBundleWithRetention(
        rehash(bounded),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, 2);
});

test("short pages do not use unrestricted subsequence matching", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcde",
        exactExcerpt: "a",
    });
    const unrelated = clone(fixture.bundle);
    unrelated.claims[0].text = "A broad curriculum develops practical expertise.";
    assert.equal(
        validateResearchBundle(rehash(unrelated), [fixture.capture]).claims.length,
        1,
    );
});

test("repeated occurrences are allocated globally rather than by field order", () => {
    const first = "X".repeat(20);
    const second = "Y".repeat(20);
    const fixture = makePublishedEvidence({
        markdown: first + second + first + first + second,
        exactExcerpt: first + second,
    });
    const copied = clone(fixture.bundle);
    copied.question.original = first;
    copied.question.normalized = first + second;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("global allocation explores alternatives beyond greedy request orders", () => {
    const first = "X".repeat(20);
    const second = "Y".repeat(20);
    const fixture = makePublishedEvidence({
        markdown: first + second + first + first + second,
        exactExcerpt: second + first + first,
    });
    const copied = clone(fixture.bundle);
    copied.question.original = first;
    copied.question.normalized = first + second;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("repeated excerpts account for distinct fetched-content occurrences", () => {
    const fixture = makePublishedEvidence({
        markdown: "aaaaaa",
        exactExcerpt: "aaa",
    });
    const repeated = clone(fixture.bundle);
    repeated.sources[0].whyItMatters = "aaa";
    expectCode(
        () => validateResearchBundle(rehash(repeated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("exact and decorated prose share one occurrence allocation", () => {
    const first = "The routing engine compares origin health and current capacity before selection. ";
    const second = "The selected endpoint receives the request only after every routing rule is evaluated.";
    const fixture = makePublishedEvidence({
        markdown: first + second,
        exactExcerpt: first,
        question: "Which endpoint receives the request?",
    });
    const mixed = clone(fixture.bundle);
    mixed.claims[0].text = Array.from(second).join("|");
    expectCode(
        () => validateResearchBundle(rehash(mixed), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("ordinary English prose does not count as fetched-page retention", () => {
    const markdown = learnStylePage(8);
    const excerpt = "Routing stage 3 evaluates health probes, origin priority, and regional capacity before Azure Front Door selects an endpoint.";
    const fixture = makePublishedEvidence({ markdown, exactExcerpt: excerpt });
    const result = validateResearchBundleWithRetention(
        withUnrelatedEnglishProse(fixture.bundle),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests.length, 1);
    assert.equal(result.retentionManifests[0].totalChars, excerpt.length);
    assert.deepEqual(result.retentionManifests[0].intervals.map((interval) => (
        markdown.slice(interval.start, interval.end)
    )), [excerpt]);
});

test("default fixture retention excludes coincidental character overlap", () => {
    const fixture = makePublishedEvidence();
    const result = validateResearchBundleWithRetention(
        fixture.bundle,
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars < 100, true);
});

test("large Learn-style pages ignore bounded unrelated English prose", () => {
    const markdown = learnStylePage(90);
    assert.equal(markdown.length > 12_000, true);
    const excerpt = "Routing stage 42 evaluates health probes, origin priority, and regional capacity before Azure Front Door selects an endpoint.";
    const fixture = makePublishedEvidence({ markdown, exactExcerpt: excerpt });
    const result = validateResearchBundleWithRetention(
        withUnrelatedEnglishProse(fixture.bundle),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, excerpt.length);
});

test("ordered reconstruction ignores substantial unrelated English prose", () => {
    const markdown = learnStylePageWithLength(20_000);
    const excerpt = markdown.slice(0, 80);
    const fixture = makePublishedEvidence({ markdown, exactExcerpt: excerpt });
    const baseline = validateResearchBundleWithRetention(
        fixture.bundle,
        [fixture.capture],
    ).retentionManifests[0].totalChars;
    const unrelated = clone(fixture.bundle);
    unrelated.claims = fragmentedFields(
        unrelatedEnglishWithLength(15_000),
        3_000,
        13,
    ).map((text, index) => ({
        id: `claim-unrelated-long-${index + 1}`,
        text,
        sourceIds: [unrelated.sources[0].id],
        support: "supported",
    }));
    const result = validateResearchBundleWithRetention(
        rehash(unrelated),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, baseline);
});

test("unordered reconstruction ignores high-volume unrelated English prose", () => {
    const markdown = learnStylePageWithLength(6_000);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    const baseline = validateResearchBundleWithRetention(
        fixture.bundle,
        [fixture.capture],
    ).retentionManifests[0].totalChars;
    const unrelated = clone(fixture.bundle);
    unrelated.claims = fragmentedFields(
        unrelatedEnglishWithLength(24_000),
        3_000,
        13,
    ).map((text, index) => ({
        id: `claim-unrelated-volume-${index + 1}`,
        text,
        sourceIds: [unrelated.sources[0].id],
        support: "supported",
    }));
    const result = validateResearchBundleWithRetention(
        rehash(unrelated),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, baseline);
});

test("low-digit unrelated English cannot resemble a page by character counts", () => {
    const markdown = repeatNaturalLanguage(
        "Gardeners prepare healthy soil, rotate seasonal vegetables, prune flowering shrubs, and water young seedlings before sunrise.",
        2_600,
    );
    const unrelatedProse = repeatNaturalLanguage(
        "Cooks knead bread dough, simmer fragrant sauces, sharpen kitchen knives, and arrange fresh ingredients before serving dinner.",
        3_400,
    );
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    const baseline = validateResearchBundleWithRetention(
        fixture.bundle,
        [fixture.capture],
    ).retentionManifests[0].totalChars;
    const unrelated = clone(fixture.bundle);
    unrelated.claims = fragmentedFields(unrelatedProse, 850, 4).map((
        text,
        index,
    ) => ({
        id: `claim-unrelated-low-digit-${index + 1}`,
        text,
        sourceIds: [unrelated.sources[0].id],
        support: "supported",
    }));
    const result = validateResearchBundleWithRetention(
        rehash(unrelated),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars, baseline);
});

test("overlap-aware allocation bounds accept provably bounded repeats", () => {
    const markdown = `${"A".repeat(800)}${"B".repeat(200)}`;
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: "A".repeat(20),
    });
    const bounded = clone(fixture.bundle);
    bounded.claims = [226, 227, 228, 229].map((length, index) => ({
        id: `claim-overlap-${index + 1}`,
        text: "A".repeat(length),
        sourceIds: [bounded.sources[0].id],
        support: "supported",
    }));
    const result = validateResearchBundleWithRetention(
        rehash(bounded),
        [fixture.capture],
    );
    assert.equal(result.retentionManifests[0].totalChars <= 800, true);
});

test("undeclared fetch captures are still scanned for copied page content", () => {
    const declared = makePublishedEvidence();
    const undeclared = makePublishedEvidence({
        version: 2,
        markdown: "Z".repeat(500),
        exactExcerpt: "Z".repeat(20),
    });
    const copied = clone(declared.bundle);
    copied.claims[0].text = undeclared.markdown;
    expectCode(
        () => validateResearchBundle(
            rehash(copied),
            [declared.capture, undeclared.capture],
        ),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("source retrieval time must come from the trusted fetch capture", () => {
    const fixture = makePublishedEvidence();
    const forgedTime = clone(fixture.bundle);
    forgedTime.sources[0].retrievedAt = "2099-01-01T00:00:00Z";
    expectCode(
        () => validateResearchBundle(rehash(forgedTime), [fixture.capture]),
        ContractValidationError,
        "RETRIEVAL_TIME_MISMATCH",
    );
});

test("repeated identical fetches match the declared observed timestamp", () => {
    const fixture = makePublishedEvidence();
    const secondCapture = {
        ...fixture.capture,
        captureId: "10000000-0000-4000-8000-000000000099",
        observedAt: "2026-08-12T09:02:00Z",
    };
    const later = clone(fixture.bundle);
    later.sources[0].retrievedAt = "2026-08-12T09:02:00Z";
    assert.equal(
        validateResearchBundle(
            rehash(later),
            [fixture.capture, secondCapture],
        ).sources[0].retrievedAt,
        "2026-08-12T09:02:00.000Z",
    );
});

test("source URL policy remains exact-host HTTPS", () => {
    const fixture = makePublishedEvidence();
    const invalid = clone(fixture.bundle);
    invalid.sources[0].canonicalUrl = "https://learn.microsoft.com.example/azure/example";
    expectCode(
        () => validateResearchBundle(invalid, [fixture.capture]),
        ContractValidationError,
        "INVALID_LEARN_HOST",
    );
});

test("adapter normalizes raw arrays and results objects", () => {
    const array = adaptLearnMcpResult("docs-search", [{
        title: "A",
        url: "https://learn.microsoft.com/azure/a",
    }]);
    const object = adaptLearnMcpResult("docs-search", {
        results: [{
            title: "A",
            url: "https://learn.microsoft.com/azure/a",
        }],
    });
    assert.equal(array.resultCount, 1);
    assert.equal(array.resultSha256, object.resultSha256);
    assert.deepEqual(array.sourceUrls, ["https://learn.microsoft.com/azure/a"]);
});

test("adapter normalizes structured content, MCP text blocks, and wrapper envelopes", () => {
    const expected = [{ title: "A" }];
    const structured = adaptLearnMcpResult("docs-search", {
        structuredContent: { results: expected },
        resultType: "success",
    });
    const blocks = adaptLearnMcpResult("docs-search", {
        content: [{ type: "text", text: JSON.stringify({ results: expected }) }],
    });
    const wrapper = adaptLearnMcpResult("docs-search", {
        resultType: "success",
        textResultForLlm: JSON.stringify({ results: expected }),
        contents: [{ type: "text", text: "ignored because textResultForLlm follows blocks" }],
    });
    assert.equal(structured.resultSha256, blocks.resultSha256);
    assert.equal(wrapper.resultCount, 1);
});

test("adapter normalizes fetched Markdown without persisting it in summaries", () => {
    const markdown = "# Heading\r\n\nExact quote.\r\n";
    const result = adaptLearnMcpResult("docs-fetch", {
        resultType: "success",
        contents: [{ type: "text", text: markdown }],
    }, {
        canonicalUrl: "https://learn.microsoft.com/azure/example",
        retrievalUrl: "https://learn.microsoft.com/azure/example?view=current",
    });
    assert.equal(result.resultSha256, hashFetchedMarkdown(markdown));
    assert.equal(result.preview.includes("Exact quote."), true);
    assert.equal(result.truncated, false);
});

test("adapter rejects malformed JSON and unknown result shapes", () => {
    expectCode(
        () => adaptLearnMcpResult("docs-search", "{not json"),
        LearnMcpAdapterError,
        "MALFORMED_JSON",
    );
    expectCode(
        () => adaptLearnMcpResult("docs-search", { payload: 1 }),
        LearnMcpAdapterError,
        "UNKNOWN_RESULT_SHAPE",
    );
});

test("adapter rejects protocol, tool, and success-shaped domain failures", () => {
    for (const [value, code] of [
        [{ jsonrpc: "2.0", error: { code: -32602, message: "bad input" } }, "MCP_ERROR"],
        [{ isError: true, content: [{ type: "text", text: "failed" }] }, "TOOL_RESULT_FAILED"],
        [{ resultType: "success", textResultForLlm: "Unable to fetch the requested page." }, "FAILURE_SHAPED_TEXT"],
        [{
            resultType: "success",
            textResultForLlm: "The provided URL points to a page that could not be retrieved. Verify the URL and try again.",
        }, "FAILURE_SHAPED_TEXT"],
        [{
            content: [
                { type: "text", text: "Result:" },
                { type: "text", text: '{"result":{"isError":true,"error":"not found"}}' },
            ],
        }, "MCP_ERROR"],
    ]) {
        expectCode(
            () => adaptLearnMcpResult("docs-fetch", value, {
                canonicalUrl: "https://learn.microsoft.com/azure/example",
                retrievalUrl: "https://learn.microsoft.com/azure/example",
            }),
            LearnMcpAdapterError,
            code,
        );
    }
    expectCode(
        () => adaptLearnMcpResult(
            "docs-fetch",
            JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32602, message: "bad input" },
            }),
            {
                canonicalUrl: "https://learn.microsoft.com/azure/example",
                retrievalUrl: "https://learn.microsoft.com/azure/example",
            },
        ),
        LearnMcpAdapterError,
        "MCP_ERROR",
    );
});

test("dynamic discovery maps arbitrary runtime names and argument spellings", () => {
    const tools = discoverLearnOperations({
        tools: [
            {
                name: "opaque-a",
                description: "Fetch a documentation page",
                inputSchema: {
                    type: "object",
                    properties: {
                        address: { type: "string", format: "uri" },
                    },
                    required: ["address"],
                },
            },
            {
                name: "opaque-b",
                description: "Search documentation",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                    },
                    required: ["prompt"],
                },
            },
            {
                name: "opaque-c",
                description: "Search code examples",
                inputSchema: {
                    type: "object",
                    properties: {
                        keywords: { type: "string", description: "Search keywords" },
                        dialect: { type: "string", description: "Programming language" },
                    },
                    required: ["keywords"],
                },
            },
        ],
    });
    assert.equal(tools["docs-fetch"].runtimeName, "opaque-a");
    assert.equal(tools["docs-fetch"].argumentKeys.resource, "address");
    assert.equal(tools["code-sample-search"].runtimeName, "opaque-c");
});

test("dynamic discovery fails explicitly on schema drift", () => {
    expectCode(
        () => discoverLearnOperations([{
            name: "opaque",
            inputSchema: {
                type: "object",
                properties: { value: { type: "number" } },
                required: ["value"],
            },
        }]),
        LearnMcpAdapterError,
        "SCHEMA_DRIFT",
    );
});

test("dynamic discovery accepts optional query properties from current schemas", () => {
    const tools = discoverLearnOperations([
        {
            name: "fetch-runtime",
            description: "Fetch a documentation page",
            inputSchema: {
                type: "object",
                properties: {
                    address: { type: "string", format: "uri" },
                },
                required: ["address"],
            },
        },
        {
            name: "search-runtime",
            description: "Search documentation",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Search query",
                        default: null,
                    },
                },
            },
        },
        {
            name: "code-runtime",
            description: "Search code samples",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Search query",
                        default: null,
                    },
                    language: {
                        type: "string",
                        description: "Programming language",
                    },
                },
            },
        },
    ]);
    assert.equal(tools["docs-search"].argumentKeys.query, "prompt");
    assert.equal(tools["code-sample-search"].argumentKeys.language, "language");
});

test("adapter connection surfaces list and call protocol failures", async () => {
    const listFailure = new LearnMcpAdapter({
        listTools: async () => {
            throw new Error("offline");
        },
        callTool: async () => [],
    });

    await assert.rejects(listFailure.connect(), (error) => (
        error instanceof LearnMcpAdapterError && error.code === "PROTOCOL_FAILURE"
    ));

    const definitions = [
        {
            name: "fetch",
            description: "Fetch a page",
            inputSchema: {
                type: "object",
                properties: { address: { type: "string", format: "uri" } },
                required: ["address"],
            },
        },
        {
            name: "search",
            description: "Search docs",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string", description: "Search query" } },
                required: ["prompt"],
            },
        },
        {
            name: "code",
            description: "Search code",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Search query" },
                    language: { type: "string", description: "Programming language" },
                },
                required: ["prompt"],
            },
        },
    ];
    const callFailure = new LearnMcpAdapter({
        listTools: async () => definitions,
        callTool: async () => {
            throw new Error("transport reset");
        },
    });
    await callFailure.connect();
    await assert.rejects(
        callFailure.execute("docs-search", { prompt: "azure" }),
        (error) => error instanceof LearnMcpAdapterError && error.code === "PROTOCOL_FAILURE",
    );
});

test("fetch arguments are host-validated before invoking the runtime tool", async () => {
    let calls = 0;
    const adapter = new LearnMcpAdapter({
        listTools: async () => [
            {
                name: "fetch",
                description: "Fetch a page",
                inputSchema: {
                    type: "object",
                    properties: { address: { type: "string", format: "uri" } },
                    required: ["address"],
                },
            },
            {
                name: "search",
                description: "Search documentation",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                    },
                },
            },
            {
                name: "code",
                description: "Search code",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                        language: { type: "string", description: "Programming language" },
                    },
                },
            },
        ],
        callTool: async () => {
            calls += 1;
            return "should not run";
        },
    });
    await adapter.connect();
    await assert.rejects(
        adapter.execute("docs-fetch", { address: "https://example.com/private" }),
        (error) => error.code === "INVALID_LEARN_HOST",
    );
    assert.equal(calls, 0);
});
