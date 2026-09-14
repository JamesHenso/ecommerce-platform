import { Router } from "express"
import { validate } from "../../middlewares/validate.middleware.js"
import { checkoutSchema, getOrderByIdSchema } from "./order.schema.js"
import * as orderController from "./order.controller.js"
import { authenticate } from "../../middlewares/auth.middleware.js"


export const orderRouter = Router()
orderRouter.use(authenticate)

orderRouter.post("/checkout", validate(checkoutSchema), orderController.handleCheckout)
orderRouter.get("/", orderController.handleGetMyOrders)
orderRouter.get("/:id", validate(getOrderByIdSchema), orderController.handleGetOrderDetail)