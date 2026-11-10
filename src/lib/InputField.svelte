<!--
  PlainEditable.svelte — vollständig kontrolliertes contenteditable für reinen Text (Svelte 5).

  Die Komponente übernimmt Eingaben NICHT selbst. Jede Eingabe wird abgefangen
  und nur über Callbacks gemeldet. Text und Cursor ändern sich erst, wenn du
  `textcontent` bzw. `cursor` neu setzt.

  Props:
    textcontent       string – der angezeigte Text (Single Source of Truth).
    cursor            number | null (bindable) – Cursorposition (UTF-16-Index).
                      null = kein Cursor. Klicks und Pfeiltasten melden die neue
                      Position über bind:cursor zurück. Eingaben bewegen den
                      Cursor nicht, das machst du selbst.
    oncharinserted    (pos: number, char: string) => void
    onchardeleted     (char: string, pos: number) => void

  Mehrere Zeichen auf einmal lösen einen Callback pro Zeichen aus: erst alle
  Löschungen (jeweils an derselben pos), dann die Einfügungen mit aufsteigender pos.
-->
<script lang="ts">
    import type { HTMLAttributes } from 'svelte/elements';

    interface Props extends HTMLAttributes<HTMLDivElement> {
        textcontent?: string;
        cursor?: number | null;
        oncharinserted?: (pos: number, char: string) => void;
        onchardeleted?: (char: string, pos: number) => void;
    }

    let {
        textcontent = '',
        cursor = $bindable(null),
        oncharinserted,
        onchardeleted,
        ...rest
    }: Props = $props();

    let el: HTMLDivElement;
    let composing = false;

    // ---- Offsets <-> DOM ---------------------------------------------------

    function offsetOf(node: Node, offset: number): number {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.setEnd(node, offset);
        return r.toString().length;
    }

    function readSelection(): { start: number; end: number; focus: number } | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !el.contains(sel.focusNode)) return null;
        const a = offsetOf(sel.anchorNode!, sel.anchorOffset);
        const f = offsetOf(sel.focusNode!, sel.focusOffset);
        return { start: Math.min(a, f), end: Math.max(a, f), focus: f };
    }

    function writeCaret(offset: number) {
        const sel = window.getSelection();
        if (!sel) return;
        if (document.activeElement !== el) el.focus({ preventScroll: true });
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        let remaining = offset;
        while ((node = walker.nextNode())) {
            const len = node.textContent!.length;
            if (remaining <= len) {
                sel.collapse(node, remaining);
                return;
            }
            remaining -= len;
        }
        sel.collapse(el, el.childNodes.length);
    }

    function clearCaret() {
        const sel = window.getSelection();
        if (sel && el.contains(sel.anchorNode)) sel.removeAllRanges();
        if (document.activeElement === el) el.blur();
    }

    // ---- Callbacks ausgeben ------------------------------------------------

    function emit(start: number, end: number, insert: string) {
        const deleted = textcontent.slice(start, end);
        for (const ch of deleted) onchardeleted?.(ch, start);
        let pos = start;
        for (const ch of insert) {
            oncharinserted?.(pos, ch);
            pos += ch.length;
        }
    }

    // Ein Zeichen (Codepoint) vor/nach pos – damit Emoji nicht zerrissen werden
    function prevCharLen(pos: number) {
        const c = textcontent.charCodeAt(pos - 1);
        return pos >= 2 && c >= 0xdc00 && c <= 0xdfff ? 2 : 1;
    }
    function nextCharLen(pos: number) {
        const c = textcontent.charCodeAt(pos);
        return c >= 0xd800 && c <= 0xdbff ? 2 : 1;
    }

    // ---- Eingaben abfangen -------------------------------------------------

    function handleBeforeInput(e: InputEvent) {
        // IME-Komposition lässt sich in Browsern nicht verhindern → siehe reconcile()
        if (composing || e.inputType === 'insertCompositionText') return;

        e.preventDefault();

        const sel = readSelection();
        const target = e.getTargetRanges?.()[0];
        let start: number, end: number;
        if (target) {
            start = offsetOf(target.startContainer, target.startOffset);
            end = offsetOf(target.endContainer, target.endOffset);
        } else if (sel) {
            ({ start, end } = sel);
        } else return;

        const t = e.inputType;

        if (t.startsWith('insert')) {
            let data: string | null = null;
            if (t === 'insertParagraph' || t === 'insertLineBreak') data = '\n';
            else data = e.data ?? e.dataTransfer?.getData('text/plain') ?? null;
            if (data == null) return;
            data = data.replace(/\r\n?/g, '\n');
            emit(start, end, data);
            return;
        }

        if (t.startsWith('delete')) {
            // Kein Target-Range und leere Selektion → ein Zeichen als Fallback
            if (start === end) {
                if (t.endsWith('Backward')) start = Math.max(0, start - prevCharLen(start));
                else end = Math.min(textcontent.length, end + nextCharLen(end));
            }
            if (start !== end) emit(start, end, '');
            return;
        }

        // historyUndo/Redo, Formatierung usw.: ignorieren (Undo ist Sache des Models)
    }

    /**
     * Fallback für Änderungen, die sich nicht verhindern ließen (IME, Exoten):
     * DOM gegen textcontent diffen, Änderung melden und DOM zurücksetzen.
     */
    function reconcile() {
        const domText = el.textContent ?? '';
        const model = textcontent;
        if (domText === model) return;

        const caret = readSelection()?.focus ?? null;
        const oldLen = model.length;
        const newLen = domText.length;

        const maxSuffix = Math.min(oldLen, caret !== null ? newLen - caret : newLen);
        let suffix = 0;
        while (suffix < maxSuffix && model[oldLen - 1 - suffix] === domText[newLen - 1 - suffix]) suffix++;
        const maxPrefix = Math.min(oldLen, newLen) - suffix;
        let prefix = 0;
        while (prefix < maxPrefix && model[prefix] === domText[prefix]) prefix++;

        // DOM zurück auf den kontrollierten Zustand
        el.textContent = model;
        if (cursor !== null) writeCaret(Math.min(cursor, model.length));

        emit(prefix, oldLen - suffix, domText.slice(prefix, newLen - suffix));
    }

    function handleInput(e: Event) {
        if (composing || (e as InputEvent).isComposing) return;
        reconcile();
    }

    function handleCompositionEnd() {
        composing = false;
        reconcile();
    }

    // ---- Cursorbewegungen durch Nutzer melden -------------------------------

    $effect(() => {
        const onSelectionChange = () => {
            if (composing) return;
            const s = readSelection();
            if (s) cursor = s.focus;
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    });

    // ---- Props → DOM ---------------------------------------------------------

    $effect(() => {
        const t = textcontent;
        const c = cursor;
        if (!el || composing) return;

        if (t !== el.textContent) el.textContent = t;

        if (c === null) {
            clearCaret();
        } else {
            const clamped = Math.max(0, Math.min(c, t.length));
            // Nur setzen, wenn abweichend – sonst würde eine Nutzer-Selektion kollabieren
            if (readSelection()?.focus !== clamped) writeCaret(clamped);
        }
    });
</script>

<div
        bind:this={el}
        contenteditable="plaintext-only"
        role="textbox"
        aria-multiline="true"
        tabindex="0"
        spellcheck="false"
        {...rest}
        onbeforeinput={handleBeforeInput}
        oninput={handleInput}
        onblur={() => (cursor = null)}
        oncompositionstart={() => (composing = true)}
        oncompositionend={handleCompositionEnd}
></div>

<style>
    div {
        white-space: pre-wrap;
        word-break: break-word;
        outline: none;
        min-height: 1.5em;
    }
</style>