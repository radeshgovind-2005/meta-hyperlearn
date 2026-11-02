import type { CourseDO } from "./do/CourseDO";
import type { UserDO } from "./do/UserDO";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  VECTORS: VectorizeIndex;
  AI: Ai;
  BROWSER: Fetcher;
  COURSE_DO: DurableObjectNamespace<CourseDO>;
  USER_DO: DurableObjectNamespace<UserDO>;
  INGEST: Workflow;
  BUILD: Workflow;
  BUILD_SECTION: Workflow;

  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  META_API_KEY?: string;
  META_BASE_URL: string;
  OPEN_MODEL_BASE_URL?: string;
  OPEN_MODEL_ID?: string;
  OPEN_MODEL_API_KEY?: string;
  KEY_ENCRYPTION_KEY: string;
  LANGSMITH_TRACING?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_PROJECT?: string;
  DEMO_SPEND_CAP_USD: string;
  WIDGETS_ORIGIN: string;
  APP_ORIGIN: string;
  SEED_TOKEN?: string;
  QUOTA_STORAGE_GB?: string;
  QUOTA_R2_CLASS_A?: string;
  QUOTA_R2_CLASS_B?: string;
  QUOTA_VECTORS?: string;
  QUOTA_VECTOR_QUERIES?: string;
  QUOTA_AI_CALLS_DAY?: string;
  QUOTA_BROWSER_DAY?: string;
}

export type AppVars = { userId: string };
export type AppEnv = { Bindings: Env; Variables: AppVars };
