import { Request, Response, NextFunction } from "express";
import * as paymentService from "./payment.service.js"
import Stripe from "stripe";
import { stripe } from "../../config/stripe.js";

export const handleCheckoutSession = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const { orderId } = req.body
        const result = await paymentService.createCheckoutSession(userId, orderId)
        res.status(200).json({
            success: true,
            data: result
        })
    } catch(error){
        next(error)
    }
}

export const handleStripeWebHook = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try{
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET as string
        )
    } catch(err: any){
        res.status(400).send(`Webhook error: ${err.message}`)
        return
    }

    try{
        switch(event.type){
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
                const session = event.data.object as Stripe.Checkout.Session
                await paymentService.handlePaymentSuccess(session)
                break;
            }
            case "checkout.session.async_payment_failed": {
                const session = event.data.object as Stripe.Checkout.Session
                await paymentService.handlePaymentCancelled(session)
                break;
            }
            default:
                break;
        }
        
        res.status(200).json({ received: true})
    } catch(error){
        next(error)
    }
}