import { Router } from "express";
import * as paymentController from "./payment.controller.js"
import { authenticate } from "../../common/middleware/auth.middleware.js";
const paymentRouter = Router()

paymentRouter.post(
    "/checkout-session",
    authenticate,
    paymentController.handleCheckoutSession
)

export { paymentRouter }