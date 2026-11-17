import type {PageState} from "#lib/page.ts";
import type {HistoryAction} from "#lib/history.ts";

export let baseState: PageState = {
    commit_id: "commit-0",
    textContent: "Hello World",
    blockMarkers: [
        {
            id: crypto.randomUUID(),
            type: "text",
            startPosition: 0,
        }
    ]
}

export let history: HistoryAction[] = [];
export function setHistory(h: HistoryAction[]) { history = h }