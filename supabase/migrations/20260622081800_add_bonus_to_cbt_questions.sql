-- Add bonus/joke question columns to cbt_questions
ALTER TABLE public.cbt_questions 
ADD COLUMN is_bonus boolean NOT NULL DEFAULT false,
ADD COLUMN targeted_emails text[] NOT NULL DEFAULT '{}'::text[];
