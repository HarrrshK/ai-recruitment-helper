"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import type { ConversationMessage } from "@/lib/portal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/states";
import { LoadingPortal } from "@/components/portal-shared";

export function ApplicationConversation({ applicationId }: { applicationId: number }) {
  const path = `/api/portal/applications/${applicationId}/messages`;
  const { state, reload, update } = useFetch<ConversationMessage[]>(path);
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [syncError, setSyncError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const data = await apiFetch<ConversationMessage[]>(path); if (active) { update(() => data); setSyncError(""); } }
      catch { if (active) setSyncError("Could not refresh messages. Your draft is saved here; try refreshing."); }
    };
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [path, update]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!body.trim()) return; setSending(true);
    try { await postJson(path, { body }); setBody(""); reload(); }
    catch (error) { toast.error((error as Error).message); } finally { setSending(false); }
  }
  return <section className="min-w-0"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{user?.role === "candidate" ? "Conversation with HR" : "Conversation with candidate"}</h2><Button variant="ghost" size="icon" title="Refresh messages" aria-label="Refresh messages" onClick={reload}><RefreshCw className="size-4" /></Button></div>
    {syncError && <p role="status" className="mb-3 text-sm text-destructive">{syncError}</p>}
    <div aria-live="polite" className="max-h-[420px] min-h-40 space-y-4 overflow-y-auto border-y py-5">
      {state.status === "loading" ? <LoadingPortal /> : state.status === "error" ? <ErrorState message={state.message} onRetry={reload} /> : !state.data.length ? <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p> : state.data.map(message => <article key={message.id} className={`max-w-[90%] rounded-md px-4 py-3 ${message.sender_role === user?.role ? "ml-auto bg-primary/10" : "bg-muted"}`}><div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span className="font-semibold">{message.sender_name} {message.sender_role === "recruiter" ? "(HR)" : ""}</span><time className="text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p></article>)}
    </div>
    <form onSubmit={send} className="mt-4 space-y-3"><label htmlFor={`message-${applicationId}`} className="text-sm font-medium">Message</label><Textarea id={`message-${applicationId}`} rows={3} maxLength={4000} required value={body} onChange={e => setBody(e.target.value)} placeholder={user?.role === "candidate" ? "Write to the hiring team..." : "Reply to the candidate..."} /><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{body.length}/4000</span><Button type="submit" disabled={sending || !body.trim()}><Send className="size-4" />{sending ? "Sending..." : "Send message"}</Button></div></form>
  </section>;
}
