import { afterEach, describe, expect, it } from "vitest";
import {
    NORMALIZED_PAYLOAD_VERSION,
    RAW_PAYLOAD_VERSION,
    shouldUseCachedNormalizedPayload,
    shouldUseCachedReport,
} from "./cache-policy.js";

const previousBypassCache = process.env.WCL_BYPASS_CACHE;

const makeCompletedRawPayload = (rawPayloadVersion = RAW_PAYLOAD_VERSION): unknown => ({
    rawPayloadVersion,
    base: {
        reportData: {
            report: {
                zone: { frozen: true },
                fights: [],
            },
        },
    },
});

afterEach(() => {
    if (previousBypassCache === undefined) {
        delete process.env.WCL_BYPASS_CACHE;
    } else {
        process.env.WCL_BYPASS_CACHE = previousBypassCache;
    }
});

describe("cache policy", () => {
    it("rejects stale raw payload versions", () => {
        expect(
            shouldUseCachedReport({
                rawPayload: makeCompletedRawPayload(RAW_PAYLOAD_VERSION - 1),
                fetchedAt: new Date(),
            }),
        ).toBe(false);
    });

    it("reuses completed reports with the current raw payload version", () => {
        expect(
            shouldUseCachedReport({
                rawPayload: makeCompletedRawPayload(),
                fetchedAt: new Date(0),
            }),
        ).toBe(true);
    });

    it("reuses current normalized payload versions by default", () => {
        expect(
            shouldUseCachedNormalizedPayload({
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
            }),
        ).toBe(true);
    });

    it("bypasses normalized payload reuse when requested", () => {
        process.env.WCL_BYPASS_CACHE = "true";

        expect(
            shouldUseCachedNormalizedPayload({
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
            }),
        ).toBe(false);
    });
});
