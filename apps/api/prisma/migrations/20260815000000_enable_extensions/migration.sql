-- Must be the first migration: everything geospatial later depends on it.
-- postgis  : geography/geometry columns + distance search (Phase "search")
-- pg_trgm  : fuzzy text matching for provider/skill search
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
