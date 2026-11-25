-- AI PDF scan metadata (cover project details, mood board palette/materials, layout legend, linked floor plan).
alter table source_documents add column if not exists pdf_scan jsonb default null;
