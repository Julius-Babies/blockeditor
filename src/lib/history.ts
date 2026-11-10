import {buildPageFromState, type Page, type PageState} from "#lib/page.ts";

export type HistoryAction = { timestamp: number } &
    (
        { type: "insert", payload: string, index: number } |
        { type: "delete", from: number, to: number }
        )


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