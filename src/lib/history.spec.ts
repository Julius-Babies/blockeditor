import {describe, expect, it} from "vitest";
import {applyHistoryToPageState, type HistoryAction, mergeHistory} from "#lib/history.ts";
import type {PageState} from "#lib/page.ts";

const BASE_COMMIT = "commit-0";

function baseState(textContent = "Hello World"): PageState {
    return {
        commit_id: BASE_COMMIT,
        textContent,
        blockMarkers: [{id: "block-1", type: "text", startPosition: 0}],
    };
}

let timestamp = 0;

function insert(commitId: string, previousCommitId: string, index: number, payload: string, clientId = "client-a"): HistoryAction {
    return {type: "insert", index, payload, commitId, previousCommitId, clientId, timestamp: ++timestamp};
}

function del(commitId: string, previousCommitId: string, from: number, to: number, clientId = "client-a"): HistoryAction {
    return {type: "delete", from, to, commitId, previousCommitId, clientId, timestamp: ++timestamp};
}

/**
 * Applies the history in array order (= commit chain order), independent of the timestamps.
 */
function textAfter(state: PageState, history: HistoryAction[]): string {
    const ordered = history.map((action, i) => ({...action, timestamp: i}));
    return applyHistoryToPageState(structuredClone(state), ordered).textContent;
}

/**
 * Every entry must point to its predecessor, the first one to the base state.
 */
function expectLinearChain(state: PageState, history: HistoryAction[]) {
    history.forEach((action, i) => {
        const expectedParent = i === 0 ? state.commit_id : history[i - 1].commitId;
        expect(action.previousCommitId, `parent of ${action.commitId}`).toBe(expectedParent);
    });
}

