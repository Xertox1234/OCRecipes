-- Enable pg_trgm extension for GIN trigram indexes
-- Run this BEFORE drizzle-kit push if pg_trgm is not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;
