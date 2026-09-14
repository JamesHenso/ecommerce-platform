import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/appError.js";
import { AddToCardInput, UpdateCartItemInput } from "./cart.schema.js";

//Helper
export const getOrCreateCart = async (userId: string) =>  {
    let cart = await prisma.cart.findUnique({
        where: {userId}
    })

    if(!cart){
        cart = await prisma.cart.create({
            data: {userId}
        })
    }

    return cart
}

// 1. GET/api/cart
export const getCart = async (userId: string) => {
    const cart = await prisma.cart.findUnique({
        where: {userId},
        include: {
            cartItems: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            price: true,
                            stock: true,
                        }
                    }
                },
                orderBy: { createdAt: "desc" },
            }
        }
    })

    if(!cart){
        return {id: null, items: [], totalAmount: 0}
    }

    const totalAmount = cart.cartItems.reduce((sum, item) => {
        return sum + Number(item.product.price) * item.quantity
    }, 0)

    return {
        id: cart.id,
        items: cart.cartItems,
        totalAmount
    }
}

// 2. POST/api/cart/items
export const addItemToCart = async (userId: string, data: AddToCardInput) => {
    const {productId, quantity} = data

    return prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
            where: {id: productId}
        })

        if(!product){
            throw new AppError("Product unavailable", 404);
        }

        const cart = await tx.cart.upsert({
            where: {userId},
            update: {},
            create: {userId}
        })

        const existingItem = await tx.cartItem.findUnique({
            where: {
                cartId_productId: {
                    cartId: cart.id,
                    productId
                }
            }
        })

        const newTotalQuantity = (existingItem?.quantity ?? 0) + quantity

        if(newTotalQuantity > product.stock){
            throw new AppError("Over stock of product", 400)
        }

        if(existingItem){
            return tx.cartItem.update({
                where: {id: existingItem.id},
                data: {quantity: newTotalQuantity},
                include: {product: true}
            })
        }

        return tx.cartItem.create({
            data: {
                cartId: cart.id,
                productId,
                quantity,
            },
            include: {product: true}
        })
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    })
}

// 3. PUT/api/cart/:id
export const updateCartItem = async (
    userId: string,
    cartItemId: string,
    data: UpdateCartItemInput
) => {
    const cart = await getOrCreateCart(userId)

    const cartItem = await prisma.cartItem.findFirst({
        where: {
            id: cartItemId,
            cartId: cart.id
        },
        include: {product: true}
    })

    if(!cartItem){
        throw new AppError("Cart unavailable", 404)
    }

    if(data.quantity > cartItem.product.stock){
        throw new AppError("Stock not enough", 400)
    }

    return prisma.cartItem.update({
        where: {id: cartItemId},
        data: {quantity: data.quantity},
        include: {product: true}
    })
}

// 4. DELETE/api/cart/:id
export const removeCartItem = async (userId: string, cartItemId: string) => {
    const cart = await getOrCreateCart(userId)

    const cartItem = await prisma.cartItem.findFirst({
        where: {
            id: cartItemId,
            cartId: cart.id
        }
    })

    if(!cartItem){
        throw new AppError("Cart unavailable", 404)
    }

    return prisma.cartItem.delete({
        where: {id: cartItemId}
    })
}