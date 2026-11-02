import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { randomId } from "../lib/crypto";
import { courseAccess, errorResponse, signFileUrl } from "../lib/http";
import { createRun } from "../lib/runs";
import { getAiCtx } from "../ai/meta";
import { examFor, generateQuestions, gradeAnswer, insertQuestions, pathWithTitles, planTypes, type PracticePlan, type PracticeQuestion } from "../course/practice";
import { adjustMastery } from "../lib/mastery";
import { describeResponse, gradeResponse, MODEL_GRADED, publicSpec, QTYPE_LABEL, QTYPES, type QType, type Spec } from "../../shared/questions";

type SessionRow = { id: string; user_id: string; course_id: string; chapter: string | null; status: string; created_at: number; finished_at: number | null; replan_run_id: string | null; plan: string | null; writing_until: number | null };

async function session(c: { env: AppEnv["Bindings"] }, id: string, userId: string) {
  return c.env.DB.prepare("SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?").bind(id, userId).first<SessionRow>();
}

const asType = (t: string | null): QType => ((QTYPES as readonly string[]).includes(t ?? "") ? (t as QType) : "worked");

/** How much one answer moves mastery: being sure and wrong says the most. */
function masteryDelta(correct: boolean, confidence?: string): number {
  if (correct) return confidence === "guess" ? 0.05 : 0.1;
  return confidence === "sure" ? -0.25 : confidence === "guess" ? -0.1 : -0.15;
}

async function chosenSections(env: AppEnv["Bindings"], courseId: string, userId: string, chapter: string | null) {
  const { sections } = await pathWithTitles(env, courseId, userId);
  return (chapter ? sections.filter((s) => s.chapter === chapter) : sections).slice(0, 8);
}

