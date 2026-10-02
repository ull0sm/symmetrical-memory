-- =========================================================================
-- RingFlow Migration 3: Storage Policies for Category PDFs
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- Fixes: "new row violates row-level security policy" during PDF uploads
-- =========================================================================

-- 1. Ensure 'category-docs' bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('category-docs', 'category-docs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Allow authenticated users to upload files to category-docs
DROP POLICY IF EXISTS "Authenticated users can upload category docs" ON storage.objects;
CREATE POLICY "Authenticated users can upload category docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'category-docs');

-- 3. Allow authenticated users to update/overwrite files in category-docs
DROP POLICY IF EXISTS "Authenticated users can update category docs" ON storage.objects;
CREATE POLICY "Authenticated users can update category docs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'category-docs');

-- 4. Allow public access to view and download category docs
DROP POLICY IF EXISTS "Public can view category docs" ON storage.objects;
CREATE POLICY "Public can view category docs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'category-docs');

-- 5. Allow authenticated users to delete files from category-docs
DROP POLICY IF EXISTS "Authenticated users can delete category docs" ON storage.objects;
CREATE POLICY "Authenticated users can delete category docs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'category-docs');
