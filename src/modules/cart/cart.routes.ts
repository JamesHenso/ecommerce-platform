import { Router } from "express";
import * as cartController from "./cart.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  addToCartSchema,
  updateCartItemSchema,
  deleteCartItemSchema,
} from "./cart.schema.js";

export const cartRouter = Router()

cartRouter.use(authenticate)

cartRouter.get("/", cartController.handleGetCart)
cartRouter.post("/items", validate(addToCartSchema), cartController.handleAddItemToCart)
cartRouter.put("/items/:id", validate(updateCartItemSchema), cartController.handleUpdateCartItem)
cartRouter.delete("/items/:id", validate(deleteCartItemSchema), cartController.handleDeleteCartItem)
