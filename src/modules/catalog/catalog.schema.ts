import z from "zod"

// Schema create category
export const createCategorySchema = z.object({
    body: z.object({
        name: z.string().min(1, "Name of category must contain character"),
        description: z.string().optional()
    })
})

// Schema create product
export const createProductSchema = z.object({
    body: z.object({
        name: z.string().min(1, "Name of product must contain character"),
        description: z.string().optional(),
        price: z.number().positive("Price must be positive"),
        stock: z.number().nonnegative("Stock is nonnegative"),
        categoryId: z.uuid("ID is invalid")
    })
})

// Schem update product
export const updateProductSchema = z.object({
    params: z.object({
        id: z.uuid("ID of product is invalid")
    }),
    body: z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        price: z.number().positive().optional(),
        stock: z.number().nonnegative().optional(),
        categoryId: z.uuid().optional()
    })
})

// Schema filter/search/pagination
export const getProductQuerySchema = z.object({
    query: z.object({
        page: z.coerce.number().positive().default(1),
        limit: z.coerce.number().positive().max(100).default(10),
        search: z.string().trim().max(100).optional(),
        categoryId: z.uuid().optional(),
        minPrice: z.coerce.number().nonnegative().optional(),
        maxPrice: z.coerce.number().nonnegative().optional()
    }).refine(
        (data) => 
            data.minPrice === undefined ||
            data.maxPrice === undefined ||
            data.minPrice <= data.maxPrice,
        {
            message: "min price must be less than max price",
            path: ["maxPrice"]
        }
    )
})

export type CreateProductInput = z.infer<typeof createProductSchema>["body"]
export type UpdateProductInput = z.infer<typeof updateProductSchema>["body"]
export type GetProductsQuery = z.infer<typeof getProductQuerySchema>["query"]