-- Restore the database-level DEFAULT on context_embeddings.id.
--
-- Background:
--   20260718120000_add_context_embeddings created the column as
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid()
--   20260718213000_sync_schema_drift then ran
--     ALTER TABLE "context_embeddings" ALTER COLUMN "id" SET DATA TYPE TEXT;
--   PostgreSQL cannot carry a function default across a uuid -> text type
--   change, so the ALTER succeeded but silently dropped the DEFAULT.
--
--   Result: the column stayed NOT NULL with no default, so the raw INSERT in
--   contextEmbeddingService.upsert() (which omits `id`) failed with
--     23502: null value in column "id" ... violates not-null constraint
--
-- This is hand-written on purpose: Prisma's @default(uuid()) is a
-- client-side default, so `prisma migrate dev` will not emit this statement.

ALTER TABLE "context_embeddings"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
