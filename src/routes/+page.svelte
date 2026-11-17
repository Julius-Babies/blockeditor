<script lang="ts">
    import InputField from "#lib/InputField.svelte";
    import {JsonView} from "@zerodevx/svelte-json-view";
    import type {PageState} from "#lib/page.ts";
    import {applyHistoryToPageState, buildPageFromStateAndHistory, type HistoryAction} from "#lib/history.ts";

    const clientId = crypto.randomUUID();

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
        history.push({
            type: "insert",
            payload: char,
            index: position,
            timestamp: Date.now(),
            clientId: clientId,
            previousCommitId: history.length == 0 ? baseState.commit_id : history[history.length - 1].commitId,
            commitId: crypto.randomUUID(),
        })
        cursorPosition += char.length;
    }

    function onCharRemoved(char: string, position: number) {
        history.push({
            type: "delete",
            from: position,
            to: position + char.length,
            timestamp: Date.now(),
            clientId: clientId,
            previousCommitId: history.length == 0 ? baseState.commit_id : history[history.length - 1].commitId,
            commitId: crypto.randomUUID(),
        })
        cursorPosition -= char.length;
    }

    /**
     * Apply current history to baseState.
     */
    function apply() {
        baseState = applyHistoryToPageState($state.snapshot(baseState), history);
        history = [];
    }

    function copyHistory() {
        navigator.clipboard.writeText(JSON.stringify(history));
    }

    let historyTextFieldContent = $state("");

    function mergeHistory() {
        let toMerge: HistoryAction[] = JSON.parse(historyTextFieldContent);
        let merge = [...toMerge, ...history].toSorted((a, b) => a.timestamp - b.timestamp);

        // Merge the two histories. We go through both at the same time and if a client A has changed index-related
        // stuff, all following history entries, that are NOT client a need to change if they are affected. we are
        // excluding client a because itself already applied that.
        merge.forEach((item, index) => {
            const isLast = index === toMerge.length - 1;
            if (isLast) return;
            if (item.type !== "insert" && item.type !== "delete") return;
            let affectedAfterIndex = 0;
            if (item.type === "insert") affectedAfterIndex = item.index;
            if (item.type === "delete") affectedAfterIndex = item.from;
            let delta = 0;
            if (item.type === "insert") delta = item.payload.length;
            if (item.type === "delete") delta = item.to - item.from;
            merge.slice(index + 1, merge.length)
                .filter(probablyAffectedCandidate => probablyAffectedCandidate.clientId != item.clientId)
                .forEach(affectedItem => {
                    if (affectedItem.type === "insert" && affectedItem.index >= affectedAfterIndex) affectedItem.index += delta;
                    if (affectedItem.type === "delete" && affectedItem.from >= affectedAfterIndex) {
                        affectedItem.from -= delta;
                        affectedItem.to -= delta;
                    }
                })
        })

        // 00:44 - brillianter einfall: Wir nutzen den timestamp gar nicht für das mergen, sondern machen so commits,
        // jeder client weiss, von welchem history stand er zuletzt wusste, den andere clients auch hatten und dann kann
        // man einfach wie in der einen BwInf aufgabe diesen "git"graphen auflösen wie so ein rebase, beim "rebase" werden
        // dann eben diese index transformationen angewendet.

        history = [...history, ...toMerge];
        historyTextFieldContent = "";
    }
</script>

<div class="w-full h-full flex flex-row">
    <div class="h-full flex-1 flex flex-col">
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

    <div class="h-full flex-1 flex flex-col">
        <div>
            Cursor Position: {cursorPosition}<br />
            ClientId: {clientId}
        </div>

        <div class="flex flex-col">
            <button onclick={apply} class="border text-start px-2 w-fit">Apply changes</button>
            <button onclick={copyHistory} class="border text-start px-2 w-fit">Copy history</button>
            <textarea bind:value={historyTextFieldContent} class="border" placeholder="History..."></textarea>
            <button onclick={mergeHistory} class="border text-start px-2 w-fit">Merge history</button>
        </div>

        <JsonView json={{baseState: baseState, page: currentPage, history: history.toSorted((a, b) => a.timestamp - b.timestamp)}} />
    </div>
</div>