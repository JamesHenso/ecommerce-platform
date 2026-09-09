import { Router } from "express";
import * as cartController from "./cart.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  addToCartSchema,
  updateCartItemSchema,
  deleteCartItemSchema,
} from "./cart.schema.js";

export const cartRoutes = Router()

cartRoutes.use(authenticate)

cartRoutes.get("/", cartController.handleGetCart)
cartRoutes.post("/items", validate(addToCartSchema), cartController.handleAddItemToCart)
cartRoutes.put("/items/:id", validate(updateCartItemSchema), cartController.handleUpdateCartItem)
cartRoutes.delete("/items/:id", validate(deleteCartItemSchema), cartController.handleDeleteCartItem)
