import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/appError.js";
import { CheckoutInput, getOrderByIdSchema } from "./order.schema.js";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/client";

export const checkOutOrder = async (userId: string, data: CheckoutInput) => {
    return await prisma.$transaction(async (tx) => {
        const cart = await tx.cart.findUnique({
            where: {userId},
            include: {
                cartItems: {
                    include: {
                        product: true
                    }
                }
            }
        })

        if(!cart || cart.cartItems.length === 0){
            throw new AppError("Cart is empty", 400)
        }

        let totalAmount = new Decimal(0)
        
        for(const item of cart.cartItems){
            if(item.product.stock < item.quantity){
                throw new AppError("Stock is less than quantity", 400)
            }

            const itemSubtotal = new Decimal(item.product.price).mul(item.quantity)
            totalAmount = totalAmount.add(itemSubtotal)
        }

        // Atomic Update
        for(const item of cart.cartItems){
            try{
                await tx.product.update({
                    where: {
                        id: item.productId,
                        stock: {
                            gte: item.quantity
                        },
                    },
                    data: {
                        stock: {
                            decrement: item.quantity
                        }
                    }
                })
            } catch(error){
                if(
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2025"
                ){
                    throw new AppError("Product stock is not enough for order quantity", 400)
                }

                throw error
            }
        }

        const order = await tx.order.create({
            data: {
                userId,
                totalAmount,
                address: data.address,
                status: "PENDING",
                orderItems: {
                    create: cart.cartItems.map((item) => ({
                        productId: item.productId,
                        price: item.product.price,
                        quantity: item.quantity
                    }))
                }
            },
            include: {
                orderItems: {
                    include: {
                        product: {
                            select: {name: true}
                        }
                    }
                }
            }
        })

        await tx.cartItem.deleteMany({
            where: {
                cartId: cart.id
            },
        })

        return order
    })
}

export const getUserOrders = async (userId: string) => {
    return await prisma.order.findMany({
        where: {userId},
        include: {
            orderItems: {
                include: {
                    product: {
                        select: {id: true, name: true}
                    }
                }
            },
            payment: true,
        },
        orderBy: {createdAt: "desc"}
    })
}

export const getOrderDetail = async (userId: string, orderId: string) => {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            userId,
        },
        include: {
            orderItems: {
                include: {
                    product: {
                        select: {id: true, name: true}
                    }
                }
            },
            payment: true
        },
        orderBy: {createdAt: "desc"}
    })

    if(!order){
        throw  new AppError("Order items not found", 404)
    }

    return order
}