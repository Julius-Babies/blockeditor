import {buildPageFromState, type Page, type PageState} from "#lib/page.ts";

export type HistoryAction = { timestamp: number, previousCommitId: string, commitId: string, clientId: string } &
    (
        { type: "insert", payload: string, index: number } |
        { type: "delete", from: number, to: number }
        )


export function shiftHistoryAction<T extends HistoryAction>(
    action: T,
    by: number
): T {
    const cloned = structuredClone(action);
    switch (cloned.type) {
        case "insert":
            cloned.index += by;
            break;
        case "delete":
            cloned.from += by;
            cloned.to += by;
            break;
    }

    return cloned;
}

export function shiftHistoryActionIfPositionIsAfter<T extends HistoryAction>(
    action: T,
    by: number,
    after: number
): T {
    switch (action.type) {
        case "insert":
            if (action.index >= after) return shiftHistoryAction(action, by);
            break;
        case "delete":
            if (action.from >= after) return shiftHistoryAction(action, by);
            break;
    }

    return action;
}

export function applyHistoryToPageState(page: PageState, events: HistoryAction[]): PageState {
    let result = page;
    events
        .toSorted((a, b) => a.timestamp - b.timestamp)
        .forEach(event => {
            if (event.type === "insert") {
                result.textContent = result.textContent.slice(0, event.index) + event.payload + result.textContent.slice(event.index, result.textContent.length);
                result.blockMarkers
                    .filter(marker => marker.startPosition > event.index)
                    .forEach(marker => {
                        marker.startPosition += event.payload.length;
                    })
            } else if (event.type === "delete") {
                result.textContent = result.textContent.slice(0, event.from) + result.textContent.slice(event.to, result.textContent.length);
                result.blockMarkers = result.blockMarkers
                    .filter((marker, index) => {
                        const nextMarker = index < result.blockMarkers.length - 1 ? result.blockMarkers[index + 1] : null;
                        if (nextMarker) return !(marker.startPosition >= event.from && nextMarker.startPosition - 1 <= event.to)
                        return true
                    })
            }
        })

    return result;
}

export function buildPageFromStateAndHistory(page: PageState, events: HistoryAction[]): Page {
    return buildPageFromState(applyHistoryToPageState(page, events));
}

/**
 * @param a
 * @param b
 * @param priority
 * @return b with a applied
 */
export function applyHistoryAction(a: HistoryAction, b: HistoryAction, priority: "a" | "b"): HistoryAction {
    let aCopy = structuredClone(a);
    let bCopy = structuredClone(b);
    switch (aCopy.type) {
        case "insert":
            if (bCopy.type === "delete" && bCopy.from < aCopy.index && aCopy.index < bCopy.to) {
                bCopy.to += aCopy.payload.length;
            } else if (bCopy.type === "insert") {
                // On the same index the action with priority goes first: b only moves behind a's text if a has priority.
                const bComesAfterA = bCopy.index > aCopy.index || (bCopy.index === aCopy.index && priority === "a");
                if (bComesAfterA) bCopy = shiftHistoryAction(bCopy, aCopy.payload.length);
            } else if (bCopy.type === "delete" && aCopy.index <= bCopy.from) {
                // a inserted in front of (or exactly at the start of) the deleted range: move the whole range.
                bCopy = shiftHistoryAction(bCopy, aCopy.payload.length);
            }
            break;
        case "delete": {
            // Maps a position from before a's delete to the position after it. Positions inside the deleted range
            // collapse to its start.
            const deleted = aCopy;
            const map = (position: number) =>
                position <= deleted.from ? position
                    : position >= deleted.to ? position - (deleted.to - deleted.from)
                        : deleted.from;

            switch (bCopy.type) {
                case "insert":
                    if (bCopy.index > aCopy.from && bCopy.index < aCopy.to) {
                        // The inserted text lies inside the range deleted by a: keep the entry (its commit must
                        // stay known for syncing) but turn it into a no-op at the start of the deleted range.
                        bCopy = {...bCopy, index: aCopy.from, payload: ""};
                    } else {
                        bCopy.index = map(bCopy.index);
                    }
                    break;
                case "delete":
                    // Only the part of b that a has not deleted yet remains. If a covers b completely, b collapses
                    // to an empty delete (no-op).
                    bCopy.from = map(bCopy.from);
                    bCopy.to = map(bCopy.to);
                    break;
            }

            break;
        }
    }

    return bCopy;
}

export function mergeHistory(baseState: PageState, baseHistory: HistoryAction[], toMerge: HistoryAction): HistoryAction[] {
    const previousCommits = [baseState.commit_id, ...baseHistory.map(event => event.commitId)];
    if (!previousCommits.includes(toMerge.previousCommitId)) {
        throw new Error("Missing parent commit: " + toMerge.previousCommitId);
    }

    const toMergeParentIndex = baseHistory.findIndex(h => h.commitId === toMerge.previousCommitId);
    let mergedUntilIndex = toMerge.previousCommitId === baseState.commit_id ? 0 : (toMergeParentIndex + 1);

    const toMergeActualState = structuredClone(toMerge);

    while (mergedUntilIndex < baseHistory.length) {
        // Perform merge
        let target = baseHistory[mergedUntilIndex];

        baseHistory[mergedUntilIndex] = applyHistoryAction(toMerge, target, "a");
        toMerge = applyHistoryAction(target, toMerge, "b");


        mergedUntilIndex++;
    }

    if (toMergeParentIndex + 1 < baseHistory.length)
        baseHistory[toMergeParentIndex + 1].previousCommitId = toMerge.commitId;

    return [...baseHistory.slice(0, toMergeParentIndex+1), toMergeActualState, ...baseHistory.slice(toMergeParentIndex + 1, baseHistory.length)];
}