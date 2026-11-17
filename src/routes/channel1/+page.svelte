<script lang="ts">
    import type {PageState} from "#lib/page.ts";
    import {buildPageFromStateAndHistory, type HistoryAction, mergeHistory} from "#lib/history.ts";
    import InputField from "#lib/InputField.svelte";

    const clientId = crypto.randomUUID();

    let isOnline = $state(true);

    let baseState: PageState = $state({
        commit_id: "commit-0",
        textContent: "Hello World",
        blockMarkers: [
            {
                id: crypto.randomUUID(),
                type: "text",
                startPosition: 0,
            }
        ]
    })

    let history: HistoryAction[] = $state([]);

    let currentPage = $derived.by(() => buildPageFromStateAndHistory($state.snapshot(baseState), history));

    let cursorPosition = $state(4);

    function onCharInserted(position: number, char: string) {
        const event: HistoryAction = {
            type: "insert",
            payload: char,
            index: position,
            timestamp: Date.now(),
            clientId: clientId,
            previousCommitId: history.length == 0 ? baseState.commit_id : history[history.length - 1].commitId,
            commitId: crypto.randomUUID(),
        };
        history.push(event);
        cursorPosition += char.length;
        sendEventToServer(event);
    }

    function onCharRemoved(char: string, position: number) {
        const event: HistoryAction = {
            type: "delete",
            from: position,
            to: position + char.length,
            timestamp: Date.now(),
            clientId: clientId,
            previousCommitId: history.length == 0 ? baseState.commit_id : history[history.length - 1].commitId,
            commitId: crypto.randomUUID(),
        };
        history.push(event);
        cursorPosition -= char.length;
        sendEventToServer(event);
    }

    function sendEventToServer(event: HistoryAction) {
        fetch("/channel1/push-history", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify([event]),
        })
    }

    function downloadAndMergeHistory() {
        fetch("/channel1/get-history")
            .then(response => response.json())
            .then((data: HistoryAction[]) => {
                data.forEach((historyItem: HistoryAction) => {
                    const existingCommitIds = history.map(h => h.commitId);

                    if (existingCommitIds.includes(historyItem.commitId)) {

                    } else {
                        history = mergeHistory($state.snapshot(baseState), $state.snapshot(history), historyItem);
                    }
                })
            });
    }
</script>

<div class="h-full flex-1 flex flex-col">
    <div class="flex flex-row">
        <input type="checkbox" bind:checked={isOnline}>Online
    </div>

    <button onclick={downloadAndMergeHistory}>Download and merge history</button>

    {#each currentPage.blocks as block}
        {#if block.type === "text"}
            <InputField
                    textcontent={block.content}
                    bind:cursor={cursorPosition}
                    onchardeleted={onCharRemoved}
                    oncharinserted={onCharInserted}
            />
        {/if}
    {/each}
</div>