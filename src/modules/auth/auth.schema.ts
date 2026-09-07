import z from "zod";

export const registerSchema = z.object({
    body: z.object({
        email: z.email("Invalid email"),
        password: z.string().min(6, "Password must content more than 6 characters"),
        name: z.string().optional()
    }),
});

export const loginSchema = z.object({
    body: z.object({
        email: z.email("Invalid email"),
        password: z.string().min(1, "Password must not empty")
    }),
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];