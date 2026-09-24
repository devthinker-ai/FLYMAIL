import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./style.css";
import inboxData from "./inbox.json";
import { loadBrain, type Brain } from "./engine/brain";
import { progressText } from "./engine/cache";
import {
  createThinkContext,
  think,
  type BrainReport,
  type ThinkContext,
  type ThinkProgress,
} from "./think";
import { BrainViz } from "./viz";
import { loadReadout, classifyFeatures, type ReadoutModel, type ReadoutResult } from "./readout";
import bundledReadout from "../public/readout.json";
import { renderReply } from "./templates";
import { buildPlan, formatPlanLine, type ReplyPlan } from "./plan";
import { appendSignature, composeReply } from "./llm";
import { OLLAMA_MODEL, OLLAMA_SEED, OLLAMA_TEMPERATURE } from "./config";
import {
  CATEGORIES,
  NUM_EDGES,
  NUM_NEURONS,
  NUM_SYNAPTIC_CONTACTS,
  SUPER_CLASS_TABLE,
  THINK_STEPS,
  type Category,
} from "./constants";
import { buildTrainingCorpus } from "./synthetic";

interface InboxEmail {
  id: string;
  from: string;
  address: string;
  subject: string;
  body: string;
  lang: string;
  category: Category;
  provider?: "gmail" | "ionos" | "demo" | "paste";
}

const INBOX = inboxData as InboxEmail[];
const BUNDLED = bundledReadout as ReadoutModel;

type Phase = "idle" | "running" | "done";
type PenMode = "fly" | "llm";
type SourceMode = "demo" | "live";

interface CachedBrain {
  emailId: string;
  report: BrainReport;
  result: ReadoutResult;
  plan: ReplyPlan;
  templateText: string;
}

interface LiveInboxPayload {
  emails: InboxEmail[];
  errors?: { provider: string; message: string }[];
  accounts?: { gmail?: boolean; ionos?: boolean };
}

const FOOTER_FLY_ONLY = (
  <>
    Wiring is biological: MaleCNS v1.0 complete male Drosophila brain + ventral
    nerve cord (Janelia Research Campus et al., CC-BY 4.0), simulated as leaky
    integrate-and-fire on WebGPU —{" "}
    {NUM_NEURONS.toLocaleString()} neurons, {NUM_EDGES.toLocaleString()}{" "}
    pre→post connections ({NUM_SYNAPTIC_CONTACTS.toLocaleString()} synaptic
    contacts).
    The classification is real but small: a logistic readout trained on
    deterministic email→brain patterns, holdout accuracy{" "}
  </>
);

