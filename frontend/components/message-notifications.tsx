"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

type Notifications = { unread_count: number; messages: { id: number; application_id: number; sender_name: string; job_title: string }[] };

export function MessageNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Notifications>({ unread_count: 0, messages: [] });
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const workspace = user?.role === "candidate" ? "candidate" : "recruiter";
  useEffect(() => {
    let active = true, pending = false, latest: number | null = null;
    const alerts = new Set<string | number>();
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await apiFetch<Notifications>("/api/portal/message-notifications");
        if (!active) return;
        const incoming = next.messages.filter(message => latest !== null && message.id > latest);
        if (incoming.length) {
          const message = incoming[0];
          const id = toast.info(incoming.length === 1 ? `New message from ${message.sender_name}` : `${incoming.length} new messages`, {
            description: message.job_title,
            action: { label: "Open chat", onClick: () => router.push(`/${workspace}/messages?application=${message.application_id}`) },
          });
          alerts.add(id);
        }
        latest = Math.max(latest ?? 0, ...next.messages.map(message => message.id));
        setData(next); setError(false);
      } catch { if (active) setError(true); }
      finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("messages-read", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("messages-read", refresh); window.removeEventListener("focus", refresh); alerts.forEach(id => toast.dismiss(id)); };
  }, [user?.id, user?.role, router, workspace]);
  useEffect(() => {
    if (!open) return;
    function close(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return <div className="relative">
    <Button variant="ghost" size="icon" aria-label={`Message notifications, ${data.unread_count} unread`} title="Message notifications" aria-expanded={open} aria-controls="message-notifications" onClick={() => setOpen(value => !value)} className="relative">
      <Bell className="size-4" />{data.unread_count > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-white">{data.unread_count > 99 ? "99+" : data.unread_count}</span>}
    </Button>
    {open && <><button aria-label="Close notifications" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} /><section id="message-notifications" aria-label="Unread messages" className="fixed left-4 right-4 top-20 z-50 max-h-[70vh] overflow-y-auto rounded-md border bg-background p-4 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-80">
      <h2 className="mb-3 text-sm font-semibold">Messages <span className="text-muted-foreground">({data.unread_count} unread)</span></h2>
      {error && <div role="status" className="mb-3 flex items-center justify-between gap-3 text-sm text-destructive">Notifications unavailable<Button size="icon" variant="ghost" aria-label="Retry notifications" onClick={() => window.dispatchEvent(new Event("messages-read"))}><RefreshCw className="size-4" /></Button></div>}
      {!data.messages.length && !error && <p className="py-4 text-sm text-muted-foreground">No unread messages</p>}
      {data.messages.map(message => <Link key={message.id} href={`/${workspace}/messages?application=${message.application_id}`} onClick={() => setOpen(false)} className="block border-t py-3 hover:text-primary"><span className="block break-words text-sm font-medium">{message.sender_name}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{message.job_title}</span></Link>)}
    </section></>}
  </div>;
}
