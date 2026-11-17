import type {PageServerLoad} from './$types';
import {history} from "../state.server.ts";

export const GET: PageServerLoad = async () => {
    return Response.json(history);
};