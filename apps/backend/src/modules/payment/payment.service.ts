import { prisma } from "../../config/prisma.js";
import { stripe } from "../../config/stripe.js";
import Stripe from "stripe";
import { AppError } from "../../utils/appError.js";

const CLIENT_URL = process.env.CLIENT_URL

// 1. STRIPE CHECKOUT SESSION
export const createCheckoutSession = async (userId: string, orderId: string) => {
    const order = await prisma.order.findFirst({
        where: {id: orderId, userId},
        include: {
            orderItems: {
                include: { product: true }
            }
        }
    })

    if(!order){
        throw new AppError("Order item not found", 404)
    }

    if(order.status !== "PENDING"){
        throw new AppError("NOT PENDING", 400)
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.orderItems.map((item) => ({
        price_data: {
            currency: "usd",
            product_data: {
                name: item.product.name
            },
            unit_amount: Math.round(Number(item.price) * 100),
        },
        quantity: item.quantity
    }))

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: lineItems,
        success_url: `${CLIENT_URL}/payment-success?orderId=${orderId}`,
        cancel_url: `${CLIENT_URL}/payment-cancelled?orderId=${orderId}`,
        metadata: {
            orderId: order.id,
            userId
        }
    })

    return { sessionUrl: session.url}
}

// 2. PAYMENT SUCCESS
export const handlePaymentSuccess = async (session: Stripe.Checkout.Session) => {
    if(session.payment_status !== "paid"){
        return
    }

    const orderId = session.metadata?.orderId
    if(!orderId){
        return;
    }

    const transactionId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || session.id

    return prisma.$transaction(async(tx) => {
        const order = await tx.order.findUnique({
            where: {id: orderId},
            include: {
                payment: true
            }
        })

        if(!order || order.status === "PAID"){
            return
        }

        await tx.order.update({
            where: {id: orderId},
            data: {status: "PAID"}
        })

        await tx.payment.upsert({
            where: {orderId},
            create: {
                orderId,
                provider: "STRIPE",
                transactionId,
                amount: order.totalAmount,
                status: "SUCCESS",
            },
            update: {
                provider: "STRIPE",
                transactionId,
                amount: order.totalAmount,
                status: "SUCCESS",
            }
        })
    })
}

// 3. PAYMENT CANCELLED
export const handlePaymentCancelled = async (session: Stripe.Checkout.Session) => {
    const orderId = session.metadata?.orderId
    if(!orderId){
        return
    }

    return prisma.$transaction(async(tx) => {
        const order = await tx.order.findUnique({
            where: {id: orderId}, 
            include: {
                payment: true,
                orderItems: true
            }
        })

        if(!order || order.status !== "PENDING"){
            return
        }

        await tx.order.update({
            where: {id: orderId},
            data: {status: "CANCELLED"}
        })

        if(order.orderItems.length > 0){
            await Promise.all(
                order.orderItems.map((item) => (
                    tx.product.update({
                        where: {id: item.productId},
                        data: {
                            stock: {
                                increment: item.quantity
                            }
                        }
                    })
                ))
            )
        }

        await tx.payment.upsert({
            where: {orderId},
            create: {
                orderId,
                provider: "STRIPE",
                amount: order.totalAmount,
                status: "FAILED"
            },
            update: {
                status: "FAILED"
            }
        })
    })
}