import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/appError.js";
import { CreateProductInput, GetProductsQuery, UpdateProductInput } from "./catalog.schema.js";

// CATEGORY
export const createCategory = async(data: {name: string; description?: string}) => {
    const existingCategory = await prisma.category.findUnique({
        where: {name: data.name},
    })
    if(existingCategory){
        throw new AppError("Category available", 409)
    }
    return prisma.category.create( {data} )
}

// PUBLIC API
export const getAllCategories = async() => {
    return prisma.category.findMany()
}

export const getProducts = async(filters: GetProductsQuery) => {
    const {page, limit, search, categoryId, minPrice, maxPrice} = filters
    const skip = (page - 1) * limit

    const where: Prisma.ProductWhereInput = {} // Where dong

    if(search){
        where.OR = [
            {name: {contains: search, mode: "insensitive"}},
            {description: {contains: search, mode: "insensitive"}}
        ]
    }

    if(categoryId){
        where.categoryId = categoryId
    }

    if(minPrice !== undefined || maxPrice !== undefined){
        where.price = {};
        if(minPrice !== undefined) where.price.gte = minPrice;
        if(maxPrice !== undefined) where.price.lte = maxPrice;
    }

    const [total, products] = await Promise.all([
        prisma.product.count({where}),
        prisma.product.findMany({
            where,
            skip,
            take: limit,
            include: {
                category: {
                    select: {id: true, name: true}
                }
            },
            orderBy: {createdAt: "desc"}
        })
    ])

    return{
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total/limit)
        },
        data: products
    }
}

export const getProductById = async(id: string) => {
    const product = await prisma.product.findUnique({
        where: {id},
        include: {
            category: true
        }
    })

    if(!product){
        throw new AppError("Product not found", 404)
    }

    return product
}

// ADMIN: CRUD Product
export const createProduct = async(data: CreateProductInput) => {
    const categoryExists = await prisma.category.findUnique({
        where: {id: data.categoryId}
    })

    if(!categoryExists){
        throw new AppError("Category unavailable", 404)
    }

    return prisma.product.create({
        data: {
            name: data.name,
            description: data.description ?? "",
            price: data.price,
            stock: data.stock,
            categoryId: data.categoryId
        }
    })
}

export const updateProduct = async (id: string, data: UpdateProductInput) => {
    await getProductById(id)

    if(data.categoryId){
        const categoryExists = await prisma.category.findUnique({
            where: {id: data.categoryId}
        })

        if(!categoryExists){
            throw new AppError("Category unavailable", 404)
        }
    }

    return prisma.product.update({
        where: {id},
        data,
    })
}

export const deleteProduct = async (id: string) => {
    await getProductById(id)

    return prisma.product.delete({
        where: {id},
    })
}