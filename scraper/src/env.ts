import { z } from "zod";

const schema = z.object({
  TRAFIKVERKET_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
