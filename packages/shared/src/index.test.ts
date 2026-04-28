import { describe, expect, it } from "vitest";
import { serializeError } from "./index.js";

describe("serializeError", () => {
    it("serializes normal Error objects", () => {
        expect(serializeError(new Error("boom"))).toMatchObject({
            name: "Error",
            message: "boom",
        });
    });

    it("serializes Error causes recursively", () => {
        const error = new Error("outer", { cause: new TypeError("inner") });

        expect(serializeError(error)).toMatchObject({
            name: "Error",
            message: "outer",
            cause: {
                name: "TypeError",
                message: "inner",
            },
        });
    });

    it("serializes non-Error thrown values", () => {
        expect(serializeError("bad value")).toEqual({ message: "bad value" });
    });
});
