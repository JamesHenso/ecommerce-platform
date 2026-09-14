import z from "zod"

export const addToCartSchema = z.object({
    body: z.object({
        productId: z.uuid("ID of product is invalid"),
        quantity: z.number().int().positive("Quantity must be positive")
    })
})

export const updateCartItemSchema = z.object({
    params: z.object({
        id: z.uuid("ID of product is invalid")
    }),
    body: z.object({
        quantity: z.number().int().positive("Quantity must be positive")
    })
})

export const deleteCartItemSchema = z.object({
    params: z.object({
        id: z.uuid("ID of product is invalid")
    })
})

export type AddToCardInput = z.infer<typeof addToCartSchema>["body"]
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>["body"]