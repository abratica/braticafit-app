import { vttToText, writeNotes } from "../../supabase/functions/_shared/calls.ts";
const text = vttToText(await Deno.readTextFile("/tmp/call.vtt"));
console.log("TRANSCRIPT:\n" + text);
console.log("NOTES:", JSON.stringify(await writeNotes(text), null, 2));
