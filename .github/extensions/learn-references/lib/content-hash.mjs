import { canonicalJson, sha256Hex } from "./canonical-json.mjs";
import { normalizeEvidenceBundle } from "./evidence-bundle.mjs";
import { fail } from "./validation.mjs";

export function immutableEvidenceContent(bundleInput) {
    const bundle = normalizeEvidenceBundle(bundleInput);
    const {
        status: _status,
        lifecycle: _lifecycle,
        contentHash: _contentHash,
        ...content
    } = bundle;
    return content;
}

export function computeEvidenceContentHash(bundleInput) {
    return sha256Hex(canonicalJson(immutableEvidenceContent(bundleInput)));
}

export function assertEvidenceContentHash(bundleInput) {
    const bundle = normalizeEvidenceBundle(bundleInput);
    const actual = computeEvidenceContentHash(bundle);
    if (bundle.contentHash !== actual) {
        fail(
            "CONTENT_HASH_MISMATCH",
            "$.contentHash",
            `does not match immutable evidence content; expected ${actual}`,
        );
    }
    return bundle;
}

export function setEvidenceContentHash(bundleInput) {
    const bundle = normalizeEvidenceBundle(bundleInput);
    return normalizeEvidenceBundle({
        ...bundle,
        contentHash: computeEvidenceContentHash(bundle),
    });
}