export const practice = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT p.*, c.title AS course_title,
        (SELECT COUNT(*) FROM practice_questions WHERE session_id = p.id) AS questions,
        (SELECT COUNT(*) FROM attempts WHERE session_id = p.id AND correct = 1) AS correct
       FROM practice_sessions p JOIN courses c ON c.id = p.course_id WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 20`,
    )
      .bind(c.get("userId"))
      .all();
    return c.json({ items: results });
  })
  .post("/", async (c) => {
    // the session opens at once; questions are written one batch at a time by /write
    const userId = c.get("userId");
    const body = z.object({ courseId: z.string(), chapter: z.string().optional(), count: z.number().int().min(2).max(8).default(5) }).parse(await c.req.json());
    const access = await courseAccess(c.env, body.courseId, userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    try {
      await getAiCtx(c.env, userId);
      const chosen = await chosenSections(c.env, body.courseId, userId, body.chapter ?? null);
      if (!chosen.length) return c.json({ error: "No sections to practise" }, 400);
      const { results: recent } = await c.env.DB.prepare("SELECT q.qtype FROM practice_questions q JOIN practice_sessions p ON p.id = q.session_id WHERE p.user_id = ? AND q.qtype IS NOT NULL ORDER BY p.created_at DESC, q.ord DESC LIMIT 40")
        .bind(userId)
        .all<{ qtype: string }>();
      const id = randomId("prac");
      const plan: PracticePlan = { types: planTypes(body.count, recent.map((r) => asType(r.qtype)).reverse(), id), pos: 0, target: body.count };
      await c.env.DB.prepare("INSERT INTO practice_sessions (id, user_id, course_id, chapter, status, created_at, plan) VALUES (?, ?, ?, ?, 'writing', ?, ?)").bind(id, userId, body.courseId, body.chapter ?? null, Date.now(), JSON.stringify(plan)).run();
      return c.json({ id });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/write", async (c) => {
    // writes the next batch: 1 question first (answerable in seconds), then the rest
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const plan = s.plan ? (JSON.parse(s.plan) as PracticePlan) : null;
    if (!plan || plan.pos >= plan.types.length) return c.json({ done: true, added: 0 });
    const now = Date.now();
    const lock = await c.env.DB.prepare("UPDATE practice_sessions SET writing_until = ? WHERE id = ? AND (writing_until IS NULL OR writing_until < ?)").bind(now + 120_000, s.id, now).run();
    if (!lock.meta.changes) return c.json({ busy: true, done: false, added: 0 });
    const batch = plan.types.slice(plan.pos, plan.pos === 0 ? 1 : plan.pos + 4);
    try {
      const ctx = await getAiCtx(c.env, userId);
      const chosen = await chosenSections(c.env, s.course_id, userId, s.chapter);
      const { results: existing } = await c.env.DB.prepare("SELECT prompt FROM practice_questions WHERE session_id = ?").bind(s.id).all<{ prompt: string }>();
      const qs = await generateQuestions(c.env, ctx, { userId, courseId: s.course_id, sectionIds: chosen.map((x) => x.id), types: batch, avoid: existing.map((e) => e.prompt) });
      await insertQuestions(c.env, s.id, qs, existing.length + 1);
      const next: PracticePlan = { ...plan, pos: plan.pos + batch.length };
      const done = next.pos >= next.types.length;
      await c.env.DB.prepare("UPDATE practice_sessions SET plan = ?, writing_until = NULL, status = CASE WHEN status = 'writing' AND ? THEN 'active' ELSE status END WHERE id = ?").bind(JSON.stringify(next), done ? 1 : 0, s.id).run();
      return c.json({ done, added: qs.length });
    } catch (err) {
      await c.env.DB.prepare("UPDATE practice_sessions SET writing_until = NULL WHERE id = ?").bind(s.id).run();
      return errorResponse(c, err);
    }
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { results: questions } = await c.env.DB.prepare("SELECT id, ord, prompt, answer, concept, section_id, style_of, cites, qtype, spec FROM practice_questions WHERE session_id = ? ORDER BY ord").bind(s.id).all<PracticeQuestion>();
    const { results: attempts } = await c.env.DB.prepare("SELECT id, question_id, answer, score, correct, feedback, confidence, response, created_at FROM attempts WHERE session_id = ? ORDER BY created_at").bind(s.id).all<{ question_id: string; correct: number; response: string | null }>();
    const answered = new Set(attempts.map((a) => a.question_id));
    const exam = await examFor(c.env, s.course_id);
    const course = await c.env.DB.prepare("SELECT title FROM courses WHERE id = ?").bind(s.course_id).first<string>("title");
    const plan = s.plan ? (JSON.parse(s.plan) as PracticePlan) : null;
    const pending = plan ? plan.types.slice(plan.pos) : [];
    return c.json({
      session: { id: s.id, course_id: s.course_id, chapter: s.chapter, status: s.status },
      courseTitle: course,
      examName: exam?.filename ?? null,
      // solutions are only sent once the question has been attempted
      questions: await Promise.all(questions.map(async (q) => {
        const type = asType(q.qtype);
        const spec = q.spec ? (JSON.parse(q.spec) as Spec) : {};
        const done = answered.has(q.id);
        const view = publicSpec(type, spec as Spec, q.id);
        if (type === "hotspot" || type === "label") view.pageUrl = await signFileUrl(c.env, `sources/${String(view.sourceId)}/pages/${String(view.page)}.png`);
        return { id: q.id, ord: q.ord, prompt: q.prompt, concept: q.concept, section_id: q.section_id, cites: JSON.parse(q.cites), type, typeLabel: QTYPE_LABEL[type], view, answer: done ? q.answer : null, solution: done ? spec : null };
      })),
      attempts: attempts.map((a) => ({ ...a, response: a.response ? JSON.parse(a.response) : null })),
      pending: pending.map((t) => QTYPE_LABEL[t]),
    });
  })
  .post("/:id/answer", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const body = z
      .object({ questionId: z.string(), answer: z.string().max(5000).optional(), response: z.unknown().optional(), confidence: z.enum(["guess", "unsure", "sure"]).optional() })
      .parse(await c.req.json());
    const q = await c.env.DB.prepare("SELECT * FROM practice_questions WHERE id = ? AND session_id = ?").bind(body.questionId, s.id).first<PracticeQuestion>();
    if (!q) return c.json({ error: "Question not found" }, 404);
    const type = asType(q.qtype);
    const spec = (q.spec ? JSON.parse(q.spec) : {}) as Spec;
    try {
      let grade: { correct: boolean; score: number; feedback: string; mistake: string; errorConcept?: string; reveal?: string; parts?: boolean[] };
      let answerText: string;
      if (MODEL_GRADED.has(type)) {
        answerText = (body.answer ?? "").trim();
        if (!answerText) return c.json({ error: "Write an answer first" }, 400);
        const ctx = await getAiCtx(c.env, userId);
        const exam = await examFor(c.env, s.course_id);
        grade = await gradeAnswer(ctx, q, answerText, exam?.filename);
      } else {
        try {
          grade = gradeResponse(type, spec, body.response, q.id);
        } catch {
          return c.json({ error: "Answer every part first" }, 400);
        }
        answerText = describeResponse(type, spec, body.response);
      }
      const id = randomId("att");
      await c.env.DB.prepare("INSERT INTO attempts (id, session_id, question_id, user_id, answer, score, correct, feedback, concept, created_at, confidence, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, s.id, q.id, userId, answerText || "(no answer)", grade.score, grade.correct ? 1 : 0, grade.feedback, q.concept, Date.now(), body.confidence ?? null, body.response === undefined ? null : JSON.stringify(body.response))
        .run();
      const mastery = await adjustMastery(c.env, userId, s.course_id, q.concept, masteryDelta(grade.correct, body.confidence));
      return c.json({ attemptId: id, ...grade, gradedBy: MODEL_GRADED.has(type) ? "model" : "code", answer: q.answer, solution: spec, mastery, cites: JSON.parse(q.cites) });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/adapt", async (c) => {
    // a wrong answer re-plans the path (streamed; ends with Keep / Undo)
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { attemptId } = z.object({ attemptId: z.string() }).parse(await c.req.json());
    const att = await c.env.DB.prepare(
      "SELECT a.feedback, a.correct, q.prompt, q.concept, q.section_id FROM attempts a JOIN practice_questions q ON q.id = a.question_id WHERE a.id = ? AND a.session_id = ?",
    )
      .bind(attemptId, s.id)
      .first<{ feedback: string; correct: number; prompt: string; concept: string; section_id: string | null }>();
    if (!att) return c.json({ error: "Attempt not found" }, 404);
    if (att.correct) return c.json({ error: "Nothing to adapt for a correct answer" }, 400);
    const access = await courseAccess(c.env, s.course_id, userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    try {
      await getAiCtx(c.env, userId);
      const runId = await createRun(c.env, { userId, courseId: s.course_id, graph: "adapt", input: { attemptId } });
      await c.env.DB.prepare("UPDATE practice_sessions SET replan_run_id = ? WHERE id = ?").bind(runId, s.id).run();
      const stub = c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(s.course_id));
      return await stub.startAdapt({
        runId,
        userId,
        courseId: s.course_id,
        isOwner: access.role === "owner",
        question: { prompt: att.prompt, concept: att.concept, sectionId: att.section_id },
        grade: { feedback: att.feedback, mistake: att.feedback, errorConcept: att.concept },
      });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/similar", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { questionId } = z.object({ questionId: z.string() }).parse(await c.req.json());
    const q = await c.env.DB.prepare("SELECT * FROM practice_questions WHERE id = ? AND session_id = ?").bind(questionId, s.id).first<PracticeQuestion>();
    if (!q) return c.json({ error: "Question not found" }, 404);
    try {
      const ctx = await getAiCtx(c.env, userId);
      const nq = await generateQuestions(c.env, ctx, { userId, courseId: s.course_id, sectionIds: [q.section_id!].filter(Boolean), types: [asType(q.qtype)], focusConcept: q.concept, avoid: [q.prompt] });
      if (!nq.length) return c.json({ error: "Could not write a similar question. Try again." }, 502);
      const maxOrd = (await c.env.DB.prepare("SELECT MAX(ord) AS m FROM practice_questions WHERE session_id = ?").bind(s.id).first<number>("m")) ?? 0;
      await insertQuestions(c.env, s.id, nq, maxOrd + 1);
      return c.json({ id: nq[0].id });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/finish", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    await c.env.DB.prepare("UPDATE practice_sessions SET status = 'finished', finished_at = COALESCE(finished_at, ?) WHERE id = ?").bind(Date.now(), s.id).run();
    return c.json({ ok: true });
  })
  .get("/:id/results", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { results } = await c.env.DB.prepare(
      `SELECT q.id, q.ord, q.prompt, q.concept, a.correct, a.feedback FROM practice_questions q
       LEFT JOIN attempts a ON a.id = (SELECT id FROM attempts WHERE question_id = q.id ORDER BY created_at DESC LIMIT 1)
       WHERE q.session_id = ? ORDER BY q.ord`,
    )
      .bind(s.id)
      .all<{ id: string; ord: number; prompt: string; concept: string; correct: number | null; feedback: string | null }>();
    const run = s.replan_run_id ? await c.env.DB.prepare("SELECT status, trace, result FROM runs WHERE id = ?").bind(s.replan_run_id).first<{ status: string; trace: string }>() : null;
    const exam = await examFor(c.env, s.course_id);
    const course = await c.env.DB.prepare("SELECT title FROM courses WHERE id = ?").bind(s.course_id).first<string>("title");
    const minutes = Math.max(1, Math.round(((s.finished_at ?? Date.now()) - s.created_at) / 60000));
    return c.json({ session: s, courseTitle: course, examName: exam?.filename ?? null, minutes, items: results, replan: run ? { status: run.status, trace: JSON.parse(run.trace) } : null });
  });
