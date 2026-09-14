import bcrypt from "bcrypt"
import { LoginInput, RegisterInput } from "./auth.schema.js"
import { prisma } from "../../config/prisma.js"
import { AppError } from "../../utils/appError.js"
import { signToken } from "../../utils/jwt.js"

const SALT_ROUNDS = 10
export const registerUser = async (data: RegisterInput) => {
    const existingUser = await prisma.user.findUnique({
        where: {email: data.email}
    })

    if(existingUser){
        throw new AppError("Available Email", 409)
    }

    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS)

    const user = await prisma.user.create({
        data: {
            email: data.email,
            password: hashedPassword,
            name: data.name,
            cart: {
                create: {},
            }
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true
        },
    });
    const token = signToken({ id: user.id, role: user.role });

    return  {user, token}
}

export const loginUser = async(data: LoginInput) => {
    const user = await prisma.user.findUnique({
        where: {email: data.email}
    })

    if(!user){
        throw new AppError("Email or Password are incorrect", 401)
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password)
    if(!isPasswordValid){
        throw new AppError("Email or Password are incorrect", 401)
    }

    const token = signToken({id: user.id, role: user.role})

    return{
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        },
        token,
    }
}