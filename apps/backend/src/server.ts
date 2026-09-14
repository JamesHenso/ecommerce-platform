import "dotenv/config";
import express from "express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import { cartRouter } from "./modules/cart/cart.routes.js";
import { orderRouter } from "./modules/order/order.routes.js";
import { paymentRouter } from "./modules/payment/payment.routes.js";
import * as paymentController from "./modules/payment/payment.controller.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  paymentController.handleStripeWebHook
);
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter)
app.use("/api/payment", paymentRouter);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});