const FOOTER_LLM = (
  <>
    The fly decides the reply&apos;s character: category, tone, length, and whether
    to ask a question (logistic readout over live WebGPU LIF dynamics,{" "}
  </>
);

declare global {
  interface Window {
    maleflymail?: {
      ready: boolean;
      hasReadout?: boolean;
      penMode?: PenMode;
      setPenMode?: (m: PenMode) => void;
      think: (email: InboxEmail | { id: string; subject: string; body: string; from?: string; category?: string; lang?: string }) => Promise<{
        report: BrainReport;
        readout: ReadoutResult;
        plan: ReplyPlan;
        reply: string;
      }>;
      listCorpus: (n?: number) => InboxEmail[];
      buildCorpus: (n?: number) => InboxEmail[];
      dumpReports: (emails?: InboxEmail[]) => Promise<string>;
      getLast: () => unknown;
    };
  }
}

function WebGPUGate({ children }: { children: preact.ComponentChildren }) {
  if (!("gpu" in navigator)) {
    return (
      <div class="load-screen">
        <div>
          <h1>WebGPU required</h1>
          <p>
            MALEFLYMAIL runs a live MaleCNS LIF simulation in your browser. Open this
            page in Chrome or Edge on a machine with WebGPU (this Mac&apos;s Chrome
            works).
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function App() {
  const [brain, setBrain] = useState<Brain | null>(null);
  const [ctx, setCtx] = useState<ThinkContext | null>(null);
  const [readout, setReadout] = useState<ReadoutModel | null>(
    BUNDLED?.coefficients?.length === 6 ? BUNDLED : null,
  );
  const [loadPct, setLoadPct] = useState(0);
  const [loadLabel, setLoadLabel] = useState("Loading MaleCNS brain…");
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string>(INBOX[0]!.id);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ThinkProgress | null>(null);
  const [report, setReport] = useState<BrainReport | null>(null);
  const [result, setResult] = useState<ReadoutResult | null>(null);
  const [plan, setPlan] = useState<ReplyPlan | null>(null);
  const [replyText, setReplyText] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [customEmail, setCustomEmail] = useState<InboxEmail | null>(null);

  const [penMode, setPenMode] = useState<PenMode>("fly");
  const [penBusy, setPenBusy] = useState(false);
  const [llmMeta, setLlmMeta] = useState<{ model: string; elapsedMs: number } | null>(null);
  const [llmFallback, setLlmFallback] = useState(false);

  const [sourceMode, setSourceMode] = useState<SourceMode>("demo");
  const [liveEmails, setLiveEmails] = useState<InboxEmail[]>([]);
  const [liveStatus, setLiveStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveMeta, setLiveMeta] = useState<string>("");

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const mainViz = useRef<BrainViz | null>(null);
  const miniViz = useRef<BrainViz | null>(null);
  const lastBundle = useRef<unknown>(null);
  const cacheRef = useRef<CachedBrain | null>(null);
  const penModeRef = useRef<PenMode>(penMode);
  penModeRef.current = penMode;

  const baseList =
    sourceMode === "live"
      ? liveEmails
      : customEmail
        ? [customEmail, ...INBOX]
        : INBOX;
  const emails = baseList;
  const selected = emails.find((e) => e.id === selectedId) ?? emails[0];

  const loadLiveInbox = async () => {
    setLiveStatus("loading");
    setLiveError(null);
    try {
      const r = await fetch("/mail/api/inbox");
      if (!r.ok) throw new Error(`mail companion HTTP ${r.status}`);
      const data = (await r.json()) as LiveInboxPayload;
      const list = (data.emails ?? []).map((e) => ({
        ...e,
        category: (e.category as Category) || "personal",
      }));
      setLiveEmails(list);
      const parts: string[] = [];
      if (data.accounts?.gmail) parts.push("gmail");
      if (data.accounts?.ionos) parts.push("ionos");
      const errBits = (data.errors ?? []).map((e) => `${e.provider}: ${e.message}`);
      setLiveMeta(
        parts.length
          ? `${list.length} msgs · ${parts.join("+")}${errBits.length ? ` · warn: ${errBits.join("; ")}` : ""}`
          : errBits.length
            ? errBits.join("; ")
            : "no accounts",
      );
      if (list.length === 0 && errBits.length) {
        setLiveStatus("error");
        setLiveError(errBits.join("; ") || "Empty inbox / companion error");
      } else if (list.length === 0) {
        setLiveStatus("error");
        setLiveError("Live inbox empty — check server/.env and IMAP credentials.");
      } else {
        setLiveStatus("ok");
        setSelectedId(list[0]!.id);
        setPhase("idle");
        setReport(null);
        setResult(null);
        setPlan(null);
      }
    } catch (e) {
      setLiveStatus("error");
      setLiveEmails([]);
      setLiveError(
        e instanceof Error
          ? `${e.message} — start the companion: npm run mail`
          : String(e),
      );
      setLiveMeta("");
    }
  };

  useEffect(() => {
    if (sourceMode !== "live") return;
    void loadLiveInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadLabel("Fetching brain.bin (MaleCNS v1.0)…");
        const b = await loadBrain("/brain.bin", (got, total) => {
          if (cancelled) return;
          setLoadPct(total > 0 ? (100 * got) / total : 0);
          setLoadLabel(`Loading brain — ${progressText(got, total)}`);
        });
        if (cancelled) return;
        setBrain(b);
        setLoadLabel("Creating WebGPU LIF sim…");
        setLoadPct(100);
        const tctx = await createThinkContext(b);
        if (cancelled) return;
        setCtx(tctx);
        const model = await loadReadout("/readout.json");
        if (cancelled) return;
        setReadout(model);
        setLoadLabel("Ready");
        setLoadPct(100);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!brain || !ctx || !mainCanvasRef.current || !miniCanvasRef.current) return;
    mainViz.current?.destroy();
    miniViz.current?.destroy();
    const mv = new BrainViz(mainCanvasRef.current);
    const nv = new BrainViz(miniCanvasRef.current);
    mv.setBrain(brain);
    nv.setBrain(brain);
    mv.setDrivers(ctx.driver.indices);
    nv.setDrivers(ctx.driver.indices);
    mainViz.current = mv;
    miniViz.current = nv;
    mv.draw();
    nv.draw();
    return () => {
      mv.destroy();
      nv.destroy();
    };
  }, [brain, ctx]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      mainViz.current?.draw();
      miniViz.current?.draw();
    }, 240);
    return () => window.clearTimeout(t);
  }, [rightOpen]);

  const applyPen = async (
    mode: PenMode,
    email: InboxEmail,
    nextPlan: ReplyPlan,
    templateText: string,
  ) => {
    if (mode === "fly") {
      setReplyText(templateText);
      setLlmMeta(null);
      setLlmFallback(false);
      setPenBusy(false);
      return { text: templateText, llm: null as null | { model: string; elapsedMs: number }, fallback: false };
    }

    setPenBusy(true);
    setLlmFallback(false);
    const outcome = await composeReply(email, nextPlan);
    setPenBusy(false);

    if (outcome.ok) {
      const text = appendSignature(outcome.text, nextPlan.language);
      const llm = { model: outcome.model, elapsedMs: outcome.elapsedMs };
      setReplyText(text);
      setLlmMeta(llm);
      setLlmFallback(false);
      return { text, llm, fallback: false };
    }

    setReplyText(templateText);
    setLlmMeta(null);
    setLlmFallback(true);
    return { text: templateText, llm: null, fallback: true };
  };

  useEffect(() => {
    if (!ctx || !brain) return;

    const runThink = async (email: {
      id: string;
      subject: string;
      body: string;
      from?: string;
      lang?: string;
      category?: string;
      address?: string;
    }) => {
      const report = await think(ctx, email);
      const readoutResult = classifyFeatures(report.features, readout);
      const nextPlan = buildPlan(email, readoutResult, report);
      const reply = renderReply(
        {
          id: email.id,
          from: email.from ?? "there",
          subject: email.subject,
          lang: (email as InboxEmail).lang,
        },
        readoutResult.category,
      );
      return { report, readout: readoutResult, plan: nextPlan, reply: reply.text };
    };

    window.maleflymail = {
      ready: true,
      hasReadout: !!(readout && readout.coefficients?.length === 6),
      penMode: penModeRef.current,
      setPenMode: (m) => setPenMode(m),
      think: runThink,
      listCorpus: (n = 96) => buildTrainingCorpus(n) as InboxEmail[],
      buildCorpus: (n = 96) => buildTrainingCorpus(n) as InboxEmail[],
      dumpReports: async (list) => {
        const corpus = list ?? (buildTrainingCorpus(96) as InboxEmail[]);
        const rows: string[] = [
          ["id", "category", ...Array.from({ length: 16 }, (_, i) => `f${i}`)].join(","),
        ];
        for (const email of corpus) {
          const { report } = await runThink(email);
          rows.push(
            [
              JSON.stringify(email.id),
              email.category,
              ...report.features.map((f) => f.toFixed(8)),
            ].join(","),
          );
        }
        return rows.join("\n");
      },
      getLast: () => lastBundle.current,
    };
    return () => {
      delete window.maleflymail;
    };
  }, [ctx, brain, readout]);

  useEffect(() => {
    if (window.maleflymail) window.maleflymail.penMode = penMode;
  }, [penMode]);

  // Toggle pen without re-running the brain when features are cached.
  useEffect(() => {
    const cached = cacheRef.current;
    if (!cached || phase !== "done" || !selected) return;
    if (cached.emailId !== selected.id) return;
    let cancelled = false;
    (async () => {
      const pen = await applyPen(penMode, selected, cached.plan, cached.templateText);
      if (cancelled) return;
      lastBundle.current = {
        emailId: selected.id,
        category: cached.result.category,
        scores: cached.result.scores,
        plan: cached.plan,
        planLine: formatPlanLine(cached.plan),
        reply: pen.text,
        templateReply: cached.templateText,
        features: cached.report.features,
        elapsedMs: cached.report.elapsedMs,
        penMode,
        llm: pen.llm,
        llmFallback: pen.fallback,
      };
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-pen on mode change
  }, [penMode]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const runSelected = async () => {
    if (!ctx || !selected || phase === "running") return;
    setPhase("running");
    setReport(null);
    setResult(null);
    setPlan(null);
    setLlmMeta(null);
    setLlmFallback(false);
    setReplyText(
      "••••••••••••••••••••••••\n••••••••••••••••\n••••••••••••••••••••\n••••••••",
    );
    setReadIds((prev) => new Set(prev).add(selected.id));
    mainViz.current?.startPulse();
    miniViz.current?.startPulse();

    try {
      const rep = await think(ctx, selected, (p) => {
        setProgress(p);
        mainViz.current?.setHeat(p.heat);
        miniViz.current?.setHeat(p.heat);
        mainViz.current?.draw();
        miniViz.current?.draw();
      });
      const rd = classifyFeatures(rep.features, readout);
      const nextPlan = buildPlan(selected, rd, rep);
      const { text: templateText } = renderReply(selected, rd.category);

      cacheRef.current = {
        emailId: selected.id,
        report: rep,
        result: rd,
        plan: nextPlan,
        templateText,
      };

      setReport(rep);
      setResult(rd);
      setPlan(nextPlan);
      // Keep card locked until the pen (template or LLM) finishes.
      const pen = await applyPen(penMode, selected, nextPlan, templateText);
      setPhase("done");
      lastBundle.current = {
        emailId: selected.id,
        category: rd.category,
        scores: rd.scores,
        plan: nextPlan,
        planLine: formatPlanLine(nextPlan),
        reply: pen.text,
        templateReply: templateText,
        features: rep.features,
        elapsedMs: rep.elapsedMs,
        penMode,
        llm: pen.llm,
        llmFallback: pen.fallback,
      };
      mainViz.current?.setHeat(rep.heat);
      miniViz.current?.setHeat(rep.heat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      mainViz.current?.stopPulse();
      miniViz.current?.stopPulse();
    }
  };

  const applyPaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    const lines = text.split(/\n/);
    const subject = lines[0]!.slice(0, 120) || "Pasted email";
    const body = lines.slice(1).join("\n") || text;
    const custom: InboxEmail = {
      id: `paste-${fnvShort(text)}`,
      from: "Pasted sender",
      address: "paste@local",
      subject,
      body,
      lang: /[äöüß]/i.test(text) ? "de" : "en",
      category: "personal",
      provider: "paste",
    };
    setSourceMode("demo");
    setCustomEmail(custom);
    setSelectedId(custom.id);
    setPasteOpen(false);
    setPhase("idle");
    setReport(null);
    setResult(null);
    setPlan(null);
    cacheRef.current = null;
  };

  const switchSource = (mode: SourceMode) => {
    setSourceMode(mode);
    setPhase("idle");
    setProgress(null);
    setReport(null);
    setResult(null);
    setPlan(null);
    setLlmMeta(null);
    setLlmFallback(false);
    setReplyText("");
    cacheRef.current = null;
    mainViz.current?.stopPulse();
    mainViz.current?.setHeat(null);
    miniViz.current?.stopPulse();
    miniViz.current?.setHeat(null);
    mainViz.current?.draw();
    miniViz.current?.draw();
    if (mode === "demo") {
      setSelectedId(customEmail?.id ?? INBOX[0]!.id);
    }
  };

  if (error && !brain) {
    return (
      <div class="load-screen">
        <div>
          <h1>Could not start</h1>
          <p class="err">{error}</p>
        </div>
      </div>
    );
  }

  if (!brain || !ctx) {
    return (
      <div class="load-screen">
        <div>
          <h1>
            MALEFLYMAIL <span style={{ color: "var(--accent)" }}>/ brain</span>
          </h1>
          <p>{loadLabel}</p>
          <div class="progress">
            <div style={{ width: `${Math.min(100, loadPct)}%` }} />
          </div>
          <p style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
            166,700 neurons · MaleCNS · first load caches in IndexedDB
          </p>
        </div>
      </div>
    );
  }

  const acc =
    readout && typeof readout.accuracy === "number"
      ? `${(readout.accuracy * 100).toFixed(1)}%`
      : "fallback (no readout.json)";

  const maxClass = report
    ? Math.max(...report.perClass, 1)
    : progress
      ? Math.max(...progress.perClass, 1)
      : 1;
  const perClass = report?.perClass ?? progress?.perClass ?? Array(12).fill(0);
  const motorL = report?.motorLHz ?? progress?.motorLHz ?? 0;
  const motorR = report?.motorRHz ?? progress?.motorRHz ?? 0;

  const chipText =
    (sourceMode === "live" ? "Live IMAP · " : "") +
    (penMode === "fly"
      ? `${NUM_NEURONS.toLocaleString()} neurons · ${NUM_EDGES.toLocaleString()} connections · MaleCNS · LIF on WebGPU · 0 APIs`
      : `${NUM_NEURONS.toLocaleString()} neurons · MaleCNS · LIF on WebGPU · brain: 0 APIs · pen: 1 (local Ollama)`);

  return (
    <div class="app">
      <header class="header">
        <div class="brand">
          <h1>
            MALEFLYMAIL — replies from a <span>real fruit fly brain</span>
          </h1>
          <div class="chip" data-testid="stats-chip">
            {chipText}
          </div>
        </div>
        <div class="header-links">
          <div class="pen-toggle" role="group" aria-label="Inbox source" data-testid="source-toggle">
            <button
              type="button"
              class={sourceMode === "demo" ? "active" : ""}
              aria-pressed={sourceMode === "demo"}
              data-testid="source-demo"
              onClick={() => switchSource("demo")}
            >
              Demo
            </button>
            <button
              type="button"
              class={sourceMode === "live" ? "active" : ""}
              aria-pressed={sourceMode === "live"}
              data-testid="source-live"
              onClick={() => switchSource("live")}
            >
              Live
            </button>
          </div>
          <div class="pen-toggle" role="group" aria-label="Reply pen" data-testid="pen-toggle">
            <button
              type="button"
              class={penMode === "fly" ? "active" : ""}
              aria-pressed={penMode === "fly"}
              data-testid="pen-fly"
              onClick={() => setPenMode("fly")}
            >
              Fly only
            </button>
            <button
              type="button"
              class={penMode === "llm" ? "active" : ""}
              aria-pressed={penMode === "llm"}
              data-testid="pen-llm"
              onClick={() => setPenMode("llm")}
            >
              Fly + LLM pen
            </button>
          </div>
          <a href="results.md" target="_blank" rel="noreferrer">
            Show research
          </a>
          <a href="NOTICE.md" target="_blank" rel="noreferrer">
            Credits
          </a>
        </div>
      </header>

      <div class={`main ${rightOpen ? "" : "right-collapsed"}`}>
        {/* LEFT */}
        <aside class="panel">
          <div class="panel-hd">
            <div class="eyebrow">One email at a time</div>
            <h2>Email reply</h2>
            <p class="note">
              {sourceMode === "demo"
                ? "Recording view – only fictional demo emails"
                : liveStatus === "loading"
                  ? "Fetching Gmail + IONOS via local companion…"
                  : liveStatus === "error"
                    ? liveError
                    : `Live inbox — ${liveMeta || "local IMAP"}. Replies are not sent.`}
            </p>
          </div>
          <div class="toolbar">
            {sourceMode === "demo" ? (
              <button class="ghost" type="button" onClick={() => setPasteOpen((v) => !v)}>
                Try an example
              </button>
            ) : (
              <button
                class="ghost"
                type="button"
                disabled={liveStatus === "loading"}
                onClick={() => void loadLiveInbox()}
              >
                {liveStatus === "loading" ? "Refreshing…" : "Refresh inbox"}
              </button>
            )}
          </div>
          <div class={`paste-box ${pasteOpen && sourceMode === "demo" ? "open" : ""}`}>
            <textarea
              value={pasteText}
              onInput={(e) => setPasteText((e.target as HTMLTextAreaElement).value)}
              placeholder="Paste any email (subject on first line). Still offline."
            />
            <button class="primary" type="button" style={{ marginTop: "0.4rem" }} onClick={applyPaste}>
              Encode &amp; queue
            </button>
          </div>
          <div class="inbox-list">
            {sourceMode === "live" && liveStatus === "loading" && (
              <div class="inbox-empty">Loading live mail…</div>
            )}
            {sourceMode === "live" && liveStatus === "error" && (
              <div class="inbox-empty err">{liveError}</div>
            )}
            {emails.map((e) => (
              <button
                key={e.id}
                type="button"
                class={`email-row ${selected && e.id === selected.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(e.id);
                  setPhase("idle");
                  setReport(null);
                  setResult(null);
                  setPlan(null);
                  setLlmMeta(null);
                  setLlmFallback(false);
                  setCollapsed(false);
                }}
              >
                <div class="avatar">🪰</div>
                <div class="email-meta">
                  <div class="from">
                    {e.provider && e.provider !== "demo" && e.provider !== "paste" ? (
                      <span class="provider-tag">{e.provider}</span>
                    ) : null}
                    {e.from}
                  </div>
                  <div class="subj">{e.subject}</div>
                </div>
                <div class={`unread ${readIds.has(e.id) ? "read" : ""}`} />
              </button>
            ))}
          </div>
          <div class="inbox-foot">
            {sourceMode === "live"
              ? "Send reply is local-only — nothing is mailed."
              : "Nothing sends until you click Send reply."}
          </div>
        </aside>

        {/* CENTER — keep brain canvas mounted across Demo/Live so BrainViz
            is not left pointing at a detached <canvas> when selection clears. */}
        <section class="center">
          {!selected ? (
            <div class="email-card">
              <h3>No email selected</h3>
              <p class="note" style={{ marginTop: "0.5rem" }}>
                {sourceMode === "live"
                  ? "Start npm run mail, configure server/.env, then Refresh inbox."
                  : "Pick a demo email from the list."}
              </p>
            </div>
          ) : (
            <div class={`email-card ${collapsed ? "collapsed" : ""}`}>
              <div class="top">
                <div>
                  <h3>{selected.subject}</h3>
                  <div class="addr">
                    {selected.from} &lt;{selected.address}&gt;
                    {selected.provider && selected.provider !== "demo" ? (
                      <> · {selected.provider}</>
                    ) : null}
                  </div>
                </div>
                <button class="ghost" type="button" onClick={() => setCollapsed((c) => !c)}>
                  {collapsed ? "Expand" : "Collapse"}
                </button>
              </div>
              <div class="body">{selected.body}</div>
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  class="primary"
                  type="button"
                  disabled={phase === "running" || penBusy}
                  onClick={runSelected}
                  data-testid="run-brain"
                >
                  {phase === "running"
                    ? "Signal in the brain…"
                    : penBusy
                      ? "LLM pen writing…"
                      : "Send through the brain"}
                </button>
              </div>
            </div>
          )}

          <div class="brain-stage">
            <canvas ref={mainCanvasRef} />
            <div class="brain-hud">
              {phase === "running" && progress
                ? `t=${progress.step}/${progress.totalSteps} · spikes=${Math.round(progress.totalSpikes).toLocaleString()}`
                : phase === "done" && report
                  ? `done · ${report.elapsedMs.toFixed(0)} ms · ${Math.round(report.totalSpikes).toLocaleString()} spikes · T=${report.steps}`
                  : `ready · T=${THINK_STEPS} LIF steps`}
            </div>
          </div>

          <div
            class={`reply-card ${phase === "done" ? "unlocked" : "locked"} ${phase === "idle" ? "idle" : ""}`}
            data-testid="reply-card"
            data-phase={phase}
            data-pen={penMode}
            data-fallback={llmFallback ? "1" : "0"}
          >
            <div class="reply-hd">
              <h3>Reply</h3>
              {phase === "done" && penMode === "llm" && llmMeta && !llmFallback && (
                <div class="llm-badge" data-testid="llm-badge">
                  composed by {llmMeta.model} · temp {OLLAMA_TEMPERATURE} · seed {OLLAMA_SEED} ·{" "}
                  {Math.round(llmMeta.elapsedMs)} ms
                </div>
              )}
            </div>
            {phase === "idle" ? (
              <div class="reply-idle" data-testid="reply-text">
                Waiting for a signal.
              </div>
            ) : (
              <div
                class="reply-body"
                data-testid="reply-text"
                style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.45 }}
              >
                {replyText}
              </div>
            )}
            {phase === "done" && llmFallback && (
              <p class="llm-fallback" data-testid="llm-fallback">
                LLM pen unavailable — showing the deterministic template.
              </p>
            )}
            {phase === "running" && (
              <div class="lock-banner">
                Signal in transit — {THINK_STEPS} LIF steps.
              </div>
            )}
            {phase === "done" && (
              <>
                <p class="reply-caption">
                  Hidden until the signal passed through the brain.
                </p>
                <div class="reply-actions">
                  <button
                    class="primary"
                    type="button"
                    onClick={() =>
                      showToast(
                        sourceMode === "live"
                          ? "Not sent — Live mode is inbox-only (local toast)"
                          : "Reply would go out — demo",
                      )
                    }
                  >
                    Send reply
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* RIGHT — collapsible live panel */}
        <aside class={`right ${rightOpen ? "open" : "closed"}`} aria-hidden={!rightOpen}>
          <button
            type="button"
            class="right-toggle"
            aria-expanded={rightOpen}
            aria-label={rightOpen ? "Collapse brain panel" : "Expand brain panel"}
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? "Collapse" : "Inside its brain"}
          >
            {rightOpen ? "›" : "‹"}
          </button>
          <div class="right-inner">
            <div class="live-hd">
              <h2>Inside its brain</h2>
              <div class="live-pill">
                <span class="dot" /> LIVE
              </div>
            </div>
            <div class="mini-viz">
              <canvas ref={miniCanvasRef} />
            </div>
            <div class="gauges">
              <div class="gauge">
                <div class="label">MOTOR L</div>
                <div class="val">{motorL.toFixed(1)} Hz</div>
              </div>
              <div class="gauge">
                <div class="label">MOTOR R</div>
                <div class="val">{motorR.toFixed(1)} Hz</div>
              </div>
            </div>
            <div>
              <div class="eyebrow" style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--faint)", letterSpacing: "0.1em" }}>
                PER SUPER-CLASS
              </div>
              <div class="class-bars" style={{ marginTop: "0.4rem" }}>
                {SUPER_CLASS_TABLE.map((name, i) => (
                  <div class="class-row" key={name}>
                    <span>{name}</span>
                    <div class="bar-track">
                      <div
                        class="bar-fill"
                        style={{ width: `${(100 * (perClass[i] ?? 0)) / maxClass}%` }}
                      />
                    </div>
                    <span>{Math.round(perClass[i] ?? 0)}</span>
                  </div>
                ))}
              </div>
              <p class="note" style={{ marginTop: "0.5rem" }}>
                Dominant: {report?.dominantClass ?? "—"} ·{" "}
                {NUM_NEURONS.toLocaleString()} cells · brightness follows spikes
              </p>
            </div>

            <div class="classify-box" data-testid="classify-box">
              <h3>Readout</h3>
              {result ? (
                <>
                  <div>
                    The fly classified this as:{" "}
                    <span class="cat" data-testid="category">
                      {result.category}
                    </span>{" "}
                    (score {Math.max(...result.scores).toFixed(2)})
                    {result.usedFallback ? " · hash fallback" : ""}
                  </div>
                  <div class="scores" data-testid="scores">
                    {CATEGORIES.map((c, i) => (
                      <div key={c}>
                        {c.padEnd(10, " ")} {result.scores[i]!.toFixed(3)}
                      </div>
                    ))}
                  </div>
                  {plan && (
                    <div class="plan-line" data-testid="plan-line">
                      {formatPlanLine(plan)}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                  No classification yet.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer class="footer" data-testid="honesty-footer" data-mode={penMode} data-source={sourceMode}>
        {penMode === "fly" ? (
          <>
            {FOOTER_FLY_ONLY}
            {acc}. Replies are prewritten templates chosen by that classification. No LLM
            generates text at runtime. This build runs the MaleCNS v1.0 (male) brain — the
            complete male Drosophila brain + ventral nerve cord.
            {sourceMode === "live" ? (
              <> Inbox fetched from local IMAP companion; replies are not sent.</>
            ) : null}{" "}
            <a href="results.md" target="_blank" rel="noreferrer">
              Show research
            </a>
          </>
        ) : (
          <>
            {FOOTER_LLM}
            {acc}
            ). An LLM ({OLLAMA_MODEL}, local Ollama, temperature {OLLAMA_TEMPERATURE}, fixed
            seed) turns that decision into words. Facts come only from the email.
            Deterministic within the same model version; not bit-identical across tabs or
            model updates. This build runs the MaleCNS v1.0 (male) brain — the complete
            male Drosophila brain + ventral nerve cord.
            {sourceMode === "live" ? (
              <> Inbox fetched from local IMAP companion; replies are not sent.</>
            ) : null}{" "}
            <a href="results.md" target="_blank" rel="noreferrer">
              Show research
            </a>
          </>
        )}
      </footer>

      <div class={`toast ${toast ? "show" : ""}`} role="status">
        {toast}
      </div>
    </div>
  );
}

function fnvShort(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const root = document.getElementById("app");
if (root) {
  render(
    <WebGPUGate>
      <App />
    </WebGPUGate>,
    root,
  );
}
