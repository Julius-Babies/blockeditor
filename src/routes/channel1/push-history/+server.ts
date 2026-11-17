import type {PageServerLoad} from './$types';
import {type HistoryAction, mergeHistory} from "#lib/history.ts";
import {baseState, history, setHistory} from "../state.server.ts";

export const POST: PageServerLoad = async ({request}) => {
    const body : HistoryAction[] = await request.json();
    body.forEach((item) => {
        setHistory(mergeHistory(baseState, history, item));
    })

    console.log(history)

    return Response.json(history);
};
