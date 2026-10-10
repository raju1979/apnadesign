import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
export type Role = "owner" | "editor" | "viewer";
export const canEdit = (role: Role | null) =>
  role === "owner" || role === "editor";
