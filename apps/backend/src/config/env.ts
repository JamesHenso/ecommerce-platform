import "dotenv/config"
import z from "zod"

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    CLIENT_URL: z.url(),
})

const parsed = envSchema.safeParse(process.env)
if(!parsed.success){
    console.log("INVALID ENVIRONMENT VARIABLES:", z.treeifyError(parsed.error));
    process.exit(1)
}

export const env = parsed.data