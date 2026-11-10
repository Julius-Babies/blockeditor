export type Page = {
    blocks: Block[]
}

type BlockBase = { id: string }

export type TextBlock = BlockBase & { type: "text", content: string }

export type Block = TextBlock

export function getBlockAtPosition(page: Page, position: number): { block: TextBlock, remaining: number } | null {
    let blockIndex = 0;
    let remaining = position;
    while (true) {
        const block = page.blocks[blockIndex];
        console.log(block, remaining)
        if (!block) return null;
        if (block.type !== "text") {
            blockIndex++;
            continue;
        }

        if (remaining > block.content.length) {
            remaining -= block.content.length;
            blockIndex++;
            continue;
        }

        return {
            block: block,
            remaining: remaining,
        };
    }
}

export type PageState = {
    textContent: string;
    blockMarkers: {
        startPosition: number;
        type: "text",
        id: string;
    }[]
}

export function buildPageFromState(state: PageState): Page {
    let page: Page = {
        blocks: [],
    }

    state.blockMarkers.forEach((marker, i) => {
        if (marker.type === "text") {
            const nextBlockMarker = i < state.blockMarkers.length - 1 ? state.blockMarkers[i + 1] : null;
            const block: TextBlock = {
                id: marker.id,
                type: "text",
                content: nextBlockMarker ? state.textContent.slice(marker.startPosition, nextBlockMarker.startPosition - 1) : state.textContent.slice(marker.startPosition, state.textContent.length)
            }

            page.blocks.push(block);
        }
    })

    return page;
}