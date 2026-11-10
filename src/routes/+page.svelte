<script lang="ts">
    import InputField from "#lib/InputField.svelte";
    import {JsonView} from "@zerodevx/svelte-json-view";
    import type {PageState} from "#lib/page.ts";
    import {buildPageFromStateAndHistory} from "#lib/history.ts";

    const baseState: PageState = {
        textContent: "Hello World",
        blockMarkers: [
            {
                id: crypto.randomUUID(),
                type: "text",
                startPosition: 0,
            }
        ]
    }

    let history: ({timestamp: number} & ({type: "insert", payload: string, index: number} | {type: "delete", from: number, to: number}))[] = $state([]);

    let currentPage = $derived.by(() => buildPageFromStateAndHistory(baseState, history));

    let cursorPosition = $state(4);

    function onCharInserted(position: number, char: string) {
        history.push({
            type: "insert",
            payload: char,
            index: position,
            timestamp: Date.now(),
        })
        cursorPosition += char.length;
    }

    function onCharRemoved(char: string, position: number) {
        history.push({
            type: "delete",
            from: position,
            to: position + char.length,
            timestamp: Date.now(),
        })
        cursorPosition -= char.length;
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
        {cursorPosition}

        <JsonView json={{page: currentPage, history: history}} />
    </div>
</div>