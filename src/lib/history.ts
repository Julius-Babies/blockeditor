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

export function mergeHistory(baseState: PageState, baseHistory: HistoryAction[], toMerge: HistoryAction): HistoryAction[] {
    const previousCommits = [baseState.commit_id, ...baseHistory.map(event => event.commitId)];
    if (!previousCommits.includes(toMerge.previousCommitId)) {
        throw new Error("Missing parent commit: " + toMerge.previousCommitId);
    }

    /**
     * Whether the pointer to the parent of a [baseHistory] item has already been set to our new toMerge event.
     */
    let hasBaseHistoryParentBeenChangedToNewCommit = false;
    let mergedUntilIndex = toMerge.previousCommitId === baseState.commit_id ? 0 : (baseHistory.findIndex(h => h.commitId === toMerge.previousCommitId) + 1);

    while (mergedUntilIndex < baseHistory.length - 1) {
        // Perform merge
        let target = baseHistory[mergedUntilIndex];
        if (!hasBaseHistoryParentBeenChangedToNewCommit) {
            target.previousCommitId = toMerge.commitId;
        }

        switch (toMerge.type) {
            case "insert":
                baseHistory[mergedUntilIndex] = shiftHistoryActionIfPositionIsAfter(target, toMerge.payload.length, toMerge.index);
                break;
            case "delete":
                baseHistory[mergedUntilIndex] = shiftHistoryActionIfPositionIsAfter(target, toMerge.from - toMerge.to, toMerge.from);
                break;
        }
    }

    const toMergeParentIndex = baseHistory.findIndex(h => h.commitId === toMerge.previousCommitId);
    return [...baseHistory.slice(0, toMergeParentIndex), toMerge, ...baseHistory.slice(toMergeParentIndex + 1, baseHistory.length)];
}