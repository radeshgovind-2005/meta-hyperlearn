import type { Env } from "../env";

export async function getMastery(env: Env, userId: string, courseId: string, concept: string): Promise<number> {
  const v = await env.DB.prepare("SELECT score FROM mastery WHERE user_id = ? AND course_id = ? AND concept = ?").bind(userId, courseId, concept).first<number>("score");
  return v ?? 0.5;
}

export async function setMastery(env: Env, userId: string, courseId: string, concept: string, score: number): Promise<number> {
  const s = Math.max(0, Math.min(1, score));
  await env.DB.prepare(
    "INSERT INTO mastery (user_id, course_id, concept, score, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, course_id, concept) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at",
  )
    .bind(userId, courseId, concept, s, Date.now())
    .run();
  return s;
}

export async function adjustMastery(env: Env, userId: string, courseId: string, concept: string, delta: number): Promise<number> {
  return setMastery(env, userId, courseId, concept, (await getMastery(env, userId, courseId, concept)) + delta);
}

export async function allMastery(env: Env, userId: string, courseId: string): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare("SELECT concept, score FROM mastery WHERE user_id = ? AND course_id = ?").bind(userId, courseId).all<{ concept: string; score: number }>();
  return Object.fromEntries(results.map((r) => [r.concept, r.score]));
}
