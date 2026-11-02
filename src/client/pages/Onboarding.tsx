import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { KeyForm } from "../components/KeyForm";
import { UploadDialog } from "../components/UploadDialog";
import { Upload } from "../components/Icons";

function OnbHeader({ step }: { step: string }) {
  return (
    <header className="onb-head">
      <img src="/logo.png" alt="HyperLearn" style={{ height: 24, width: "auto" }} />
      <div className="row" style={{ gap: 16 }}>
        <span className="small muted">{step}</span>
        <UserButton />
      </div>
    </header>
  );
}

export function KeyOnboarding() {
  const { me } = useApp();
  const navigate = useNavigate();
  const openDemo = async () => {
    await api("/api/me/onboarded", { body: {} }).catch(() => {});
    navigate(me?.demo.courseId ? `/courses/${me.demo.courseId}` : "/library");
  };
  return (
    <div>
      <OnbHeader step="Step 1 of 2" />
      <main className="onb-main">
        <section className="onb-card">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" }}>Add your Meta Model API key</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>
              HyperLearn uses your key for every AI request you make. Create one in the{" "}
              <a href="https://dev.meta.ai" target="_blank" rel="noreferrer">Model API dashboard</a> under API keys.
            </p>
          </div>
          <KeyForm />
          <div className="row" style={{ gap: 16 }}>
            <Link to="/onboarding/upload" className="btn btn-primary btn-lg" style={{ minWidth: 140 }}>Continue</Link>
            <button type="button" className="link-btn" onClick={() => void openDemo()}>Use the free demo instead</button>
          </div>
          <p className="hint">Your key is encrypted before it is stored. Remove it anytime in Settings.</p>
        </section>
      </main>
    </div>
  );
}

export function UploadOnboarding() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const pick = (exam: boolean) => {
    const i = document.createElement("input");
    i.type = "file";
    i.multiple = !exam;
    i.accept = exam ? "application/pdf" : "application/pdf,audio/*,.m4a,video/mp4";
    i.onchange = () => {
      const fs = [...(i.files ?? [])];
      // exams are recognised by name; make sure an "Add exam" pick is treated as one
      const named = exam ? fs.map((f) => (/exam|midterm|final|quiz/i.test(f.name) ? f : new File([f], `exam_${f.name}`, { type: f.type }))) : fs;
      setFiles((cur) => [...(cur ?? []), ...named]);
    };
    i.click();
  };
  const finish = async (to: string) => {
    await api("/api/me/onboarded", { body: {} }).catch(() => {});
    navigate(to);
  };
  return (
    <div>
      <OnbHeader step="Step 2 of 2" />
      <main className="onb-main">
        <section className="onb-card">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" }}>Add your first material</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Lecture slides, papers, notes, or a recorded lecture. We build your first course from it.</p>
          </div>
          <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles((cur) => [...(cur ?? []), ...e.dataTransfer.files]); }}>
            <Upload />
            <p style={{ fontWeight: 600 }}>Drop files here</p>
            <button type="button" className="btn" onClick={() => pick(false)}>Browse files</button>
            <p className="hint">PDF or audio. Up to 95 MB each.</p>
          </div>
          <div className="card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Have a past exam?</span>
              <p className="hint">Add it and practice questions will follow its style.</p>
            </div>
            <button type="button" className="btn" onClick={() => pick(true)}>Add exam</button>
          </div>
          <div className="row" style={{ gap: 16 }}>
            <button type="button" className="btn btn-primary btn-lg" disabled={!ids.length} onClick={() => void finish(`/courses/new?sources=${ids.join(",")}`)}>
              Build my course
            </button>
            <button type="button" className="link-btn" onClick={() => void finish("/library")}>Skip for now</button>
          </div>
        </section>
      </main>
      {files && files.length > 0 && <UploadDialog key={files.length} initialFiles={files} onClose={() => setFiles([])} onDone={setIds} />}
    </div>
  );
}
