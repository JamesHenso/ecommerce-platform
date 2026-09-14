import z from "zod"

export const checkoutSchema = z.object({
    body: z.object({
        address: z.string().min(6, "Address must be more than 6 character"  )
    })
})

export const getOrderByIdSchema = z.object({
    params: z.object({
        id: z.uuid("ID is invalid")
    })
})

export type CheckoutInput = z.infer<typeof checkoutSchema>["body"]