describe("mergeHistory", () => {
    describe("validation", () => {
        it("throws if the parent commit of toMerge is unknown", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 0, "A")];
            const toMerge = insert("x", "does-not-exist", 0, "X", "client-b");

            expect(() => mergeHistory(state, history, toMerge)).toThrow("Missing parent commit: does-not-exist");
        });
    });

    describe("no concurrent changes (fast-forward)", () => {
        it("appends toMerge to an empty history based on the base state", () => {
            const state = baseState();
            const toMerge = insert("x", BASE_COMMIT, 5, ",", "client-b");

            const result = mergeHistory(state, [], toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x"]);
            expect(textAfter(state, result)).toBe("Hello, World");
        });

        it("appends toMerge when its parent is the last history entry", () => {
            const state = baseState();
            const history = [
                insert("c1", BASE_COMMIT, 0, "A"),
                insert("c2", "c1", 1, "B"),
            ];
            const toMerge = insert("x", "c2", 13, "!", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["c1", "c2", "x"]);
            expectLinearChain(state, result);
            expect(textAfter(state, result)).toBe("ABHello World!");
        });
    });

    describe("concurrent inserts", () => {
        it("shifts a later base insert behind a concurrent insert in front of it", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 11, "!")];
            const toMerge = insert("x", BASE_COMMIT, 0, "Oh ", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1"]);
            expectLinearChain(state, result);
            expect(result[1]).toMatchObject({type: "insert", index: 14});
            expect(textAfter(state, result)).toBe("Oh Hello World!");
        });

        it("does not shift a base insert that lies before the concurrent insert", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 0, "Oh ")];
            const toMerge = insert("x", BASE_COMMIT, 11, "!", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1"]);
            expectLinearChain(state, result);
            expect(result[1]).toMatchObject({type: "insert", index: 0});
            expect(textAfter(state, result)).toBe("Oh Hello World!");
        });

        it("places the base insert after the merged insert when both insert at the same position", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 5, "B")];
            const toMerge = insert("x", BASE_COMMIT, 5, "A", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(textAfter(state, result)).toBe("HelloAB World");
        });

        it("rebases multiple base entries and only re-parents the first one", () => {
            const state = baseState();
            const history = [
                insert("c1", BASE_COMMIT, 0, "1"),
                insert("c2", "c1", 1, "2"),
                insert("c3", "c2", 13, "?"),
            ];
            const toMerge = insert("x", BASE_COMMIT, 11, "!", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1", "c2", "c3"]);
            expectLinearChain(state, result);
            expect(textAfter(state, result)).toBe("12Hello World!?");
        });

        it("inserts toMerge directly after its parent when the parent is in the middle of the history", () => {
            const state = baseState();
            const history = [
                insert("c1", BASE_COMMIT, 0, "A"),
                insert("c2", "c1", 12, "B"),
            ];
            // client-b only knew about c1 ("AHello World")
            const toMerge = insert("x", "c1", 1, "X", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["c1", "x", "c2"]);
            expectLinearChain(state, result);
            expect(result[2]).toMatchObject({type: "insert", index: 13});
            expect(textAfter(state, result)).toBe("AXHello WorldB");
        });
    });

    describe("concurrent deletes and inserts (non-overlapping)", () => {
        it("shifts a later base insert to the left after a concurrent delete in front of it", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 11, "!")];
            const toMerge = del("x", BASE_COMMIT, 0, 6, "client-b"); // removes "Hello "

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1"]);
            expectLinearChain(state, result);
            expect(result[1]).toMatchObject({type: "insert", index: 5});
            expect(textAfter(state, result)).toBe("World!");
        });

        it("shifts a later base delete to the right after a concurrent insert in front of it", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 6, 11)]; // removes "World"
            const toMerge = insert("x", BASE_COMMIT, 0, "Oh ", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result[1]).toMatchObject({type: "delete", from: 9, to: 14});
            expect(textAfter(state, result)).toBe("Oh Hello ");
        });

        it("does not touch a base delete that lies before a concurrent insert", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 0, 6)]; // removes "Hello "
            const toMerge = insert("x", BASE_COMMIT, 11, "!", "client-b");

            const result = mergeHistory(state, history, toMerge);

            expect(result[1]).toMatchObject({type: "delete", from: 0, to: 6});
            expect(textAfter(state, result)).toBe("World!");
        });

        it("handles two concurrent non-overlapping deletes", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 6, 11)]; // removes "World"
            const toMerge = del("x", BASE_COMMIT, 0, 1, "client-b"); // removes "H"

            const result = mergeHistory(state, history, toMerge);

            expect(result[1]).toMatchObject({type: "delete", from: 5, to: 10});
            expect(textAfter(state, result)).toBe("ello ");
        });
    });

    /**
     * A delete of a range and a concurrent edit inside that range.
     *
     * Expected behaviour (decision, can be changed): the delete wins, text that was inserted inside the
     * deleted range is discarded. Entries are never dropped, they become no-ops.
     * Both directions (who deletes / who inserts) must converge to the same text.
     */
    describe("delete of a range + concurrent edit inside that range", () => {
        it("base inserts inside a range that is deleted concurrently", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 8, "X")]; // "Hello WoXrld"
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            expect(textAfter(state, result)).toBe("Hello ");
        });

        it("base deletes a range in which an insert happened concurrently", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 6, 11)]; // removes "World"
            const toMerge = insert("x", BASE_COMMIT, 8, "X", "client-b"); // "Hello WoXrld"

            const result = mergeHistory(state, history, toMerge);

            expect(textAfter(state, result)). toBe("Hello ");
        });

        it("base deletes a range inside a range that is deleted concurrently", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 7, 9)]; // removes "or"
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            expect(textAfter(state, result)).toBe("Hello ");
        });

        it("two concurrent deletes partially overlap", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 3, 8)]; // removes "lo Wo"
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            expect(textAfter(state, result)).toBe("Hel");
        });

        it("keeps a base insert that sits exactly at the start of a concurrently deleted range", () => {
            const state = baseState();
            const history = [insert("c1", BASE_COMMIT, 6, ">")]; // "Hello >World"
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            // The insert is not *inside* the deleted range, so it survives (delete ranges are [from, to)).
            expect(textAfter(state, result)).toBe("Hello >");
        });

        it("keeps a merged insert that sits exactly at the start of a range deleted in the base history", () => {
            const state = baseState();
            const history = [del("c1", BASE_COMMIT, 6, 11)]; // removes "World"
            const toMerge = insert("x", BASE_COMMIT, 6, ">", "client-b"); // "Hello >World"

            const result = mergeHistory(state, history, toMerge);

            expect(result[1]).toMatchObject({type: "delete", from: 7, to: 12});
            expect(textAfter(state, result)).toBe("Hello >");
        });

        it("still rebases the entry that follows an insert that became a no-op", () => {
            const state = baseState("Hello World, bye");
            const history = [
                insert("c1", BASE_COMMIT, 8, "X"), // "Hello WoXrld, bye"  -> becomes a no-op
                insert("c2", "c1", 14, "?"),       // "Hello WoXrld, ?bye"
            ];
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1", "c2"]); // entries are never dropped, only turned into no-ops
            expectLinearChain(state, result);
            expect(textAfter(state, result)).toBe("Hello , ?bye");
        });

        it("still rebases the entry that follows a delete that became a no-op", () => {
            const state = baseState();
            const history = [
                del("c1", BASE_COMMIT, 7, 9), // "Hello Wld"  -> fully covered by toMerge, becomes a no-op
                insert("c2", "c1", 9, "!"),   // "Hello Wld!"
            ];
            const toMerge = del("x", BASE_COMMIT, 6, 11, "client-b"); // removes "World"

            const result = mergeHistory(state, history, toMerge);

            expect(result.map(a => a.commitId)).toEqual(["x", "c1", "c2"]);
            expectLinearChain(state, result);
            expect(textAfter(state, result)).toBe("Hello !");
        });
    });
});
