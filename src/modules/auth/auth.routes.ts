import { Router } from "express";
import { registerSchema, loginSchema } from "./auth.schema.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";
import { Role } from "@prisma/client";
import * as authController from "./auth.controller.js"

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), authController.handleRegister)
authRouter.post("/login", validate(loginSchema), authController.handleLogin)

authRouter.get("/me", authenticate, authController.handleGetMe)
authRouter.get("/admin-only", authenticate, authorize([Role.ADMIN]), (req, res) => {
    res.json({
        message: "Wellcome, Admin"
    })
})