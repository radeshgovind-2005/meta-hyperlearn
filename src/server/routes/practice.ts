import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { randomId } from "../lib/crypto";
import { courseAccess, errorResponse } from "../lib/http";
import { createRun } from "../lib/runs";
import { getAiCtx } from "../ai/meta";
import { examFor, generateQuestions, gradeAnswer, insertQuestions, pathWithTitles, type PracticeQuestion } from "../course/practice";
import { adjustMastery } from "../lib/mastery";

async function session(c: { env: AppEnv["Bindings"] }, id: string, userId: string) {
  return c.env.DB.prepare("SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: string; course_id: string; chapter: string | null; status: string; created_at: number; finished_at: number | null; replan_run_id: string | null }>();
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
    const userId = c.get("userId");
    const body = z.object({ courseId: z.string(), chapter: z.string().optional(), count: z.number().int().min(2).max(8).default(5) }).parse(await c.req.json());
    const access = await courseAccess(c.env, body.courseId, userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    try {
      const ctx = await getAiCtx(c.env, userId);
      const { sections } = await pathWithTitles(c.env, body.courseId, userId);
      const chosen = (body.chapter ? sections.filter((s) => s.chapter === body.chapter) : sections).slice(0, 8);
      if (!chosen.length) return c.json({ error: "No sections to practise" }, 400);
      const qs = await generateQuestions(c.env, ctx, { userId, courseId: body.courseId, sectionIds: chosen.map((s) => s.id), count: body.count });
      const id = randomId("prac");
      await c.env.DB.prepare("INSERT INTO practice_sessions (id, user_id, course_id, chapter, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)").bind(id, userId, body.courseId, body.chapter ?? null, Date.now()).run();
      await insertQuestions(c.env, id, qs, 1);
      return c.json({ id });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { results: questions } = await c.env.DB.prepare("SELECT id, ord, prompt, answer, concept, section_id, style_of, cites FROM practice_questions WHERE session_id = ? ORDER BY ord").bind(s.id).all<PracticeQuestion>();
    const { results: attempts } = await c.env.DB.prepare("SELECT id, question_id, answer, score, correct, feedback, created_at FROM attempts WHERE session_id = ? ORDER BY created_at").bind(s.id).all<{ question_id: string; correct: number }>();
    const answered = new Set(attempts.map((a) => a.question_id));
    const exam = await examFor(c.env, s.course_id);
    const course = await c.env.DB.prepare("SELECT title FROM courses WHERE id = ?").bind(s.course_id).first<string>("title");
    return c.json({
      session: s,
      courseTitle: course,
      examName: exam?.filename ?? null,
      // the worked answer is only sent once the question has been attempted
      questions: questions.map((q) => ({ ...q, cites: JSON.parse(q.cites), answer: answered.has(q.id) ? q.answer : null })),
      attempts,
    });
  })
  .post("/:id/answer", async (c) => {
    const userId = c.get("userId");
    const s = await session(c, c.req.param("id"), userId);
    if (!s) return c.json({ error: "Not found" }, 404);
    const { questionId, answer } = z.object({ questionId: z.string(), answer: z.string().min(1).max(5000) }).parse(await c.req.json());
    const q = await c.env.DB.prepare("SELECT * FROM practice_questions WHERE id = ? AND session_id = ?").bind(questionId, s.id).first<PracticeQuestion>();
    if (!q) return c.json({ error: "Question not found" }, 404);
    try {
      const ctx = await getAiCtx(c.env, userId);
      const exam = await examFor(c.env, s.course_id);
      const grade = await gradeAnswer(ctx, q, answer, exam?.filename);
      const id = randomId("att");
      await c.env.DB.prepare("INSERT INTO attempts (id, session_id, question_id, user_id, answer, score, correct, feedback, concept, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, s.id, q.id, userId, answer, grade.score, grade.correct ? 1 : 0, grade.feedback, q.concept, Date.now())
        .run();
      const mastery = await adjustMastery(c.env, userId, s.course_id, q.concept, grade.correct ? 0.1 : -0.15);
      return c.json({ attemptId: id, ...grade, answer: q.answer, mastery, cites: JSON.parse(q.cites) });
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
      const [nq] = await generateQuestions(c.env, ctx, { userId, courseId: s.course_id, sectionIds: [q.section_id!].filter(Boolean), count: 1, focusConcept: q.concept });
      const maxOrd = (await c.env.DB.prepare("SELECT MAX(ord) AS m FROM practice_questions WHERE session_id = ?").bind(s.id).first<number>("m")) ?? 0;
      await insertQuestions(c.env, s.id, [nq], maxOrd + 1);
      return c.json({ id: nq.id });
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
